import base64
import json
import re
import zlib

from django.conf import settings
from django.db import transaction
from django.urls import reverse

from .models import Cell, Frame, Layer, Palette, PaletteColor, Project, Revision
from .rle import RLEError, composite, decode, from_base64, to_base64

# Version of the .crivo document format written by this server. Version 1 (Portuguese keys) is still read.
FORMAT_VERSION = 2

HEX = re.compile(r"^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$")
PNG = b"\x89PNG\r\n\x1a\n"

# Validation messages are shown to the user by the editor, so they stay in Portuguese.


class ValidationError(ValueError):
    pass


class Conflict(Exception):
    def __init__(self, current_revision):
        super().__init__("Stale revision")
        self.current_revision = current_revision


def _limits():
    return settings.CRIVO


_V1_DOCUMENT_KEYS = {
    "formato": "format",
    "nome": "name",
    "largura": "width",
    "altura": "height",
    "fps": "fps",
    "paleta": "palette",
    "camadas": "layers",
    "quadros": "frames",
    "celulas": "cells",
}
_V1_LAYER_KEYS = {"id": "id", "nome": "name", "visivel": "visible", "opacidade": "opacity", "bloqueada": "locked"}
_V1_FRAME_KEYS = {"id": "id", "duracao": "duration"}
_V1_CELL_KEYS = {"quadro": "frame", "camada": "layer", "rle": "rle"}


def _rename_keys(item, keys):
    # Anything that is not an object is passed through untouched, so validation treats it exactly as in a v2 document.
    if not isinstance(item, dict):
        return item
    return {keys[k]: v for k, v in item.items() if k in keys}


def _rename_items(items, keys):
    return [_rename_keys(item, keys) for item in items] if isinstance(items, list) else items


def upgrade_document(data):
    """Return `data` as a version 2 .crivo document.

    Version 1 documents (Portuguese keys, detected by the "formato" key) are converted key by key; the RLE pixel data
    is unchanged. Anything else, including version 2 documents and invalid input, is returned as is for
    validate_document to accept or reject. Used for request bodies and for revisions stored before 2.0.0.
    """
    if not isinstance(data, dict) or "formato" not in data:
        return data
    document = {_V1_DOCUMENT_KEYS[k]: v for k, v in data.items() if k in _V1_DOCUMENT_KEYS}
    document["version"] = FORMAT_VERSION
    for key, item_keys in (("layers", _V1_LAYER_KEYS), ("frames", _V1_FRAME_KEYS), ("cells", _V1_CELL_KEYS)):
        if key in document:
            document[key] = _rename_items(document[key], item_keys)
    return document


def normalize_hex(value):
    m = HEX.match(str(value or "").strip())
    if not m:
        raise ValidationError(f"Cor inválida: {value!r}")
    text = "#" + m.group(1).lower()
    if m.group(2) and m.group(2).lower() != "ff":
        text += m.group(2).lower()
    return text


def _integer(value, label, minimum, maximum):
    try:
        n = int(value)
    except (TypeError, ValueError) as error:
        raise ValidationError(f"{label} precisa ser um número inteiro.") from error
    if n < minimum or n > maximum:
        raise ValidationError(f"{label} precisa ficar entre {minimum} e {maximum}.")
    return n


def _key(value, label):
    text = str(value or "")
    if not text or len(text) > 40:
        raise ValidationError(f"Identificador inválido em {label}.")
    return text


