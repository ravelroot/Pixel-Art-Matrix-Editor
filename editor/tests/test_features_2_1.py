"""Crivo 2.1: document additions (color mode, groups, blend modes, reference layers, linked cels, tags, slices and
tilesets) in the database, the API, the rendering and the 0004 migration."""

import base64
import copy
import json
import random
import struct
import zlib
from array import array
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TestCase, TransactionTestCase

from editor import services
from editor.blend import BLEND_MODES, blend_pixel, render_frame
from editor.models import Layer, Project, Revision, Tag, Tileset
from editor.rle import composite, decode, encode, pack, split_runs, to_base64
from editor.security import WriteLimitMiddleware

from .test_api import document, document_v1

RED = pack(255, 0, 0)
BLUE = pack(0, 0, 255)
EXAMPLE = Path(settings.BASE_DIR) / "examples" / "blend-modes.crivo"


def rgba(text):
    """'#rrggbbaa' as a packed pixel (R in the low byte)."""
    r, g, b, a = (int(text[i : i + 2], 16) for i in (1, 3, 5, 7))
    return pack(r, g, b, a)


def hex_rgba(color):
    return f"#{color & 255:02x}{(color >> 8) & 255:02x}{(color >> 16) & 255:02x}{color >> 24:02x}"


def rle(pixels):
    return to_base64(encode(pixels))


def example():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def full_document():
    """A 4x4 document using every 2.1 addition."""
    return {
        "format": "crivo",
        "version": 2,
        "name": "Recursos 2.1",
        "width": 4,
        "height": 4,
        "fps": 6,
        "palette": ["#ff0000", "#0000ff"],
        "colorMode": "indexed",
        "layers": [
            {"id": "l1", "name": "Base", "visible": True, "opacity": 100, "locked": False},
            {"id": "l2", "name": "Luz", "visible": True, "opacity": 70, "locked": False, "blendMode": "screen", "parent": "g1"},
            {"id": "g1", "name": "Grupo", "visible": True, "opacity": 80, "locked": False, "blendMode": "multiply", "kind": "group", "collapsed": True},
            {"id": "tm", "name": "Mapa", "visible": True, "opacity": 100, "locked": False, "kind": "tilemap", "tileset": "ts1"},
            {"id": "rf", "name": "Referência", "visible": True, "opacity": 100, "locked": True, "reference": True},
        ],
        "frames": [{"id": "f1", "duration": None}, {"id": "f2", "duration": 120}],
        "cells": [
            {"frame": "f1", "layer": "l1", "rle": rle([RED] * 16)},
            {"frame": "f1", "layer": "l2", "rle": rle([BLUE] * 8 + [0] * 8)},
            {"frame": "f1", "layer": "tm", "rle": rle([0] * 16), "tiles": rle([1, 0, 2, 1])},
            {"frame": "f1", "layer": "rf", "rle": rle([BLUE] * 16)},
            {"frame": "f2", "layer": "l1", "rle": rle([RED] * 16), "link": "f1"},
        ],
        "tags": [{"id": "t1", "name": "Andar", "from": "f1", "to": "f2", "direction": "reverse", "repeat": 3, "color": "#ff0000"}],
        "slices": [
            {
                "id": "s1",
                "name": "Botão",
                "color": "#00ff0080",
                "x": 0,
                "y": 1,
                "width": 3,
                "height": 2,
                "center": {"x": 1, "y": 0, "width": 1, "height": 2},
                "pivot": {"x": 1, "y": -1},
            },
            {"id": "s2", "name": "Tudo", "color": "#0000ff", "x": -2, "y": 0, "width": 4, "height": 4, "center": None, "pivot": None},
        ],
        "tilesets": [{"id": "ts1", "name": "Chão", "tileWidth": 2, "tileHeight": 2, "tiles": [rle([0] * 4), rle([RED] * 4), rle([BLUE, 0, 0, BLUE])]}],
    }


