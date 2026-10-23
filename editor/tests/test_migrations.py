import base64
import json
import zlib

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TransactionTestCase

from editor.rle import encode, pack, to_base64
from editor.security import WriteLimitMiddleware

from .test_api import MINIMAL_PNG

PORTUGUESE_SCHEMA = [("editor", "0002_paletas_predefinidas")]
ENGLISH_SCHEMA = [("editor", "0003_english_schema")]

RED = pack(255, 0, 0)
BLUE = pack(0, 0, 255)
PIXELS = [RED] + [0] * 4 + [BLUE] + [0] * 10
PNG_BYTES = base64.b64decode(MINIMAL_PNG)


def _migrate(targets):
    """Migrate the test database and return the historical models at `targets`."""
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    executor.loader.build_graph()
    return executor.loader.project_state(targets).apps


def _latest():
    return MigrationExecutor(connection).loader.graph.leaf_nodes()


class EnglishSchemaMigrationTest(TransactionTestCase):
    """Data saved by Crivo 1.x (Portuguese schema up to 0002) survives 0003_english_schema."""

    serialized_rollback = True

    def setUp(self):
        WriteLimitMiddleware.reset()
        old = _migrate(PORTUGUESE_SCHEMA)
        Projeto = old.get_model("editor", "Projeto")
        Camada = old.get_model("editor", "Camada")
        Quadro = old.get_model("editor", "Quadro")
        Celula = old.get_model("editor", "Celula")
        Revisao = old.get_model("editor", "Revisao")
        Paleta = old.get_model("editor", "Paleta")
        CorPaleta = old.get_model("editor", "CorPaleta")

        self.preset_count = Paleta.objects.filter(predefinida=True).count()
        projeto = Projeto.objects.create(nome="Poção", largura=4, altura=4, fps=6, revisao=2, paleta=["#ff0000", "#0000ff"], miniatura=PNG_BYTES)
        camada = Camada.objects.create(projeto=projeto, chave="c1", posicao=0, nome="Base", visivel=False, opacidade=80, bloqueada=True)
        quadro = Quadro.objects.create(projeto=projeto, chave="q1", posicao=0, duracao_ms=None)
        Quadro.objects.create(projeto=projeto, chave="q2", posicao=1, duracao_ms=200)
        pixels = encode(PIXELS)
        Celula.objects.create(quadro=quadro, camada=camada, pixels=pixels, tamanho_bytes=len(pixels))
        # Revision content as Crivo 1.x stored it: zlib-compressed JSON of a format version 1 document.
        self.old_document = {
            "formato": "crivo",
            "versao": 1,
            "nome": "Poção antiga",
            "largura": 4,
            "altura": 4,
            "fps": 12,
            "paleta": ["#0000ff"],
            "camadas": [{"id": "c1", "nome": "Fundo", "visivel": True, "opacidade": 50, "bloqueada": False}],
            "quadros": [{"id": "q1", "duracao": 300}],
            "celulas": [{"quadro": "q1", "camada": "c1", "rle": to_base64(encode([BLUE] * 16))}],
        }
        content = zlib.compress(json.dumps(self.old_document, separators=(",", ":")).encode("utf-8"), 6)
        Revisao.objects.create(projeto=projeto, numero=1, nome="Poção antiga", conteudo=content, tamanho_bytes=len(content))
        minha = Paleta.objects.create(nome="Minha", descricao="Teste", predefinida=False)
        CorPaleta.objects.create(paleta=minha, posicao=0, hex="#123456")
        CorPaleta.objects.create(paleta=minha, posicao=1, hex="#abcdef80")
        self.project_id = projeto.pk
        self.created_at = projeto.criado_em
        self.palette_id = minha.pk

    def tearDown(self):
        _migrate(_latest())

    def test_rows_survive_with_english_names(self):
        new = _migrate(ENGLISH_SCHEMA)
        Project = new.get_model("editor", "Project")
        Cell = new.get_model("editor", "Cell")
        Palette = new.get_model("editor", "Palette")

        project = Project.objects.get(pk=self.project_id)
        self.assertEqual(
            (project.name, project.width, project.height, project.fps, project.revision, project.palette),
            ("Poção", 4, 4, 6, 2, ["#ff0000", "#0000ff"]),
        )
        self.assertEqual(project.format_version, 2, "0003 marks existing projects as format version 2")
        self.assertEqual(bytes(project.thumbnail), PNG_BYTES)
        self.assertEqual(project.created_at, self.created_at)
        layer = project.layers.get()
        self.assertEqual((layer.key, layer.position, layer.name, layer.visible, layer.opacity, layer.locked), ("c1", 0, "Base", False, 80, True))
        self.assertEqual([(f.key, f.position, f.duration_ms) for f in project.frames.order_by("position")], [("q1", 0, None), ("q2", 1, 200)])
        cell = Cell.objects.get(frame__project=project)
        self.assertEqual((cell.frame.key, cell.layer.key, cell.encoding, cell.size_bytes), ("q1", "c1", "rle-rgba", len(encode(PIXELS))))
        self.assertEqual(bytes(cell.pixels), encode(PIXELS))
        self.assertEqual(list(layer.cells.all()), [cell])
        revision = project.revisions.get()
        self.assertEqual((revision.number, revision.name), (1, "Poção antiga"))
        self.assertEqual(json.loads(zlib.decompress(bytes(revision.content))), self.old_document, "stored revisions are kept as they were")
        palette = Palette.objects.get(pk=self.palette_id)
        self.assertEqual((palette.name, palette.description, palette.preset), ("Minha", "Teste", False))
        self.assertEqual([(c.position, c.hex) for c in palette.colors.order_by("position")], [(0, "#123456"), (1, "#abcdef80")])
        self.assertEqual(Palette.objects.filter(preset=True).count(), self.preset_count)
        self.assertGreater(self.preset_count, 0)

        # And back: unapplying 0003 restores the 1.x schema with the same rows.
        old = _migrate(PORTUGUESE_SCHEMA)
        projeto = old.get_model("editor", "Projeto").objects.get(pk=self.project_id)
        self.assertEqual((projeto.nome, projeto.largura, projeto.versao_formato, projeto.revisao), ("Poção", 4, 1, 2))
        self.assertEqual(projeto.camadas.get().opacidade, 80)
        self.assertEqual(old.get_model("editor", "Celula").objects.get(quadro__projeto=projeto).tamanho_bytes, len(encode(PIXELS)))

    def test_api_reads_migrated_project_and_restores_old_revision(self):
        _migrate(_latest())
        c = Client()
        body = c.get(f"/api/v2/projects/{self.project_id}").json()
        self.assertEqual((body["name"], body["revision"], body["frames"], body["layers"]), ("Poção", 2, 2, 1))
        self.assertEqual(body["thumbnail_url"], f"/api/v2/projects/{self.project_id}/thumbnail")
        self.assertEqual(
            body["data"],
            {
                "format": "crivo",
                "version": 2,
                "name": "Poção",
                "width": 4,
                "height": 4,
                "fps": 6,
                "palette": ["#ff0000", "#0000ff"],
                "layers": [{"id": "c1", "name": "Base", "visible": False, "opacity": 80, "locked": True}],
                "frames": [{"id": "q1", "duration": None}, {"id": "q2", "duration": 200}],
                "cells": [{"frame": "q1", "layer": "c1", "rle": to_base64(encode(PIXELS))}],
            },
        )
        r = c.post(f"/api/v2/projects/{self.project_id}/revisions/1/restore", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["name"], r.json()["revision"], r.json()["fps"]), ("Poção antiga", 3, 12))
        data = c.get(f"/api/v2/projects/{self.project_id}").json()["data"]
        self.assertEqual(data["layers"], [{"id": "c1", "name": "Fundo", "visible": True, "opacity": 50, "locked": False}])
        self.assertEqual(data["frames"], [{"id": "q1", "duration": 300}])
        self.assertEqual(data["cells"], [{"frame": "q1", "layer": "c1", "rle": to_base64(encode([BLUE] * 16))}])
        palettes = c.get("/api/v2/palettes?presets=0").json()["palettes"]
        self.assertEqual([(p["name"], p["colors"]) for p in palettes], [("Minha", ["#123456", "#abcdef80"])])
