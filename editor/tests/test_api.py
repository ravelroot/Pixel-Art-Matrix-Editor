import base64
import json
import zlib

from django.conf import settings
from django.test import Client, TestCase, override_settings

from editor import services
from editor.models import Cell, Palette, Project, Revision
from editor.rle import blend, decode, encode, pack, to_base64
from editor.security import WriteLimitMiddleware

RED = pack(255, 0, 0)
BLUE = pack(0, 0, 255)
MINIMAL_PNG = base64.b64encode(
    bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
).decode()


def _pixels(width, height, color):
    pixels = [0] * (width * height)
    pixels[0] = color
    pixels[5] = BLUE
    return pixels


def document(name="Poção", width=4, height=4, color=RED):
    """A .crivo document in format version 2."""
    return {
        "format": "crivo",
        "version": 2,
        "name": name,
        "width": width,
        "height": height,
        "fps": 6,
        "palette": ["#ff0000", "#0000ff"],
        "layers": [{"id": "l1", "name": "Base", "visible": True, "opacity": 100, "locked": False}],
        "frames": [{"id": "f1", "duration": None}, {"id": "f2", "duration": 200}],
        "cells": [{"frame": "f1", "layer": "l1", "rle": to_base64(encode(_pixels(width, height, color)))}],
    }


def document_v1(name="Poção", width=4, height=4, color=RED):
    """The same document in format version 1 (Portuguese keys), as saved by Crivo 1.x."""
    return {
        "formato": "crivo",
        "versao": 1,
        "nome": name,
        "largura": width,
        "altura": height,
        "fps": 6,
        "paleta": ["#ff0000", "#0000ff"],
        "camadas": [{"id": "l1", "nome": "Base", "visivel": True, "opacidade": 100, "bloqueada": False}],
        "quadros": [{"id": "f1", "duracao": None}, {"id": "f2", "duracao": 200}],
        "celulas": [{"quadro": "f1", "camada": "l1", "rle": to_base64(encode(_pixels(width, height, color)))}],
    }


class RLETest(TestCase):
    def test_round_trip(self):
        pixels = [0] * 300 + [RED] * 5000 + [BLUE]
        self.assertEqual(list(decode(encode(pixels), len(pixels))), pixels)

    def test_matches_the_javascript_encoder(self):
        self.assertEqual(encode([RED] * 3), bytes([3, 255, 0, 0, 255]))
        self.assertEqual(encode([0] * 200), bytes([200 & 127 | 128, 1, 0, 0, 0, 0]))

    def test_rejects_wrong_size(self):
        with self.assertRaises(ValueError):
            decode(encode([RED] * 3), 4)

    def test_blend(self):
        self.assertEqual(blend(BLUE, RED, 1), RED)
        self.assertEqual(blend(0, RED, 0), 0)