def read_png(data):
    """Decode the PNGs written by editor.export.generate_png (8-bit RGBA, one IDAT, filter 0) to packed pixels."""
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    p = 8
    width = height = 0
    idat = b""
    while p < len(data):
        (length,) = struct.unpack(">I", data[p : p + 4])
        kind = data[p + 4 : p + 8]
        body = data[p + 8 : p + 8 + length]
        if kind == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
        elif kind == b"IDAT":
            idat += body
        p += 12 + length
    raw = zlib.decompress(idat)
    stride = 1 + 4 * width
    pixels = []
    for y in range(height):
        row = raw[y * stride + 1 : (y + 1) * stride]
        pixels += [struct.unpack_from("<I", row, 4 * x)[0] for x in range(width)]
    return width, height, pixels


# Composited pixels of examples/blend-modes.crivo: (frame index, x, y, '#rrggbbaa'). The same values are checked by the
# Java tool (tools/java Tests.java); they follow the contract formulas (see editor/blend.py).
EXAMPLE_PIXELS = [
    (0, 15, 0, "#1d2b53ff"),  # only the sky: the reference layer "Esboço" (red diagonals) is left out
    (0, 0, 0, "#113056ff"),  # "Tinta": color 40% over the sky
    (0, 8, 8, "#ffe8b4ff"),  # sun inside the "Luz" group: group screen 90%
    (0, 8, 4, "#ac5653ff"),  # halo: addition 50% inside the group, then group screen 90%
    (0, 4, 13, "#00522fff"),  # "Sombra": multiply 60% over the grass
    (0, 13, 10, "#00af6aff"),  # "Névoa": semi-transparent overlay 75% over the grass
    (0, 8, 10, "#eff289ff"),  # frame 1: sun + mist
    (1, 8, 10, "#7cc16aff"),  # frame 2: the sun moved up, the halo is here now
    (1, 8, 5, "#f2db6bff"),
]

# blend_pixel for every mode: (backdrop, source, opacity) -> '#rrggbbaa' per mode, in BLEND_MODES order.
BLEND_TABLE = [
    (
        "#2878c8b4",
        "#dc3c8cc8",
        0.7,
        "#9a52a2dd #474495dd #9c7bcadd #5650bfdd #4a52a2dd #9a6dbddd #aa7dd5dd #3a37a9dd #8f50bfdd #5d5ebedd "
        "#88527edd #8d6e99dd #954d9ddd #4a6dbddd #954d9ddd #4f72c2dd #aa88d5dd #38527edd #4ca9d5dd",
    ),
    (
        "#00ff80ff",
        "#ff0040ff",
        1.0,
        "#ff0040ff #000020ff #ffffa0ff #00ff41ff #000040ff #ffff80ff #00ffabff #00ff00ff #ff0040ff #00ff60ff "
        "#ffff40ff #ffff80ff #ff789aff #00ff80ff #ff789aff #008141ff #ffffc0ff #00ff40ff #00ffffff",
    ),
]


class Api21TestCase(TestCase):
    def setUp(self):
        WriteLimitMiddleware.reset()
        self.c = Client()

    def post(self, data):
        return self.c.post("/api/v2/projects", json.dumps({"data": data}), content_type="application/json")

    def put(self, pid, data, revision):
        return self.c.put(f"/api/v2/projects/{pid}", json.dumps({"data": data, "revision": revision}), content_type="application/json")

    def get_data(self, pid):
        return self.c.get(f"/api/v2/projects/{pid}").json()["data"]


