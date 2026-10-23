import base64
import json
import re
import zlib

from django.conf import settings
from django.db import transaction
from django.urls import reverse

from .blend import render_frame
from .models import (
    BLEND_MODES,
    COLOR_MODES,
    LAYER_KINDS,
    MAX_TILE_SIDE,
    MAX_TILES,
    TAG_DIRECTIONS,
    Cell,
    Frame,
    Layer,
    Palette,
    PaletteColor,
    Project,
    Revision,
    Slice,
    Tag,
    Tileset,
)
from .rle import RLEError, decode, from_base64, run_length, split_runs, to_base64

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
                **_layer_fields_21(layer),
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
        valid_cells.append({"frame": f, "layer": la, "pixels": raw, **_cell_fields_21(cell)})
    palette = [normalize_hex(c) for c in (data.get("palette") or [])[:256]]
    document = {
        "name": str(data.get("name") or "Sem título").strip()[:120] or "Sem título",
        "width": width,
        "height": height,
        "fps": fps,
        "palette": palette,
        "layers": valid_layers,
        "frames": valid_frames,
        "cells": valid_cells,
    }
    _validate_21(data, document)
    return document


# Crivo 2.1 document additions: optional keys (colorMode, tags, slices, tilesets; layer blendMode, kind, parent,
# collapsed, tileset, reference; cell link, tiles). Writers omit the defaults, so 2.0 documents round-trip unchanged.

MAX_TAGS = 256
MAX_SLICES = 256
MAX_TILESETS = 32


def _optional_key(value, label):
    return None if value is None or value == "" else _key(value, label)


def _layer_fields_21(layer):
    name = str(layer.get("name") or "Camada")[:80]
    blend_mode = layer.get("blendMode") or "normal"
    if blend_mode not in BLEND_MODES:
        raise ValidationError(f"Modo de mesclagem inválido na camada '{name}': {blend_mode!r}.")
    kind = layer.get("kind") or "image"
    if kind not in LAYER_KINDS:
        raise ValidationError(f"Tipo de camada inválido na camada '{name}': {kind!r}.")
    return {
        "blendMode": blend_mode,
        "kind": kind,
        "parent": _optional_key(layer.get("parent"), "camadas"),
        "collapsed": bool(layer.get("collapsed")),
        "tileset": _optional_key(layer.get("tileset"), "camadas"),
        "reference": bool(layer.get("reference")),
    }


def _cell_fields_21(cell):
    tiles = cell.get("tiles")
    raw = None
    if tiles is not None and tiles != "":
        try:
            raw = from_base64(tiles)
        except RLEError as error:
            raise ValidationError(f"Tiles inválidos: {error}") from error
    return {"link": _optional_key(cell.get("link"), "células"), "tiles": raw}


def _list(data, key, maximum, message):
    items = data.get(key) or []
    if not isinstance(items, list) or len(items) > maximum or not all(isinstance(item, dict) for item in items):
        raise ValidationError(message)
    return items


def _unique_key(item, seen, label, message):
    key = _key(item.get("id"), label)
    if key in seen:
        raise ValidationError(message)
    seen.add(key)
    return key


def _validate_tilesets(data):
    tilesets = []
    seen = set()
    for item in _list(data, "tilesets", MAX_TILESETS, f"O projeto pode ter no máximo {MAX_TILESETS} conjuntos de tiles."):
        key = _unique_key(item, seen, "conjuntos de tiles", "Identificadores repetidos entre os conjuntos de tiles.")
        name = str(item.get("name") or "Tiles")[:80]
        tile_width = _integer(item.get("tileWidth"), "largura do tile", 1, MAX_TILE_SIDE)
        tile_height = _integer(item.get("tileHeight"), "altura do tile", 1, MAX_TILE_SIDE)
        tiles = item.get("tiles")
        if not isinstance(tiles, list) or not 1 <= len(tiles) <= MAX_TILES:
            raise ValidationError(f"O conjunto de tiles '{name}' precisa de 1 a {MAX_TILES} tiles.")
        size = tile_width * tile_height
        raw_tiles = []
        for tile in tiles:
            try:
                raw = from_base64(tile or "")
                if run_length(raw, size) != size:
                    raise RLEError("RLE menor que a matriz")
            except RLEError as error:
                raise ValidationError(f"Tiles inválidos no conjunto '{name}': {error}") from error
            raw_tiles.append(raw)
        tilesets.append({"id": key, "name": name, "tileWidth": tile_width, "tileHeight": tile_height, "tiles": raw_tiles})
    return tilesets