def validate_document(data):
    """Validate a .crivo document (version 1 or 2) and return it normalized, with the cell pixels decoded from base64."""
    data = upgrade_document(data)
    if not isinstance(data, dict) or data.get("format") != "crivo":
        raise ValidationError("O campo 'data' precisa ser um projeto no formato do Crivo.")
    version = data.get("version")
    if isinstance(version, (int, float)) and not isinstance(version, bool) and version > FORMAT_VERSION:
        raise ValidationError("Este projeto foi salvo por uma versão mais nova do Crivo.")
    lim = _limits()
    width = _integer(data.get("width"), "largura", 1, lim["MAX_SIDE"])
    height = _integer(data.get("height"), "altura", 1, lim["MAX_SIDE"])
    fps = _integer(data.get("fps", 8), "fps", 1, 60)
    layers = data.get("layers") or []
    frames = data.get("frames") or []
    if not isinstance(layers, list) or not 1 <= len(layers) <= lim["MAX_LAYERS"]:
        raise ValidationError(f"O projeto precisa de 1 a {lim['MAX_LAYERS']} camadas.")
    if not isinstance(frames, list) or not 1 <= len(frames) <= lim["MAX_FRAMES"]:
        raise ValidationError(f"O projeto precisa de 1 a {lim['MAX_FRAMES']} quadros.")
    keys = set()
    valid_layers = []
    for layer in layers:
        key = _key(layer.get("id"), "camadas")
        if key in keys:
            raise ValidationError("Identificadores repetidos entre camadas e quadros.")
        keys.add(key)
        valid_layers.append(
            {
                "id": key,
                "name": str(layer.get("name") or "Camada")[:80],
                "visible": layer.get("visible") is not False,
                "opacity": _integer(layer.get("opacity", 100), "opacidade", 0, 100),
                "locked": bool(layer.get("locked")),
            }
        )
    valid_frames = []
    for frame in frames:
        key = _key(frame.get("id"), "quadros")
        if key in keys:
            raise ValidationError("Identificadores repetidos entre camadas e quadros.")
        keys.add(key)
        duration = frame.get("duration")
        valid_frames.append({"id": key, "duration": _integer(duration, "duração", 1, 60000) if duration else None})
    layer_ids = {layer["id"] for layer in valid_layers}
    frame_ids = {frame["id"] for frame in valid_frames}
    valid_cells = []
    seen = set()
    for cell in data.get("cells") or []:
        f, la = cell.get("frame"), cell.get("layer")
        if f not in frame_ids or la not in layer_ids or (f, la) in seen:
            raise ValidationError("Célula aponta para um quadro ou camada que não existe.")
        seen.add((f, la))
        try:
            raw = from_base64(cell.get("rle") or "")
            decode(raw, width * height)
        except RLEError as error:
            raise ValidationError(f"Pixels inválidos: {error}") from error
        valid_cells.append({"frame": f, "layer": la, "pixels": raw})
    palette = [normalize_hex(c) for c in (data.get("palette") or [])[:256]]
    return {
        "name": str(data.get("name") or "Sem título").strip()[:120] or "Sem título",
        "width": width,
        "height": height,
        "fps": fps,
        "palette": palette,
        "layers": valid_layers,
        "frames": valid_frames,
        "cells": valid_cells,
    }


def read_thumbnail(value):
    if not value:
        return None
    text = str(value)
    if text.startswith("data:"):
        if not text.startswith("data:image/png;base64,"):
            raise ValidationError("A miniatura precisa ser PNG.")
        text = text.split(",", 1)[1]
    try:
        raw = base64.b64decode(text, validate=True)
    except ValueError as error:
        raise ValidationError("Miniatura inválida.") from error
    if not raw.startswith(PNG):
        raise ValidationError("A miniatura precisa ser PNG.")
    if len(raw) > _limits()["MAX_THUMBNAIL_BYTES"]:
        raise ValidationError("Miniatura grande demais.")
    return raw


def document_from_db(project):
    """Rebuild the project's .crivo document (always version 2)."""
    layers = list(project.layers.all())
    frames = list(project.frames.all())
    layer_keys = {layer.pk: layer.key for layer in layers}
    frame_keys = {frame.pk: frame.key for frame in frames}
    cells = sorted(
        Cell.objects.filter(frame__project=project).values_list("frame_id", "layer_id", "pixels"),
        key=lambda t: (t[0], t[1]),
    )
    return {
        "format": "crivo",
        "version": FORMAT_VERSION,
        "name": project.name,
        "width": project.width,
        "height": project.height,
        "fps": project.fps,
        "palette": project.palette,
        "layers": [{"id": layer.key, "name": layer.name, "visible": layer.visible, "opacity": layer.opacity, "locked": layer.locked} for layer in layers],
        "frames": [{"id": frame.key, "duration": frame.duration_ms} for frame in frames],
        "cells": [{"frame": frame_keys[f], "layer": layer_keys[la], "rle": to_base64(bytes(px))} for f, la, px in cells],
    }


def _write_content(project, doc):
    project.frames.all().delete()
    project.layers.all().delete()
    layers = Layer.objects.bulk_create(
        [
            Layer(project=project, key=layer["id"], position=i, name=layer["name"], visible=layer["visible"], opacity=layer["opacity"], locked=layer["locked"])
            for i, layer in enumerate(doc["layers"])
        ]
    )
    frames = Frame.objects.bulk_create(
        [Frame(project=project, key=frame["id"], position=i, duration_ms=frame["duration"]) for i, frame in enumerate(doc["frames"])]
    )
    by_layer = {layer.key: layer for layer in layers}
    by_frame = {frame.key: frame for frame in frames}
    Cell.objects.bulk_create(
        [Cell(frame=by_frame[cell["frame"]], layer=by_layer[cell["layer"]], pixels=cell["pixels"], size_bytes=len(cell["pixels"])) for cell in doc["cells"]],
        batch_size=200,
    )