class DocumentFieldsTest(Api21TestCase):
    def test_every_new_field_round_trips(self):
        r = self.post(full_document())
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["id"]
        self.assertEqual(self.get_data(pid), full_document())
        project = Project.objects.get(pk=pid)
        self.assertEqual(project.color_mode, "indexed")
        group = project.layers.get(key="g1")
        self.assertEqual((group.kind, group.blend_mode, group.collapsed, group.opacity), ("group", "multiply", True, 80))
        self.assertEqual(project.layers.get(key="l2").parent_key, "g1")
        self.assertEqual(project.layers.get(key="tm").tileset_key, "ts1")
        self.assertTrue(project.layers.get(key="rf").reference)
        self.assertEqual(project.tags.get().from_frame_key, "f1")
        self.assertEqual(project.slices.get(key="s1").center_height, 2)
        tileset = Tileset.objects.get(project=project)
        self.assertEqual((tileset.tile_width, tileset.tile_height, tileset.tile_count), (2, 2, 3))
        self.assertEqual(decode(bytes(tileset.tiles), 12).tolist(), [0] * 4 + [RED] * 4 + [BLUE, 0, 0, BLUE])

    def test_update_replaces_the_new_fields_and_revisions_keep_them(self):
        pid = self.post(full_document()).json()["id"]
        changed = full_document()
        changed["tags"][0].update(name="Correr", direction="pingpong", repeat=0, color="#00ff00")
        changed["slices"] = changed["slices"][1:]
        changed["layers"][1]["blendMode"] = "difference"
        changed["colorMode"] = "grayscale"
        r = self.put(pid, changed, 1)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.get_data(pid), changed)
        # Back to a plain 2.0 document: every 2.1 row and key goes away.
        r = self.put(pid, document("Simples"), 2)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.get_data(pid), document("Simples"))
        project = Project.objects.get(pk=pid)
        self.assertEqual((project.tags.count(), project.slices.count(), project.tilesets.count(), project.color_mode), (0, 0, 0, "rgba"))
        # Revisions hold the full document, and restoring brings every field back.
        stored = services.read_revision_document(Revision.objects.get(project=project, number=1))
        self.assertEqual(stored, full_document())
        r = self.c.post(f"/api/v2/projects/{pid}/revisions/1/restore", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.get_data(pid), full_document())

    def test_link_to_an_empty_cel_is_accepted(self):
        # The editor does not write empty cels, so a cel linked to an empty one has no source cel in the file.
        data = full_document()
        data["cells"].append({"frame": "f2", "layer": "l2", "rle": rle([0] * 16), "link": "f3"})
        data["frames"].append({"id": "f3", "duration": None})
        r = self.post(data)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.get_data(r.json()["id"])["cells"][-1], {"frame": "f2", "layer": "l2", "rle": rle([0] * 16), "link": "f3"})

    def test_defaults_are_omitted(self):
        explicit = document()
        explicit.update(colorMode="rgba", tags=[], slices=[], tilesets=[])
        explicit["layers"][0].update(blendMode="normal", kind="image", parent=None, collapsed=False, tileset=None, reference=False)
        explicit["cells"][0].update(link=None)
        pid = self.post(explicit).json()["id"]
        self.assertEqual(self.get_data(pid), document(), "writers omit the defaults")

    def test_v2_0_and_v1_documents_are_unchanged(self):
        pid = self.post(document()).json()["id"]
        self.assertEqual(self.get_data(pid), document())
        pid = self.post(document_v1("Antigo")).json()["id"]
        self.assertEqual(self.get_data(pid), document("Antigo"))
        self.assertEqual(services.upgrade_document(full_document()), full_document(), "2.1 keys pass through the v1 upgrade")

    def test_tileset_runs_crossing_tiles_are_split(self):
        self.assertEqual(split_runs(encode([RED] * 6 + [0] * 2), 4, 2), [encode([RED] * 4), encode([RED] * 2 + [0] * 2)])
        self.assertEqual(split_runs(encode([0] * 300), 100, 3), [encode([0] * 100)] * 3)

    def test_database_constraints(self):
        project = Project.objects.create(name="x", width=2, height=2)
        bad_rows = [
            lambda: Layer.objects.create(project=project, key="a", position=0, name="a", blend_mode="glow"),
            lambda: Layer.objects.create(project=project, key="b", position=1, name="b", kind="vector"),
            lambda: Layer.objects.create(project=project, key="c", position=2, name="c", parent_key="c"),
            lambda: Layer.objects.create(project=project, key="d", position=3, name="d", tileset_key="ts"),
            lambda: Tag.objects.create(project=project, key="t", position=0, name="t", from_frame_key="f", to_frame_key="f", direction="up"),
            lambda: Tag.objects.create(project=project, key="t", position=0, name="t", from_frame_key="f", to_frame_key="f", color="#FFF"),
            lambda: Tileset.objects.create(project=project, key="s", position=0, name="s", tile_width=0, tile_height=8, tile_count=1, tiles=b""),
            lambda: Project.objects.create(name="y", width=2, height=2, color_mode="cmyk"),
        ]
        for i, create in enumerate(bad_rows):
            with self.subTest(row=i), self.assertRaises(IntegrityError), transaction.atomic():
                create()