class ApiTest(TestCase):
    def setUp(self):
        WriteLimitMiddleware.reset()
        self.c = Client()

    def post(self, url, data):
        return self.c.post(url, json.dumps(data), content_type="application/json")

    def put(self, url, data):
        return self.c.put(url, json.dumps(data), content_type="application/json")

    def test_health_and_page(self):
        r = self.c.get("/api/v2/health")
        self.assertEqual(r.json(), {"status": "ok", "version": settings.CRIVO["VERSION"], "database": r.json()["database"]})
        r = self.c.get("/")
        self.assertContains(r, '<base href="/static/editor/">')
        self.assertIn("csrftoken", r.cookies)

    def test_index_lists_the_v2_routes(self):
        for url in ("/api/v2", "/api/v2/"):
            with self.subTest(url=url):
                body = self.c.get(url).json()
                self.assertEqual((body["name"], body["version"]), ("Crivo", settings.CRIVO["VERSION"]))
                self.assertEqual(
                    set(body["routes"]), {"health", "projects", "project", "thumbnail", "export", "png", "revisions", "restore", "palettes", "palette"}
                )
                self.assertTrue(all(route.startswith("/api/v2/") for route in body["routes"].values()))

    def test_api_v1_is_gone(self):
        for url in ("/api/v1", "/api/v1/saude", "/api/v1/projetos", "/api/v1/paletas"):
            with self.subTest(url=url):
                self.assertEqual(self.c.get(url).status_code, 404)

    def test_preset_palettes_seeded(self):
        slugs = {p["slug"] for p in self.c.get("/api/v2/palettes").json()["palettes"]}
        self.assertTrue({"crivo", "game-boy", "nes", "pico-8", "cga"} <= slugs)
        pico = Palette.objects.get(slug="pico-8")
        self.assertTrue(pico.preset)
        self.assertEqual(pico.colors.count(), 16)
        r = self.put(f"/api/v2/palettes/{pico.pk}", {"name": "x", "colors": ["#000000"]})
        self.assertEqual(r.status_code, 403)
        self.assertIn("error", r.json())

    def test_custom_palette(self):
        r = self.post("/api/v2/palettes", {"name": "Minha", "colors": ["#5D1C16", "a3b4be", "#f6e4a6ff"]})
        self.assertEqual(r.status_code, 201)
        p = r.json()
        self.assertEqual(p["colors"], ["#5d1c16", "#a3b4be", "#f6e4a6"])
        self.assertEqual(set(p), {"id", "slug", "name", "description", "preset", "colors", "updated_at"})
        self.assertFalse(p["preset"])
        r = self.put(f"/api/v2/palettes/{p['id']}", {"name": "Minha 2", "colors": ["#000000"]})
        self.assertEqual(r.json()["name"], "Minha 2")
        custom = self.c.get("/api/v2/palettes?presets=0").json()["palettes"]
        self.assertEqual([x["id"] for x in custom], [p["id"]], "presets=0 hides the presets")
        self.assertEqual(self.post("/api/v2/palettes", {"name": "Ruim", "colors": ["verde"]}).status_code, 422)
        self.assertEqual(self.c.delete(f"/api/v2/palettes/{p['id']}").status_code, 204)

    def test_project_lifecycle(self):
        r = self.post("/api/v2/projects", {"data": document(), "thumbnail": "data:image/png;base64," + MINIMAL_PNG})
        self.assertEqual(r.status_code, 201, r.content)
        p = r.json()
        self.assertEqual(set(p), {"id", "name", "width", "height", "fps", "revision", "frames", "layers", "thumbnail_url", "created_at", "updated_at"})
        self.assertEqual((p["width"], p["frames"], p["layers"], p["revision"]), (4, 2, 1, 1))
        self.assertEqual(p["thumbnail_url"], f"/api/v2/projects/{p['id']}/thumbnail")
        self.assertEqual(self.c.get(p["thumbnail_url"])["Content-Type"], "image/png")
        data = self.c.get(f"/api/v2/projects/{p['id']}").json()["data"]
        self.assertEqual((data["format"], data["version"]), ("crivo", 2))
        self.assertEqual(data["frames"][1]["duration"], 200)
        self.assertEqual(data["cells"], document()["cells"])
        projects = self.c.get("/api/v2/projects").json()["projects"]
        self.assertEqual(projects[0]["name"], "Poção")
        self.assertEqual(projects[0]["thumbnail_url"], p["thumbnail_url"])
        self.assertEqual(self.c.get("/api/v2/projects?q=poç").json()["projects"][0]["id"], p["id"])
        self.assertEqual(self.c.get("/api/v2/projects?q=espada").json()["projects"], [])
        r = self.put(f"/api/v2/projects/{p['id']}", {"data": document("Poção 2", color=BLUE), "revision": 1})
        self.assertEqual(r.json()["revision"], 2)
        self.assertEqual(Revision.objects.count(), 1)
        r = self.put(f"/api/v2/projects/{p['id']}", {"data": document("Velho"), "revision": 1})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["current_revision"], 2)
        self.assertIn("error", r.json())
        revisions = self.c.get(f"/api/v2/projects/{p['id']}/revisions").json()
        self.assertEqual(revisions["current_revision"], 2)
        self.assertEqual(set(revisions["revisions"][0]), {"number", "name", "size_bytes", "created_at"})
        self.assertEqual(revisions["revisions"][0]["number"], 1)
        r = self.post(f"/api/v2/projects/{p['id']}/revisions/1/restore", {})
        self.assertEqual(r.json()["name"], "Poção")
        self.assertEqual(r.json()["revision"], 3)
        self.assertEqual(self.c.delete(f"/api/v2/projects/{p['id']}").status_code, 204)
        self.assertEqual(Cell.objects.count(), 0)

    def test_export(self):
        p = self.post("/api/v2/projects", {"data": document("Espada Curta")}).json()
        r = self.c.get(f"/api/v2/projects/{p['id']}/export?format=json&frame=1")
        data = json.loads(r.content)
        self.assertEqual(set(data), {"name", "width", "height", "mode", "transparent", "palette", "frames"})
        self.assertEqual(data["palette"], ["#ff0000", "#0000ff"])
        self.assertEqual(data["frames"][0][0][:2], [0, -1])
        self.assertEqual(data["frames"][0][1][1], 1)
        r = self.c.get(f"/api/v2/projects/{p['id']}/export?format=js&mode=hex")
        self.assertIn("export const espadaCurta", r.content.decode())
        r = self.c.get(f"/api/v2/projects/{p['id']}/export?format=py&download=1")
        self.assertIn("ESPADA_CURTA = {", r.content.decode())
        self.assertIn('    "transparent": -1,', r.content.decode())
        self.assertIn("attachment", r["Content-Disposition"])
        csv = self.c.get(f"/api/v2/projects/{p['id']}/export?format=csv").content.decode()
        self.assertEqual(csv.split("\n")[0], "0,-1,-1,-1")
        self.assertEqual(self.c.get(f"/api/v2/projects/{p['id']}/export?format=bmp").status_code, 400)

    def test_validation(self):
        bad = document()
        bad["cells"][0]["rle"] = to_base64(encode([RED] * 3))
        self.assertEqual(self.post("/api/v2/projects", {"data": bad}).status_code, 422)
        bad = document(width=2000)
        self.assertEqual(self.post("/api/v2/projects", {"data": bad}).status_code, 422)
        bad = document()
        bad["frames"][1]["id"] = "l1"
        self.assertEqual(self.post("/api/v2/projects", {"data": bad}).status_code, 422)
        self.assertEqual(self.post("/api/v2/projects", {"data": document(), "thumbnail": "data:image/gif;base64,AAAA"}).status_code, 422)
        self.assertEqual(self.c.post("/api/v2/projects", "{", content_type="application/json").status_code, 422)
        self.assertEqual(Project.objects.count(), 0)

    def test_csrf_and_token(self):
        client = Client(enforce_csrf_checks=True)
        r = client.post("/api/v2/palettes", json.dumps({"name": "A", "colors": ["#000000"]}), content_type="application/json")
        self.assertEqual(r.status_code, 403)
        client.get("/")
        token = client.cookies["csrftoken"].value
        r = client.post("/api/v2/palettes", json.dumps({"name": "A", "colors": ["#000000"]}), content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 201)
        with override_settings(CRIVO={**settings.CRIVO, "API_TOKEN": "segredo"}):
            other = Client(enforce_csrf_checks=True)
            r = other.post(
                "/api/v2/palettes", json.dumps({"name": "B", "colors": ["#ffffff"]}), content_type="application/json", HTTP_AUTHORIZATION="Bearer segredo"
            )
            self.assertEqual(r.status_code, 201)