def _save_revision(project):
    content = zlib.compress(json.dumps(document_from_db(project), separators=(",", ":")).encode("utf-8"), 6)
    Revision.objects.create(project=project, number=project.revision, name=project.name, content=content, size_bytes=len(content))
    surplus = list(project.revisions.order_by("-number").values_list("pk", flat=True)[_limits()["MAX_REVISIONS"] :])
    if surplus:
        Revision.objects.filter(pk__in=surplus).delete()


@transaction.atomic
def create_project(data, thumbnail=None, name=None):
    doc = validate_document(data)
    project = Project.objects.create(
        name=(name or doc["name"])[:120],
        width=doc["width"],
        height=doc["height"],
        fps=doc["fps"],
        format_version=FORMAT_VERSION,
        palette=doc["palette"],
        thumbnail=read_thumbnail(thumbnail),
    )
    _write_content(project, doc)
    return project


@transaction.atomic
def update_project(project_id, data, thumbnail=None, revision=None, name=None):
    doc = validate_document(data)
    project = Project.objects.select_for_update().get(pk=project_id)
    if revision is not None and int(revision) != project.revision:
        raise Conflict(project.revision)
    _save_revision(project)
    project.name = (name or doc["name"])[:120]
    project.width = doc["width"]
    project.height = doc["height"]
    project.fps = doc["fps"]
    project.format_version = FORMAT_VERSION
    project.palette = doc["palette"]
    project.revision += 1
    new_thumbnail = read_thumbnail(thumbnail)
    if new_thumbnail:
        project.thumbnail = new_thumbnail
    project.save()
    _write_content(project, doc)
    return project


def read_revision_document(revision):
    """The document stored in a revision, upgraded to version 2 (revisions saved before 2.0.0 hold version 1)."""
    return upgrade_document(json.loads(zlib.decompress(bytes(revision.content)).decode("utf-8")))


@transaction.atomic
def restore_revision(project_id, number):
    project = Project.objects.select_for_update().get(pk=project_id)
    revision = project.revisions.get(number=number)
    return update_project(project.pk, read_revision_document(revision), revision=project.revision)


def composite_pixels(project, indices=None):
    doc = document_from_db(project)
    total = doc["width"] * doc["height"]
    cells = {(c["frame"], c["layer"]): decode(from_base64(c["rle"]), total) for c in doc["cells"]}
    frames = doc["frames"] if indices is None else [doc["frames"][i] for i in indices]
    output = []
    for frame in frames:
        layers = [
            (cells[(frame["id"], layer["id"])], layer["opacity"] / 100) for layer in doc["layers"] if layer["visible"] and (frame["id"], layer["id"]) in cells
        ]
        output.append(composite(doc["width"], doc["height"], layers))
    return doc, output


def project_summary(project, counts=None, has_thumbnail=None):
    """Project fields for listings. `counts` and `has_thumbnail` avoid extra queries when the caller already has them."""
    if has_thumbnail is None:
        has_thumbnail = bool(project.thumbnail)
    return {
        "id": str(project.pk),
        "name": project.name,
        "width": project.width,
        "height": project.height,
        "fps": project.fps,
        "revision": project.revision,
        "frames": counts["frames"] if counts else project.frames.count(),
        "layers": counts["layers"] if counts else project.layers.count(),
        "thumbnail_url": reverse("thumbnail", args=[project.pk]) if has_thumbnail else None,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


def palette_to_dict(p):
    return {
        "id": str(p.pk),
        "slug": p.slug,
        "name": p.name,
        "description": p.description,
        "preset": p.preset,
        "colors": [c.hex for c in p.colors.all()],
        "updated_at": p.updated_at.isoformat(),
    }


@transaction.atomic
def save_palette(data, palette=None):
    name = str(data.get("name") or "").strip()[:80]
    if not name:
        raise ValidationError("Dê um nome para a paleta.")
    colors = data.get("colors")
    if not isinstance(colors, list) or not 1 <= len(colors) <= 256:
        raise ValidationError("A paleta precisa de 1 a 256 cores.")
    colors = [normalize_hex(c) for c in colors]
    if palette is None:
        palette = Palette.objects.create(name=name)
    else:
        palette.name = name
        palette.save()
        palette.colors.all().delete()
    PaletteColor.objects.bulk_create([PaletteColor(palette=palette, position=i, hex=c) for i, c in enumerate(colors)])
    return palette