class ValidationTest(Api21TestCase):
    def mutate(self, change):
        data = full_document()
        change(data)
        return data

    def test_errors_are_in_portuguese(self):
        def tags(n):
            return [{"id": f"t{i}", "name": "x", "from": "f1", "to": "f1"} for i in range(n)]

        def cycle(d):
            d["layers"][2]["parent"] = "g2"
            d["layers"].append({"id": "g2", "name": "Outro", "kind": "group", "parent": "g1"})

        cases = [
            (lambda d: d.update(colorMode="cmyk"), "Modo de cor inválido: 'cmyk'."),
            (lambda d: d["layers"][0].update(blendMode="glow"), "Modo de mesclagem inválido na camada 'Base': 'glow'."),
            (lambda d: d["layers"][0].update(kind="vector"), "Tipo de camada inválido na camada 'Base': 'vector'."),
            (lambda d: d["layers"][1].update(parent="nada"), "A camada 'Luz' está dentro de um grupo que não existe."),
            (lambda d: d["layers"][1].update(parent="l1"), "A camada 'Luz' só pode ficar dentro de uma camada de grupo."),
            (lambda d: d["layers"][2].update(parent="g1"), "Os grupos de camadas formam um ciclo."),
            (cycle, "Os grupos de camadas formam um ciclo."),
            (lambda d: d["layers"][3].pop("tileset"), "A camada de tiles 'Mapa' precisa de um conjunto de tiles que exista."),
            (lambda d: d["layers"][0].update(tileset="ts1"), "A camada 'Base' não é uma camada de tiles."),
            (lambda d: d["cells"][4].update(link="f9"), "Célula vinculada aponta para um quadro que não existe."),
            (lambda d: d["cells"][1].update(link="f1"), "Célula vinculada precisa apontar para uma célula com pixels próprios da mesma camada."),
            (lambda d: d["cells"][4].update(link="f2"), "Célula vinculada precisa apontar para uma célula com pixels próprios da mesma camada."),
            (lambda d: d["cells"][0].update(link="f2"), "Célula vinculada precisa apontar para uma célula com pixels próprios da mesma camada."),
            (lambda d: d["cells"][0].update(tiles=rle([0])), "Só células de camadas de tiles guardam tiles."),
            (lambda d: d["cells"][2].update(tiles=rle([1, 0, 2])), "Tiles inválidos: RLE menor que a matriz"),
            (lambda d: d["cells"][2].update(tiles=rle([1, 0, 2, 3])), "Célula aponta para um tile que não existe."),
            (lambda d: d.update(tags=tags(257)), "O projeto pode ter no máximo 256 tags."),
            (lambda d: d.update(tags=tags(2) + tags(1)), "Identificadores repetidos entre as tags."),
            (lambda d: d["tags"][0].update(to="f9"), "A tag 'Andar' aponta para um quadro que não existe."),
            (lambda d: d["tags"][0].update({"from": "f2", "to": "f1"}), "A tag 'Andar' termina antes de começar."),
            (lambda d: d["tags"][0].update(direction="sideways"), "Direção inválida na tag 'Andar': 'sideways'."),
            (lambda d: d["tags"][0].update(repeat=70000), "repetições da tag precisa ficar entre 0 e 65535."),
            (lambda d: d["tags"][0].update(color="#ff000080"), "A cor da tag não pode ser transparente."),
            (lambda d: d.update(slices=[{"id": f"s{i}", "x": 0, "y": 0, "width": 1, "height": 1} for i in range(257)]), "O projeto pode ter no máximo 256 fatias."),
            (lambda d: d["slices"][0].update(width=0), "largura da fatia precisa ficar entre 1 e 1024."),
            (lambda d: d["slices"][0]["center"].update(width="x"), "largura do centro da fatia precisa ser um número inteiro."),
            (lambda d: d["slices"][0].update(pivot=[1, 2]), "Pivô inválido na fatia 'Botão'."),
            (lambda d: d.update(tilesets=d["tilesets"] * 33), "O projeto pode ter no máximo 32 conjuntos de tiles."),
            (lambda d: d["tilesets"][0].update(tiles=[rle([0] * 4)] * 4097), "O conjunto de tiles 'Chão' precisa de 1 a 4096 tiles."),
            (lambda d: d["tilesets"][0].update(tiles=[]), "O conjunto de tiles 'Chão' precisa de 1 a 4096 tiles."),
            (lambda d: d["tilesets"][0].update(tileWidth=300), "largura do tile precisa ficar entre 1 e 256."),
            (lambda d: d["tilesets"][0]["tiles"].append(rle([RED] * 3)), "Tiles inválidos no conjunto 'Chão': RLE menor que a matriz"),
            (lambda d: d["tilesets"][0]["tiles"].append(rle([RED] * 5)), "Tiles inválidos no conjunto 'Chão': RLE maior que a matriz"),
            (lambda d: d.update(tilesets=d["tilesets"] * 2), "Identificadores repetidos entre os conjuntos de tiles."),
        ]
        for i, (change, message) in enumerate(cases):
            with self.subTest(case=i, message=message):
                r = self.post(self.mutate(change))
                self.assertEqual(r.status_code, 422, r.content)
                self.assertEqual(r.json()["error"], message)
        self.assertEqual(Project.objects.count(), 0)