class DocumentCompatibilityTest(TestCase):
    """Format version 1 documents (Crivo 1.x) are still accepted, and the API always answers with version 2."""

    def setUp(self):
        WriteLimitMiddleware.reset()
        self.c = Client()

    def post(self, url, data):
        return self.c.post(url, json.dumps(data), content_type="application/json")

    def put(self, url, data):
        return self.c.put(url, json.dumps(data), content_type="application/json")

    def test_upgrade_document_converts_every_v1_key(self):
        v1 = document_v1()
        v1["camadas"][0].update(visivel=False, opacidade=40, bloqueada=True)
        expected = document()
        expected["layers"][0].update(visible=False, opacity=40, locked=True)
        self.assertEqual(services.upgrade_document(v1), expected)
        self.assertEqual(services.upgrade_document(document()), document(), "a v2 document passes through unchanged")
        self.assertEqual(services.upgrade_document([1, 2]), [1, 2], "invalid input is left for validation")

    def test_v1_document_accepted_on_create(self):
        r = self.post("/api/v2/projects", {"data": document_v1("Antigo")})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["name"], "Antigo")
        data = self.c.get(f"/api/v2/projects/{r.json()['id']}").json()["data"]
        self.assertEqual(data, document("Antigo"), "stored and returned as a version 2 document")

    def test_v1_document_accepted_on_update(self):
        pid = self.post("/api/v2/projects", {"data": document()}).json()["id"]
        r = self.put(f"/api/v2/projects/{pid}", {"data": document_v1("Poção 2", color=BLUE), "revision": 1})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.c.get(f"/api/v2/projects/{pid}").json()["data"], document("Poção 2", color=BLUE))

    def test_v1_document_is_still_validated(self):
        bad = document_v1()
        bad["largura"] = 2000
        self.assertEqual(self.post("/api/v2/projects", {"data": bad}).status_code, 422)
        bad = document_v1()
        bad["formato"] = "outro"
        self.assertEqual(self.post("/api/v2/projects", {"data": bad}).status_code, 422)
        self.assertEqual(Project.objects.count(), 0)

    def test_old_v1_revision_is_restored(self):
        pid = self.post("/api/v2/projects", {"data": document("Atual", color=BLUE)}).json()["id"]
        project = Project.objects.get(pk=pid)
        # A revision saved by Crivo 1.x: zlib-compressed JSON of a version 1 document.
        content = zlib.compress(json.dumps(document_v1("Antigo"), separators=(",", ":")).encode("utf-8"), 6)
        Revision.objects.create(project=project, number=0, name="Antigo", content=content, size_bytes=len(content))
        r = self.post(f"/api/v2/projects/{pid}/revisions/0/restore", {})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["name"], r.json()["revision"]), ("Antigo", 2))
        self.assertEqual(self.c.get(f"/api/v2/projects/{pid}").json()["data"], document("Antigo"))
        newest = services.read_revision_document(Revision.objects.get(project=project, number=1))
        self.assertEqual(newest, document("Atual", color=BLUE), "revisions saved from now on hold version 2 documents")

    def test_newer_format_version_is_rejected(self):
        newer = {**document(), "version": 3}
        r = self.post("/api/v2/projects", {"data": newer})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["error"], "Este projeto foi salvo por uma versão mais nova do Crivo.")
        self.assertEqual(Project.objects.count(), 0)
