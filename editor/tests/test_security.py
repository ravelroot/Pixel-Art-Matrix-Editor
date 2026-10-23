import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

from django.conf import settings
from django.test import Client, TestCase, override_settings

from editor import export
from editor.models import Project
from editor.rle import pack
from editor.security import WriteLimitMiddleware

from .test_api import BLUE, MINIMAL_PNG, RED, document

ROOT = Path(__file__).resolve().parents[2]


class CleanTestCase(TestCase):
    """Resets the write limit counter before each test, so one test does not use up another's quota."""

    def setUp(self):
        WriteLimitMiddleware.reset()


def crivo(**extra):
    return {**settings.CRIVO, **extra}


def read_png(data):
    """Minimal decoder for unfiltered 8-bit RGBA PNGs, only to check the server output."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    width = height = None
    idat = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length : pos + 12 + length])
        assert crc == zlib.crc32(kind + body) & 0xFFFFFFFF, "invalid CRC"
        if kind == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    row = 1 + width * 4
    return width, height, [raw[y * row + 1 : (y + 1) * row] for y in range(height)]


class HeadersTest(CleanTestCase):
    def test_security_headers_on_the_page_and_the_api(self):
        c = Client()
        for url in ("/", "/api/v2", "/api/v2/health", "/api/v2/projects"):
            r = c.get(url)
            with self.subTest(url=url):
                csp = r["Content-Security-Policy"]
                for directive in ("default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"):
                    self.assertIn(directive, csp)
                self.assertNotIn("unsafe-eval", csp)
                self.assertEqual(r["X-Frame-Options"], "DENY")
                self.assertEqual(r["X-Content-Type-Options"], "nosniff")
                self.assertEqual(r["Referrer-Policy"], "same-origin")
                self.assertEqual(r["Cross-Origin-Opener-Policy"], "same-origin")
                self.assertIn("camera=()", r["Permissions-Policy"])
        self.assertEqual(c.get("/api/v2/projects")["Cache-Control"], "no-store")

    def test_csrf_cookie_is_strict(self):
        r = Client().get("/")
        self.assertEqual(r.cookies["csrftoken"]["samesite"], "Strict")

    def test_hsts_only_with_https(self):
        r = Client().get("/api/v2/health")
        self.assertNotIn("Strict-Transport-Security", r)
        with override_settings(SECURE_HSTS_SECONDS=31536000):
            r = Client().get("/api/v2/health", secure=True)
            self.assertEqual(r["Strict-Transport-Security"], "max-age=31536000")


class AuthenticationTest(CleanTestCase):
    def test_write_without_csrf_or_token_is_denied(self):
        c = Client(enforce_csrf_checks=True)
        for method, url in (("post", "/api/v2/projects"), ("post", "/api/v2/palettes")):
            r = getattr(c, method)(url, json.dumps({"data": document()}), content_type="application/json")
            self.assertEqual(r.status_code, 403)
        self.assertEqual(Project.objects.count(), 0)

    def test_wrong_or_malformed_token_does_not_pass(self):
        with override_settings(CRIVO=crivo(API_TOKEN="segredo-correto")):
            c = Client(enforce_csrf_checks=True)
            for header in ("Bearer segredo-errado", "Bearer ", "segredo-correto", "Basic segredo-correto", "Bearer segredo-corret"):
                r = c.post("/api/v2/palettes", json.dumps({"name": "X", "colors": ["#000000"]}), content_type="application/json", HTTP_AUTHORIZATION=header)
                with self.subTest(header=header):
                    self.assertEqual(r.status_code, 403)

    def test_empty_token_never_passes(self):
        with override_settings(CRIVO=crivo(API_TOKEN="")):
            c = Client(enforce_csrf_checks=True)
            r = c.post("/api/v2/palettes", json.dumps({"name": "X", "colors": ["#000000"]}), content_type="application/json", HTTP_AUTHORIZATION="Bearer ")
            self.assertEqual(r.status_code, 403)

    def test_token_does_not_apply_outside_the_api(self):
        with override_settings(CRIVO=crivo(API_TOKEN="segredo")):
            r = Client(enforce_csrf_checks=True).post("/", HTTP_AUTHORIZATION="Bearer segredo")
            self.assertIn(r.status_code, (403, 405))


class MaliciousInputTest(CleanTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client()

    def post(self, url, body):
        return self.c.post(url, body if isinstance(body, str) else json.dumps(body), content_type="application/json")

    def test_deeply_nested_json_does_not_crash_the_server(self):
        bomb = "[" * 100000 + "]" * 100000
        r = self.post("/api/v2/projects", '{"data": ' + bomb + "}")
        self.assertEqual(r.status_code, 422)
        self.assertIn("error", r.json())

    def test_body_that_is_not_an_object(self):
        for body in ("[]", "123", '"texto"', "null"):
            with self.subTest(body=body):
                self.assertEqual(self.post("/api/v2/projects", body).status_code, 422)

    def test_body_too_large(self):
        with override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=1024):
            r = self.post("/api/v2/projects", {"data": document(), "junk": "x" * 4096})
            self.assertEqual(r.status_code, 413)

    def test_fake_thumbnail_is_rejected(self):
        fakes = [
            "data:image/svg+xml;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode(),
            base64.b64encode(b"<html><script>alert(1)</script></html>").decode(),
            "nao-e-base64!!!",
            base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (600 * 1024)).decode(),
        ]
        for thumbnail in fakes:
            with self.subTest(thumbnail=thumbnail[:30]):
                self.assertEqual(self.post("/api/v2/projects", {"data": document(), "thumbnail": thumbnail}).status_code, 422)
        self.assertEqual(Project.objects.count(), 0)

    def test_document_limits(self):
        cases = [
            {**document(), "width": 1025},
            {**document(), "height": 0},
            {**document(), "width": "16; DROP TABLE project"},
            {**document(), "fps": 999},
            {**document(), "layers": [{"id": f"l{i}", "name": "x"} for i in range(65)]},
            {**document(), "frames": []},
            {**document(), "format": "outro"},
        ]
        for data in cases:
            with self.subTest(data={k: str(v)[:20] for k, v in data.items() if k in ("width", "height", "fps", "format")}):
                self.assertEqual(self.post("/api/v2/projects", {"data": data}).status_code, 422)
        self.assertEqual(Project.objects.count(), 0)

    def test_corrupted_rle(self):
        data = document()
        data["cells"][0]["rle"] = base64.b64encode(b"\xff\xff\xff\xff\xff\xff").decode()
        self.assertIn(self.post("/api/v2/projects", {"data": data}).status_code, (400, 422))
        self.assertEqual(Project.objects.count(), 0)

    def test_name_with_html_comes_back_as_text_and_safe_file_name(self):
        name = '<img src=x onerror=alert(1)>"; rm -rf /'
        r = self.post("/api/v2/projects", {"data": document(name=name)})
        self.assertEqual(r.status_code, 201)
        pid = r.json()["id"]
        self.assertEqual(r["Content-Type"], "application/json")
        self.assertEqual(self.c.get(f"/api/v2/projects/{pid}").json()["name"], name)
        for url in (f"/api/v2/projects/{pid}/export?format=py&download=1", f"/api/v2/projects/{pid}/png?download=1"):
            disposition = self.c.get(url)["Content-Disposition"]
            file_name = disposition.split('filename="', 1)[1].rstrip('"')
            with self.subTest(url=url):
                self.assertRegex(file_name, r"^[A-Za-z0-9_\-]+\.(py|png)$")

    def test_invalid_ids_and_parameters(self):
        self.assertEqual(self.c.get("/api/v2/projects/123").status_code, 404)
        self.assertEqual(self.c.get("/api/v2/projects/00000000-0000-0000-0000-000000000000").status_code, 404)
        pid = self.post("/api/v2/projects", {"data": document()}).json()["id"]
        for query in ("format=exe", "mode=binario", "frame=-1", "frame=abc", "frame=99", "frame=todos"):
            with self.subTest(query=query):
                self.assertEqual(self.c.get(f"/api/v2/projects/{pid}/export?{query}").status_code, 400)
        for query in ("scale=0", "scale=33", "scale=-2", "frame=0", "frame=x"):
            with self.subTest(query=query):
                self.assertEqual(self.c.get(f"/api/v2/projects/{pid}/png?{query}").status_code, 400)

    def test_methods_not_allowed(self):
        self.assertEqual(self.c.delete("/api/v2/health").status_code, 405)
        self.assertEqual(self.c.post("/api/v2/projects/00000000-0000-0000-0000-000000000000/thumbnail").status_code, 405)


class WriteLimitTest(CleanTestCase):
    def test_limit_per_minute(self):
        with override_settings(CRIVO=crivo(WRITE_LIMIT=3)):
            c = Client()
            body = json.dumps({"name": "A", "colors": ["#000000"]})
            codes = [c.post("/api/v2/palettes", body, content_type="application/json").status_code for _ in range(5)]
            self.assertEqual(codes, [201, 201, 201, 429, 429])
            r = c.post("/api/v2/palettes", body, content_type="application/json")
            self.assertGreaterEqual(int(r["Retry-After"]), 1)
            self.assertEqual(set(r.json()), {"error", "retry_after_seconds"})
            self.assertEqual(r.json()["retry_after_seconds"], int(r["Retry-After"]))
            self.assertEqual(c.get("/api/v2/palettes").status_code, 200, "reads do not count towards the limit")
            other = Client(REMOTE_ADDR="10.0.0.9")
            self.assertEqual(other.post("/api/v2/palettes", body, content_type="application/json").status_code, 201, "the limit is per IP")

    def test_request_refused_by_csrf_does_not_use_the_quota(self):
        with override_settings(CRIVO=crivo(WRITE_LIMIT=2)):
            forged = Client(enforce_csrf_checks=True)
            body = json.dumps({"name": "A", "colors": ["#000000"]})
            for _ in range(5):
                self.assertEqual(forged.post("/api/v2/palettes", body, content_type="application/json").status_code, 403)
            self.assertEqual(Client().post("/api/v2/palettes", body, content_type="application/json").status_code, 201)

    def test_ip_behind_trusted_proxy(self):
        body = json.dumps({"name": "A", "colors": ["#000000"]})
        with override_settings(CRIVO=crivo(WRITE_LIMIT=1, TRUSTED_PROXY=True)):
            a = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1")
            b = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="2.2.2.2")
            self.assertEqual(a.post("/api/v2/palettes", body, content_type="application/json").status_code, 201)
            self.assertEqual(b.post("/api/v2/palettes", body, content_type="application/json").status_code, 201, "different clients behind the same proxy")
            self.assertEqual(a.post("/api/v2/palettes", body, content_type="application/json").status_code, 429)
            forged = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="9.9.9.9, 1.1.1.1")
            self.assertEqual(
                forged.post("/api/v2/palettes", body, content_type="application/json").status_code,
                429,
                "the client cannot escape by forging the start of the list",
            )
        with override_settings(CRIVO=crivo(WRITE_LIMIT=1, TRUSTED_PROXY=False)):
            c = Client(REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="3.3.3.3")
            d = Client(REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="4.4.4.4")
            self.assertEqual(c.post("/api/v2/palettes", body, content_type="application/json").status_code, 201)
            self.assertEqual(
                d.post("/api/v2/palettes", body, content_type="application/json").status_code, 429, "without a trusted proxy the header is ignored"
            )

    def test_zero_turns_it_off(self):
        with override_settings(CRIVO=crivo(WRITE_LIMIT=0)):
            c = Client()
            for _ in range(5):
                self.assertEqual(c.post("/api/v2/palettes", json.dumps({"name": "A", "colors": ["#000000"]}), content_type="application/json").status_code, 201)


class ConfigurationTest(CleanTestCase):
    def _run(self, *args, **env):
        environment = {k: v for k, v in os.environ.items() if not k.startswith("CRIVO_")}
        environment.update(env)
        return subprocess.run([sys.executable, *args], cwd=ROOT, env=environment, capture_output=True, text=True, timeout=60)

    def _start(self, code="", **env):
        return self._run("-c", "import django, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'crivo.settings'); django.setup()\n" + code, **env)

    def _settings(self, **env):
        code = (
            "import json\nfrom django.conf import settings as s\n"
            "print(json.dumps({'crivo': s.CRIVO, 'upload': s.DATA_UPLOAD_MAX_MEMORY_SIZE, 'hsts': getattr(s, 'SECURE_HSTS_SECONDS', None),"
            " 'subdomains': getattr(s, 'SECURE_HSTS_INCLUDE_SUBDOMAINS', None), 'redirect': getattr(s, 'SECURE_SSL_REDIRECT', None)}))"
        )
        r = self._start(code, **env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_production_refuses_insecure_key(self):
        for key in ("", "troque-esta-chave", "curta"):
            with self.subTest(key=key):
                r = self._start(CRIVO_DEBUG="false", CRIVO_SECRET_KEY=key)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("CRIVO_SECRET_KEY", r.stderr)
        self.assertEqual(self._start(CRIVO_DEBUG="false", CRIVO_SECRET_KEY="x" * 50).returncode, 0)

    def test_new_environment_variable_names(self):
        s = self._settings(
            CRIVO_WRITE_LIMIT="7",
            CRIVO_MAX_REVISIONS="5",
            CRIVO_TRUSTED_PROXY="true",
            CRIVO_MAX_UPLOAD_MB="2",
            CRIVO_HTTPS="true",
            CRIVO_HSTS_SECONDS="60",
            CRIVO_HSTS_SUBDOMAINS="yes",
            CRIVO_HTTPS_REDIRECT="on",
        )
        self.assertEqual((s["crivo"]["WRITE_LIMIT"], s["crivo"]["MAX_REVISIONS"], s["crivo"]["TRUSTED_PROXY"]), (7, 5, True))
        self.assertEqual((s["upload"], s["hsts"], s["subdomains"], s["redirect"]), (2 * 1024 * 1024, 60, True, True))

    def test_old_environment_variable_names_still_work(self):
        s = self._settings(
            CRIVO_LIMITE_ESCRITAS="7",
            CRIVO_MAX_REVISOES="5",
            CRIVO_PROXY_CONFIAVEL="sim",
            CRIVO_TAMANHO_MAXIMO_MB="2",
            CRIVO_HTTPS="true",
            CRIVO_HSTS_SEGUNDOS="60",
            CRIVO_HSTS_SUBDOMINIOS="1",
            CRIVO_REDIRECIONAR_HTTPS="true",
        )
        self.assertEqual((s["crivo"]["WRITE_LIMIT"], s["crivo"]["MAX_REVISIONS"], s["crivo"]["TRUSTED_PROXY"]), (7, 5, True))
        self.assertEqual((s["upload"], s["hsts"], s["subdomains"], s["redirect"]), (2 * 1024 * 1024, 60, True, True))
        self.assertEqual(self._settings(CRIVO_WRITE_LIMIT="9", CRIVO_LIMITE_ESCRITAS="7")["crivo"]["WRITE_LIMIT"], 9, "the new name wins")
        self.assertEqual(self._settings()["crivo"]["WRITE_LIMIT"], 120, "default when neither is set")

    def test_old_environment_variable_names_are_reported_as_deprecated(self):
        r = self._run("manage.py", "check", CRIVO_LIMITE_ESCRITAS="7")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("crivo.W001", r.stderr)
        self.assertIn("CRIVO_LIMITE_ESCRITAS is deprecated; use CRIVO_WRITE_LIMIT instead.", r.stderr)
        r = self._run("manage.py", "check", CRIVO_WRITE_LIMIT="7")
        self.assertNotIn("crivo.W001", r.stdout + r.stderr)


class PngAndFormatsTest(CleanTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client()
        r = self.c.post("/api/v2/projects", json.dumps({"data": document(name="Poção")}), content_type="application/json")
        self.pid = r.json()["id"]

    def test_scaled_frame_png(self):
        r = self.c.get(f"/api/v2/projects/{self.pid}/png?frame=1&scale=3")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/png")
        width, height, rows = read_png(r.content)
        self.assertEqual((width, height), (12, 12))
        self.assertEqual(struct.unpack("<I", rows[0][0:4])[0], RED)
        self.assertEqual(struct.unpack("<I", rows[2][8:12])[0], RED, "pixel 0 becomes a 3x3 block")
        self.assertEqual(struct.unpack("<I", rows[3][12:16])[0], BLUE)
        self.assertEqual(rows[11][44:48], b"\x00\x00\x00\x00")

    def test_png_size_is_limited(self):
        with self.assertRaises(ValueError):
            export.generate_png([0] * 4, 2, 2, 2000)

    def test_c_and_java_formats(self):
        h = self.c.get(f"/api/v2/projects/{self.pid}/export?format=c&frame=1").content.decode()
        self.assertIn("#define POCAO_WIDTH 4", h)
        self.assertIn("static const int16_t pocao_pixels[POCAO_FRAMES][POCAO_HEIGHT][POCAO_WIDTH]", h)
        java = self.c.get(f"/api/v2/projects/{self.pid}/export?format=java&mode=hex&download=1")
        self.assertIn('filename="Pocao.java"', java["Content-Disposition"])
        text = java.content.decode()
        self.assertIn("public final class Pocao", text)
        self.assertIn("0xFFFF0000", text)
        self.assertNotIn("TRANSPARENT", text)

    def test_large_java_is_compact_and_file_name(self):
        pixels = [0] * (70 * 70)
        for i in range(len(pixels)):
            if i % 3:
                pixels[i] = pack(i % 256, (i // 256) % 256, 9)
        data = export.build_matrices([pixels, pixels], 70, 70, "indices")
        source = export.generate("java", data, "Meu Sprite")
        self.assertIn("public final class MeuSprite", source)
        self.assertIn("private static final String[] DATA = {", source)
        self.assertLess(source.count(","), 1000, "the values do not become a huge literal")
        java = self.c.get(f"/api/v2/projects/{self.pid}/export?format=java&download=1")
        self.assertIn('filename="Pocao.java"', java["Content-Disposition"], "the file is named after the class")

    @unittest.skipUnless(shutil.which("javac") and shutil.which("java"), "needs the JDK")
    def test_compact_java_compiles_and_reads_the_values(self):
        pixels = [pack(i % 251, i % 13, 200) if i % 5 else 0 for i in range(96 * 96)]
        data = export.build_matrices([pixels], 96, 96, "indices")
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "Big.java").write_text(export.generate("java", data, "Big"), encoding="utf-8")
            Path(folder, "Read.java").write_text(
                'public class Read { public static void main(String[] a) { System.out.println(Big.FRAMES[0][95][95] + " " + Big.FRAMES[0][0][0] + " " + Big.PALETTE.length); } }',
                encoding="utf-8",
            )
            subprocess.run([shutil.which("javac"), "-encoding", "UTF-8", "Big.java", "Read.java"], cwd=folder, check=True, capture_output=True)
            output = subprocess.run([shutil.which("java"), "-cp", folder, "Read"], capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(output, [str(data["frames"][0][95][95]), "-1", str(len(data["palette"]))])

    def test_c_uses_int32_with_many_colors(self):
        data = {"width": 1, "height": 1, "mode": "indices", "palette": ["#000000"] * 40000, "frames": [[[39999]]]}
        self.assertIn("static const int32_t", export.generate("c", data, "a"))

    def test_matches_the_editor(self):
        """The server's C/Java output is identical to the JavaScript editor's (same generator on both sides)."""
        data = {"width": 2, "height": 1, "mode": "indices", "palette": ["#ff0000"], "frames": [[[0, -1]]]}
        self.assertIn("{ 0, -1}", export.generate("c", data, "a"))
        self.assertEqual(export.identifier("Poção do Mago", "pascal"), "PocaoDoMago")
        self.assertEqual(export.identifier("Poção do Mago", "snake"), "pocao_do_mago")
        self.assertEqual(export.identifier("Poção do Mago", "camel"), "pocaoDoMago")
        self.assertEqual(export.identifier("Poção do Mago", "constant"), "POCAO_DO_MAGO")
        self.assertEqual(pack(255, 0, 0), RED)
        self.assertTrue(MINIMAL_PNG)