class RenderingTest(Api21TestCase):
    def render(self, data, frame=0):
        total = data["width"] * data["height"]
        frame_id = data["frames"][frame]["id"]
        cells = {c["layer"]: decode(base64.b64decode(c["rle"]), total) for c in data["cells"] if c["frame"] == frame_id}
        return render_frame(data["layers"], cells, total)

    def pixel(self, data, x, y, frame=0):
        return hex_rgba(self.render(data, frame)[y * data["width"] + x])

    def test_example_pixels_through_the_png_endpoint(self):
        pid = self.post(example()).json()["id"]
        for frame in (0, 1):
            r = self.c.get(f"/api/v2/projects/{pid}/png?frame={frame + 1}")
            self.assertEqual(r.status_code, 200)
            width, height, pixels = read_png(r.content)
            self.assertEqual((width, height), (16, 16))
            for f, x, y, expected in EXAMPLE_PIXELS:
                if f == frame:
                    with self.subTest(frame=f, x=x, y=y):
                        self.assertEqual(hex_rgba(pixels[y * 16 + x]), expected)

    def test_export_uses_the_same_rendering(self):
        pid = self.post(example()).json()["id"]
        data = json.loads(self.c.get(f"/api/v2/projects/{pid}/export?format=json&mode=hex&frame=1").content)
        self.assertEqual(data["frames"][0][0][0], "#113056")
        self.assertEqual(data["frames"][0][0][15], "#1d2b53", "the reference layer is not exported")
        self.assertNotIn("#ff004d", data["palette"])
        _, frames = services.composite_pixels(Project.objects.get(pk=pid))
        for f, x, y, expected in EXAMPLE_PIXELS:
            self.assertEqual(hex_rgba(frames[f][y * 16 + x]), expected)

    def test_blend_modes_table(self):
        self.assertEqual(len(BLEND_MODES), 19)
        for backdrop, source, opacity, row in BLEND_TABLE:
            for mode, expected in zip(BLEND_MODES, row.split(), strict=True):
                with self.subTest(mode=mode, backdrop=backdrop):
                    self.assertEqual(hex_rgba(blend_pixel(rgba(backdrop), rgba(source), opacity, mode)), expected)

    def test_blend_edge_cases(self):
        self.assertEqual(blend_pixel(0, 0, 1.0, "multiply"), 0, "both transparent stays transparent")
        self.assertEqual(blend_pixel(rgba("#336699ff"), rgba("#ffffff00"), 1.0, "screen"), rgba("#336699ff"), "a transparent source keeps the backdrop")
        self.assertEqual(blend_pixel(0, rgba("#336699ff"), 0.5, "difference"), rgba("#33669980"), "over nothing, every mode is a plain overlay")

    def test_group_visibility_opacity_and_blend(self):
        doc = example()
        self.assertEqual(self.pixel(doc, 8, 8), "#ffe8b4ff")
        hidden = copy.deepcopy(doc)
        hidden["layers"][3]["visible"] = False
        self.assertEqual((self.pixel(hidden, 8, 8), self.pixel(hidden, 8, 4)), ("#ff77a8ff", "#7e2553ff"), "a hidden group hides its children")
        half = copy.deepcopy(doc)
        half["layers"][3]["opacity"] = 50
        self.assertEqual(self.pixel(half, 8, 8), "#ffb6afff")
        transparent = copy.deepcopy(doc)
        transparent["layers"][3]["opacity"] = 0
        self.assertEqual(self.pixel(transparent, 8, 8), "#ff77a8ff")
        normal = copy.deepcopy(doc)
        normal["layers"][3].update(blendMode="normal", opacity=100)
        self.assertEqual(self.pixel(normal, 8, 8), "#ffec27ff")
        child_hidden = copy.deepcopy(doc)
        child_hidden["layers"][1]["visible"] = False
        self.assertEqual(self.pixel(child_hidden, 8, 8), "#ff77a8ff")

    def test_reference_layers_are_left_out(self):
        doc = example()
        self.assertEqual(self.pixel(doc, 15, 0), "#1d2b53ff")
        drawn = copy.deepcopy(doc)
        drawn["layers"][7]["reference"] = False
        self.assertEqual(self.pixel(drawn, 15, 0), "#ff004dff")
        total = 256
        cells = {c["layer"]: decode(base64.b64decode(c["rle"]), total) for c in doc["cells"] if c["frame"] == "q1"}
        self.assertEqual(hex_rgba(render_frame(doc["layers"], cells, total, include_reference=True)[15]), "#ff004dff")

    def test_reference_group_hides_its_children(self):
        doc = example()
        doc["layers"][3]["reference"] = True
        self.assertEqual(self.pixel(doc, 8, 8), "#ff77a8ff")

    def test_normal_mode_is_bit_identical_to_2_0(self):
        rng = random.Random(21)  # noqa: S311 - test data, not security
        total = 64
        layers, cells, old = [], {}, []
        for i in range(6):
            pixels = array("I", [pack(rng.randrange(256), rng.randrange(256), rng.randrange(256), rng.choice([0, 1, 90, 128, 254, 255])) for _ in range(total)])
            opacity = rng.choice([0, 13, 50, 99, 100])
            visible = i != 3
            layers.append({"id": f"l{i}", "name": "x", "visible": visible, "opacity": opacity})
            cells[f"l{i}"] = pixels
            if visible:
                old.append((pixels, opacity / 100))
        self.assertEqual(render_frame(layers, cells, total).tolist(), composite(8, 8, old).tolist())