def _validate_layer_tree(layers, tilesets):
    by_id = {layer["id"]: layer for layer in layers}
    for layer in layers:
        parent = layer["parent"]
        if parent is not None and parent not in by_id:
            raise ValidationError(f"A camada '{layer['name']}' está dentro de um grupo que não existe.")
        if parent is not None and by_id[parent]["kind"] != "group":
            raise ValidationError(f"A camada '{layer['name']}' só pode ficar dentro de uma camada de grupo.")
        if layer["kind"] == "tilemap" and layer["tileset"] not in tilesets:
            raise ValidationError(f"A camada de tiles '{layer['name']}' precisa de um conjunto de tiles que exista.")
        if layer["kind"] != "tilemap" and layer["tileset"] is not None:
            raise ValidationError(f"A camada '{layer['name']}' não é uma camada de tiles.")
    for layer in layers:
        seen = {layer["id"]}
        parent = layer["parent"]
        while parent is not None:
            if parent in seen:
                raise ValidationError("Os grupos de camadas formam um ciclo.")
            seen.add(parent)
            parent = by_id[parent]["parent"]


def _validate_cells_21(document, tilesets):
    layers = {layer["id"]: layer for layer in document["layers"]}
    frames = {frame["id"] for frame in document["frames"]}
    cells = {(cell["frame"], cell["layer"]): cell for cell in document["cells"]}
    width, height = document["width"], document["height"]
    for cell in document["cells"]:
        link = cell["link"]
        if link is not None:
            if link not in frames:
                raise ValidationError("Célula vinculada aponta para um quadro que não existe.")
            # The editor does not write empty cels, so the source may be missing (an empty cel); it may not be linked.
            source = cells.get((link, cell["layer"]))
            if link == cell["frame"] or (source is not None and source["link"] is not None):
                raise ValidationError("Célula vinculada precisa apontar para uma célula com pixels próprios da mesma camada.")
        if cell["tiles"] is not None:
            layer = layers[cell["layer"]]
            if layer["kind"] != "tilemap":
                raise ValidationError("Só células de camadas de tiles guardam tiles.")
            tileset = tilesets[layer["tileset"]]
            tw, th = tileset["tileWidth"], tileset["tileHeight"]
            # columns x rows: whole tiles covering the canvas (partial tiles at the edges counted or not).
            sizes = {-(-width // tw) * -(-height // th), (width // tw) * (height // th)}
            try:
                count = run_length(cell["tiles"], max(sizes))
                if count not in sizes:
                    raise RLEError("RLE menor que a matriz")
                indices = decode(cell["tiles"], count)
            except RLEError as error:
                raise ValidationError(f"Tiles inválidos: {error}") from error
            if indices and max(indices) >= len(tileset["tiles"]):
                raise ValidationError("Célula aponta para um tile que não existe.")


def _opaque_hex(value, label):
    color = normalize_hex(value)
    if len(color) != 7:
        raise ValidationError(f"A cor {label} não pode ser transparente.")
    return color


def _validate_tags(data, document):
    positions = {frame["id"]: i for i, frame in enumerate(document["frames"])}
    tags = []
    seen = set()
    for item in _list(data, "tags", MAX_TAGS, f"O projeto pode ter no máximo {MAX_TAGS} tags."):
        key = _unique_key(item, seen, "tags", "Identificadores repetidos entre as tags.")
        name = str(item.get("name") or "Tag")[:80]
        start, end = item.get("from"), item.get("to")
        if not isinstance(start, str) or not isinstance(end, str) or start not in positions or end not in positions:
            raise ValidationError(f"A tag '{name}' aponta para um quadro que não existe.")
        if positions[start] > positions[end]:
            raise ValidationError(f"A tag '{name}' termina antes de começar.")
        direction = item.get("direction") or "forward"
        if direction not in TAG_DIRECTIONS:
            raise ValidationError(f"Direção inválida na tag '{name}': {direction!r}.")
        tags.append(
            {
                "id": key,
                "name": name,
                "from": start,
                "to": end,
                "direction": direction,
                "repeat": _integer(item.get("repeat") or 0, "repetições da tag", 0, 65535),
                "color": _opaque_hex(item.get("color") or "#000000", "da tag"),
            }
        )
    return tags


def _validate_slices(data):
    side = _limits()["MAX_SIDE"]
    slices = []
    seen = set()
    for item in _list(data, "slices", MAX_SLICES, f"O projeto pode ter no máximo {MAX_SLICES} fatias."):
        key = _unique_key(item, seen, "fatias", "Identificadores repetidos entre as fatias.")
        name = str(item.get("name") or "Fatia")[:80]
        center = item.get("center")
        if center is not None:
            if not isinstance(center, dict):
                raise ValidationError(f"Centro inválido na fatia '{name}'.")
            center = {
                "x": _integer(center.get("x"), "x do centro da fatia", 0, side),
                "y": _integer(center.get("y"), "y do centro da fatia", 0, side),
                "width": _integer(center.get("width"), "largura do centro da fatia", 0, side),
                "height": _integer(center.get("height"), "altura do centro da fatia", 0, side),
            }
        pivot = item.get("pivot")
        if pivot is not None:
            if not isinstance(pivot, dict):
                raise ValidationError(f"Pivô inválido na fatia '{name}'.")
            pivot = {"x": _integer(pivot.get("x"), "x do pivô da fatia", -side, side), "y": _integer(pivot.get("y"), "y do pivô da fatia", -side, side)}
        slices.append(
            {
                "id": key,
                "name": name,
                "color": normalize_hex(item.get("color") or "#0000ff"),
                "x": _integer(item.get("x"), "x da fatia", -side, side),
                "y": _integer(item.get("y"), "y da fatia", -side, side),
                "width": _integer(item.get("width"), "largura da fatia", 1, side),
                "height": _integer(item.get("height"), "altura da fatia", 1, side),
                "center": center,
                "pivot": pivot,
            }
        )
    return slices


def _validate_21(data, document):
    """Validate the 2.1 additions of `data` and add colorMode, tags, slices and tilesets to the normalized document."""
    color_mode = data.get("colorMode") or "rgba"
    if color_mode not in COLOR_MODES:
        raise ValidationError(f"Modo de cor inválido: {color_mode!r}.")
    document["colorMode"] = color_mode
    tilesets = _validate_tilesets(data)
    by_id = {tileset["id"]: tileset for tileset in tilesets}
    _validate_layer_tree(document["layers"], by_id)
    _validate_cells_21(document, by_id)
    document["tags"] = _validate_tags(data, document)
    document["slices"] = _validate_slices(data)
    document["tilesets"] = tilesets


def _slice_columns(item):
    center = item["center"] or {}
    pivot = item["pivot"] or {}
    return {
        "key": item["id"],
        "name": item["name"],
        "color": item["color"],
        "x": item["x"],
        "y": item["y"],
        "width": item["width"],
        "height": item["height"],
        "center_x": center.get("x"),
        "center_y": center.get("y"),
        "center_width": center.get("width"),
        "center_height": center.get("height"),
        "pivot_x": pivot.get("x"),
        "pivot_y": pivot.get("y"),
    }


def _layer_to_document_21(layer):
    out = {}
    if layer.blend_mode != "normal":
        out["blendMode"] = layer.blend_mode
    if layer.kind != "image":
        out["kind"] = layer.kind
    if layer.parent_key is not None:
        out["parent"] = layer.parent_key
    if layer.collapsed:
        out["collapsed"] = True
    if layer.tileset_key is not None:
        out["tileset"] = layer.tileset_key
    if layer.reference:
        out["reference"] = True
    return out


def _cell_to_document_21(link, tiles):
    out = {}
    if link is not None:
        out["link"] = link
    if tiles is not None:
        out["tiles"] = to_base64(bytes(tiles))
    return out


def _slice_to_document(item):
    return {
        "id": item.key,
        "name": item.name,
        "color": item.color,
        "x": item.x,
        "y": item.y,
        "width": item.width,
        "height": item.height,
        "center": None if item.center_x is None else {"x": item.center_x, "y": item.center_y, "width": item.center_width, "height": item.center_height},
        "pivot": None if item.pivot_x is None else {"x": item.pivot_x, "y": item.pivot_y},
    }


def _add_to_document_21(project, document):
    if project.color_mode != "rgba":
        document["colorMode"] = project.color_mode
    tags = [
        {"id": t.key, "name": t.name, "from": t.from_frame_key, "to": t.to_frame_key, "direction": t.direction, "repeat": t.repeat, "color": t.color}
        for t in project.tags.all()
    ]
    if tags:
        document["tags"] = tags
    slices = [_slice_to_document(item) for item in project.slices.all()]
    if slices:
        document["slices"] = slices
    tilesets = [
        {
            "id": t.key,
            "name": t.name,
            "tileWidth": t.tile_width,
            "tileHeight": t.tile_height,
            "tiles": [to_base64(tile) for tile in split_runs(bytes(t.tiles), t.tile_width * t.tile_height, t.tile_count)],
        }
        for t in project.tilesets.all()
    ]
    if tilesets:
        document["tilesets"] = tilesets


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
        Cell.objects.filter(frame__project=project).values_list("frame_id", "layer_id", "pixels", "link_frame_key", "tiles"),
        key=lambda t: (t[0], t[1]),
    )
    document = {
        "format": "crivo",
        "version": FORMAT_VERSION,
        "name": project.name,
        "width": project.width,
        "height": project.height,
        "fps": project.fps,
        "palette": project.palette,
        "layers": [
            {
                "id": layer.key,
                "name": layer.name,
                "visible": layer.visible,
                "opacity": layer.opacity,
                "locked": layer.locked,
                **_layer_to_document_21(layer),
            }
            for layer in layers
        ],
        "frames": [{"id": frame.key, "duration": frame.duration_ms} for frame in frames],
        "cells": [
            {"frame": frame_keys[f], "layer": layer_keys[la], "rle": to_base64(bytes(px)), **_cell_to_document_21(link, tiles)}
            for f, la, px, link, tiles in cells
        ],
    }
    _add_to_document_21(project, document)
    return document


def _write_content(project, doc):
    project.frames.all().delete()
    project.layers.all().delete()
    project.tags.all().delete()
    project.slices.all().delete()
    project.tilesets.all().delete()
    layers = Layer.objects.bulk_create(
        [
            Layer(
                project=project,
                key=layer["id"],
                position=i,
                name=layer["name"],
                visible=layer["visible"],
                opacity=layer["opacity"],
                locked=layer["locked"],
                blend_mode=layer["blendMode"],
                kind=layer["kind"],
                parent_key=layer["parent"],
                collapsed=layer["collapsed"],
                tileset_key=layer["tileset"],
                reference=layer["reference"],
            )
            for i, layer in enumerate(doc["layers"])
        ]
    )
    frames = Frame.objects.bulk_create(
        [Frame(project=project, key=frame["id"], position=i, duration_ms=frame["duration"]) for i, frame in enumerate(doc["frames"])]
    )
    by_layer = {layer.key: layer for layer in layers}
    by_frame = {frame.key: frame for frame in frames}
    Cell.objects.bulk_create(
        [
            Cell(
                frame=by_frame[cell["frame"]],
                layer=by_layer[cell["layer"]],
                pixels=cell["pixels"],
                size_bytes=len(cell["pixels"]),
                link_frame_key=cell["link"],
                tiles=cell["tiles"],
            )
            for cell in doc["cells"]
        ],
        batch_size=200,
    )
    Tag.objects.bulk_create(
        [
            Tag(
                project=project,
                key=tag["id"],
                position=i,
                name=tag["name"],
                from_frame_key=tag["from"],
                to_frame_key=tag["to"],
                direction=tag["direction"],
                repeat=tag["repeat"],
                color=tag["color"],
            )
            for i, tag in enumerate(doc["tags"])
        ]
    )
    Slice.objects.bulk_create([Slice(project=project, position=i, **_slice_columns(item)) for i, item in enumerate(doc["slices"])])
    Tileset.objects.bulk_create(
        [
            Tileset(
                project=project,
                key=tileset["id"],
                position=i,
                name=tileset["name"],
                tile_width=tileset["tileWidth"],
                tile_height=tileset["tileHeight"],
                tile_count=len(tileset["tiles"]),
                tiles=b"".join(tileset["tiles"]),
            )
            for i, tileset in enumerate(doc["tilesets"])
        ]
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
        color_mode=doc["colorMode"],
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
    project.color_mode = doc["colorMode"]
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
    """Render frames for export: groups, blend modes and opacity applied; hidden and reference layers left out."""
    doc = document_from_db(project)
    total = doc["width"] * doc["height"]
    frames = doc["frames"] if indices is None else [doc["frames"][i] for i in indices]
    wanted = {frame["id"] for frame in frames}
    cells = {}
    for c in doc["cells"]:
        if c["frame"] in wanted:
            cells.setdefault(c["frame"], {})[c["layer"]] = decode(from_base64(c["rle"]), total)
    output = [render_frame(doc["layers"], cells.get(frame["id"], {}), total) for frame in frames]
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