class BlendParityTest(Api21TestCase):
    """tests/fixtures/blend-parity.json: documents written by the editor with its own composite (the reference
    renderer) as the expected pixels. Regenerate with node tests/js/fixtures/make_blend_fixtures.mjs."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        fixture = Path(settings.BASE_DIR) / "tests" / "fixtures" / "blend-parity.json"
        cls.documents = json.loads(fixture.read_text(encoding="utf-8"))["documents"]

    def test_every_pixel_matches_the_editor(self):
        self.assertGreaterEqual(len(self.documents), 30)
        for n, item in enumerate(self.documents):
            data = item["data"]
            with self.subTest(document=n + 1):
                services.validate_document(data)  # the server accepts what the editor writes
                total = data["width"] * data["height"]
                frame = data["frames"][0]["id"]
                cells = {c["layer"]: decode(base64.b64decode(c["rle"]), total) for c in data["cells"] if c["frame"] == frame}
                self.assertEqual([hex_rgba(c) for c in render_frame(data["layers"], cells, total)], item["expected"])

    def test_png_endpoint_matches_the_editor(self):
        for item in self.documents[:5]:
            pid = self.post(item["data"]).json()["id"]
            _, _, pixels = read_png(self.c.get(f"/api/v2/projects/{pid}/png?frame=1").content)
            self.assertEqual([hex_rgba(c) for c in pixels], item["expected"])

    def test_normal_rounding_matches_math_round(self):
        # 150 / 255 * 0.35 * 255 is 52.5: Math.round gives 53 where Python's round would give 52.
        self.assertEqual(blend_pixel(0, rgba("#8f3eac96"), 0.35, "normal") >> 24, 53)


class FeatureMigrationTest(TransactionTestCase):
    """Projects saved by Crivo 2.0 (schema 0003) survive 0004_aseprite_features and read exactly as before."""

    serialized_rollback = True
    BEFORE = [("editor", "0003_english_schema")]
    AFTER = [("editor", "0004_aseprite_features")]

    @staticmethod
    def migrate(targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        executor.loader.build_graph()
        return executor.loader.project_state(targets).apps

    def setUp(self):
        WriteLimitMiddleware.reset()
        old = self.migrate(self.BEFORE)
        project = old.get_model("editor", "Project").objects.create(name="Poção", width=4, height=4, fps=6, revision=2, palette=["#ff0000"])
        layer = old.get_model("editor", "Layer").objects.create(project=project, key="l1", position=0, name="Base", visible=False, opacity=80, locked=True)
        frame = old.get_model("editor", "Frame").objects.create(project=project, key="f1", position=0, duration_ms=200)
        pixels = encode([RED] + [0] * 15)
        old.get_model("editor", "Cell").objects.create(frame=frame, layer=layer, pixels=pixels, size_bytes=len(pixels))
        content = zlib.compress(json.dumps(document("Antes"), separators=(",", ":")).encode("utf-8"), 6)
        old.get_model("editor", "Revision").objects.create(project=project, number=1, name="Antes", content=content, size_bytes=len(content))
        self.project_id = project.pk

    def tearDown(self):
        self.migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())

    def test_rows_survive_with_defaults(self):
        new = self.migrate(self.AFTER)
        project = new.get_model("editor", "Project").objects.get(pk=self.project_id)
        self.assertEqual((project.name, project.revision, project.color_mode), ("Poção", 2, "rgba"))
        layer = project.layers.get()
        self.assertEqual(
            (layer.key, layer.visible, layer.opacity, layer.locked, layer.blend_mode, layer.kind, layer.parent_key, layer.collapsed, layer.tileset_key, layer.reference),
            ("l1", False, 80, True, "normal", "image", None, False, None, False),
        )
        cell = new.get_model("editor", "Cell").objects.get(frame__project=project)
        self.assertEqual((bytes(cell.pixels), cell.link_frame_key, cell.tiles), (encode([RED] + [0] * 15), None, None))
        self.assertEqual((project.tags.count(), project.slices.count(), project.tilesets.count()), (0, 0, 0))

        c = Client()
        data = c.get(f"/api/v2/projects/{self.project_id}").json()["data"]
        self.assertEqual(
            data,
            {
                "format": "crivo",
                "version": 2,
                "name": "Poção",
                "width": 4,
                "height": 4,
                "fps": 6,
                "palette": ["#ff0000"],
                "layers": [{"id": "l1", "name": "Base", "visible": False, "opacity": 80, "locked": True}],
                "frames": [{"id": "f1", "duration": 200}],
                "cells": [{"frame": "f1", "layer": "l1", "rle": to_base64(encode([RED] + [0] * 15))}],
            },
        )
        r = c.post(f"/api/v2/projects/{self.project_id}/revisions/1/restore", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(c.get(f"/api/v2/projects/{self.project_id}").json()["data"], document("Antes"))

        # And back: unapplying 0004 keeps the 2.0 rows.
        old = self.migrate(self.BEFORE)
        layer = old.get_model("editor", "Layer").objects.get(project_id=self.project_id)
        self.assertEqual((layer.key, layer.name, layer.opacity), ("l1", "Base", 100), "the restored 2.0 revision")
        self.assertEqual(old.get_model("editor", "Project").objects.get(pk=self.project_id).name, "Antes")
