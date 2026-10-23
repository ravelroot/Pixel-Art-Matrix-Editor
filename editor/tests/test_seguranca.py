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

from editor import exportacao
from editor.models import Projeto
from editor.seguranca import LimiteDeEscritasMiddleware
from editor.rle import empacotar

from .test_api import AZUL, PNG_MINIMO, VERMELHO, documento

RAIZ = Path(__file__).resolve().parents[2]


class TesteLimpo(TestCase):
    """Zera o contador do limite de escritas antes de cada teste, para um teste não gastar a cota do outro."""

    def setUp(self):
        LimiteDeEscritasMiddleware.reiniciar()


def crivo(**extra):
    return {**settings.CRIVO, **extra}


def ler_png(dados):
    """Decodificador mínimo de PNG RGBA 8 bits sem filtros, só para conferir a saída do servidor."""
    assert dados[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    largura = altura = None
    idat = b""
    while pos < len(dados):
        (tamanho,) = struct.unpack(">I", dados[pos : pos + 4])
        tipo = dados[pos + 4 : pos + 8]
        corpo = dados[pos + 8 : pos + 8 + tamanho]
        (crc,) = struct.unpack(">I", dados[pos + 8 + tamanho : pos + 12 + tamanho])
        assert crc == zlib.crc32(tipo + corpo) & 0xFFFFFFFF, "CRC inválido"
        if tipo == b"IHDR":
            largura, altura = struct.unpack(">II", corpo[:8])
        elif tipo == b"IDAT":
            idat += corpo
        pos += 12 + tamanho
    bruto = zlib.decompress(idat)
    linha = 1 + largura * 4
    return largura, altura, [bruto[y * linha + 1 : (y + 1) * linha] for y in range(altura)]


class CabecalhosTeste(TesteLimpo):
    def test_cabecalhos_de_seguranca_na_pagina_e_na_api(self):
        c = Client()
        for url in ("/", "/api/v1", "/api/v1/saude", "/api/v1/projetos"):
            r = c.get(url)
            with self.subTest(url=url):
                csp = r["Content-Security-Policy"]
                for diretiva in ("default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"):
                    self.assertIn(diretiva, csp)
                self.assertNotIn("unsafe-eval", csp)
                self.assertEqual(r["X-Frame-Options"], "DENY")
                self.assertEqual(r["X-Content-Type-Options"], "nosniff")
                self.assertEqual(r["Referrer-Policy"], "same-origin")
                self.assertEqual(r["Cross-Origin-Opener-Policy"], "same-origin")
                self.assertIn("camera=()", r["Permissions-Policy"])
        self.assertEqual(c.get("/api/v1/projetos")["Cache-Control"], "no-store")

    def test_csrf_cookie_restrito(self):
        r = Client().get("/")
        self.assertEqual(r.cookies["csrftoken"]["samesite"], "Strict")

    def test_hsts_so_com_https(self):
        r = Client().get("/api/v1/saude")
        self.assertNotIn("Strict-Transport-Security", r)
        with override_settings(SECURE_HSTS_SECONDS=31536000):
            r = Client().get("/api/v1/saude", secure=True)
            self.assertEqual(r["Strict-Transport-Security"], "max-age=31536000")


class AutenticacaoTeste(TesteLimpo):
    def test_escrita_sem_csrf_e_sem_token_e_negada(self):
        c = Client(enforce_csrf_checks=True)
        for metodo, url in (("post", "/api/v1/projetos"), ("post", "/api/v1/paletas")):
            r = getattr(c, metodo)(url, json.dumps({"dados": documento()}), content_type="application/json")
            self.assertEqual(r.status_code, 403)
        self.assertEqual(Projeto.objects.count(), 0)

    def test_token_errado_ou_mal_formado_nao_libera(self):
        with override_settings(CRIVO=crivo(TOKEN_API="segredo-correto")):
            c = Client(enforce_csrf_checks=True)
            for cabecalho in ("Bearer segredo-errado", "Bearer ", "segredo-correto", "Basic segredo-correto", "Bearer segredo-corret"):
                r = c.post("/api/v1/paletas", json.dumps({"nome": "X", "cores": ["#000000"]}), content_type="application/json", HTTP_AUTHORIZATION=cabecalho)
                with self.subTest(cabecalho=cabecalho):
                    self.assertEqual(r.status_code, 403)

    def test_token_vazio_nunca_libera(self):
        with override_settings(CRIVO=crivo(TOKEN_API="")):
            c = Client(enforce_csrf_checks=True)
            r = c.post("/api/v1/paletas", json.dumps({"nome": "X", "cores": ["#000000"]}), content_type="application/json", HTTP_AUTHORIZATION="Bearer ")
            self.assertEqual(r.status_code, 403)

    def test_token_nao_vale_fora_da_api(self):
        with override_settings(CRIVO=crivo(TOKEN_API="segredo")):
            r = Client(enforce_csrf_checks=True).post("/", HTTP_AUTHORIZATION="Bearer segredo")
            self.assertIn(r.status_code, (403, 405))


class EntradasMaliciosasTeste(TesteLimpo):
    def setUp(self):
        super().setUp()
        self.c = Client()

    def post(self, url, corpo):
        return self.c.post(url, corpo if isinstance(corpo, str) else json.dumps(corpo), content_type="application/json")

    def test_json_aninhado_demais_nao_derruba_o_servidor(self):
        bomba = "[" * 100000 + "]" * 100000
        r = self.post("/api/v1/projetos", '{"dados": ' + bomba + "}")
        self.assertEqual(r.status_code, 422)
        self.assertIn("erro", r.json())

    def test_corpo_que_nao_e_objeto(self):
        for corpo in ("[]", "123", '"texto"', "null"):
            with self.subTest(corpo=corpo):
                self.assertEqual(self.post("/api/v1/projetos", corpo).status_code, 422)

    def test_corpo_grande_demais(self):
        with override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=1024):
            r = self.post("/api/v1/projetos", {"dados": documento(), "lixo": "x" * 4096})
            self.assertEqual(r.status_code, 413)

    def test_miniatura_falsa_e_rejeitada(self):
        falsas = [
            "data:image/svg+xml;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode(),
            base64.b64encode(b"<html><script>alert(1)</script></html>").decode(),
            "nao-e-base64!!!",
            base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (600 * 1024)).decode(),
        ]
        for miniatura in falsas:
            with self.subTest(miniatura=miniatura[:30]):
                self.assertEqual(self.post("/api/v1/projetos", {"dados": documento(), "miniatura": miniatura}).status_code, 422)
        self.assertEqual(Projeto.objects.count(), 0)

    def test_limites_do_documento(self):
        casos = [
            {**documento(), "largura": 1025},
            {**documento(), "altura": 0},
            {**documento(), "largura": "16; DROP TABLE editor_projeto"},
            {**documento(), "fps": 999},
            {**documento(), "camadas": [{"id": f"c{i}", "nome": "x"} for i in range(65)]},
            {**documento(), "quadros": []},
            {**documento(), "formato": "outro"},
        ]
        for dados in casos:
            with self.subTest(dados={k: str(v)[:20] for k, v in dados.items() if k in ("largura", "altura", "fps", "formato")}):
                self.assertEqual(self.post("/api/v1/projetos", {"dados": dados}).status_code, 422)
        self.assertEqual(Projeto.objects.count(), 0)

    def test_rle_corrompido(self):
        dados = documento()
        dados["celulas"][0]["rle"] = base64.b64encode(b"\xff\xff\xff\xff\xff\xff").decode()
        self.assertIn(self.post("/api/v1/projetos", {"dados": dados}).status_code, (400, 422))
        self.assertEqual(Projeto.objects.count(), 0)

    def test_nome_com_html_volta_como_texto_e_arquivo_seguro(self):
        nome = '<img src=x onerror=alert(1)>"; rm -rf /'
        r = self.post("/api/v1/projetos", {"dados": documento(nome=nome)})
        self.assertEqual(r.status_code, 201)
        pid = r.json()["id"]
        self.assertEqual(r["Content-Type"], "application/json")
        self.assertEqual(self.c.get(f"/api/v1/projetos/{pid}").json()["nome"], nome)
        for url in (f"/api/v1/projetos/{pid}/exportar?formato=py&baixar=1", f"/api/v1/projetos/{pid}/png?baixar=1"):
            disposicao = self.c.get(url)["Content-Disposition"]
            nome_arquivo = disposicao.split('filename="', 1)[1].rstrip('"')
            with self.subTest(url=url):
                self.assertRegex(nome_arquivo, r"^[A-Za-z0-9_\-]+\.(py|png)$")

    def test_ids_e_parametros_invalidos(self):
        self.assertEqual(self.c.get("/api/v1/projetos/123").status_code, 404)
        self.assertEqual(self.c.get("/api/v1/projetos/00000000-0000-0000-0000-000000000000").status_code, 404)
        pid = self.post("/api/v1/projetos", {"dados": documento()}).json()["id"]
        for consulta in ("formato=exe", "modo=binario", "quadro=-1", "quadro=abc", "quadro=99"):
            with self.subTest(consulta=consulta):
                self.assertEqual(self.c.get(f"/api/v1/projetos/{pid}/exportar?{consulta}").status_code, 400)
        for consulta in ("escala=0", "escala=33", "escala=-2", "quadro=0", "quadro=x"):
            with self.subTest(consulta=consulta):
                self.assertEqual(self.c.get(f"/api/v1/projetos/{pid}/png?{consulta}").status_code, 400)

    def test_metodos_nao_permitidos(self):
        self.assertEqual(self.c.delete("/api/v1/saude").status_code, 405)
        self.assertEqual(self.c.post("/api/v1/projetos/00000000-0000-0000-0000-000000000000/miniatura").status_code, 405)


class LimiteDeEscritasTeste(TesteLimpo):
    def test_limite_por_minuto(self):
        with override_settings(CRIVO=crivo(LIMITE_ESCRITAS=3)):
            c = Client()
            corpo = json.dumps({"nome": "A", "cores": ["#000000"]})
            codigos = [c.post("/api/v1/paletas", corpo, content_type="application/json").status_code for _ in range(5)]
            self.assertEqual(codigos, [201, 201, 201, 429, 429])
            r = c.post("/api/v1/paletas", corpo, content_type="application/json")
            self.assertGreaterEqual(int(r["Retry-After"]), 1)
            self.assertEqual(c.get("/api/v1/paletas").status_code, 200, "leituras não entram no limite")
            outro = Client(REMOTE_ADDR="10.0.0.9")
            self.assertEqual(outro.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 201, "o limite é por IP")

    def test_pedido_recusado_pelo_csrf_nao_gasta_a_cota(self):
        with override_settings(CRIVO=crivo(LIMITE_ESCRITAS=2)):
            forjado = Client(enforce_csrf_checks=True)
            corpo = json.dumps({"nome": "A", "cores": ["#000000"]})
            for _ in range(5):
                self.assertEqual(forjado.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 403)
            self.assertEqual(Client().post("/api/v1/paletas", corpo, content_type="application/json").status_code, 201)

    def test_ip_atras_de_proxy_confiavel(self):
        corpo = json.dumps({"nome": "A", "cores": ["#000000"]})
        with override_settings(CRIVO=crivo(LIMITE_ESCRITAS=1, PROXY_CONFIAVEL=True)):
            a = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1")
            b = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="2.2.2.2")
            self.assertEqual(a.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 201)
            self.assertEqual(b.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 201, "clientes diferentes atrás do mesmo proxy")
            self.assertEqual(a.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 429)
            forjado = Client(REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="9.9.9.9, 1.1.1.1")
            self.assertEqual(
                forjado.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 429, "o cliente não escapa forjando o começo da lista"
            )
        with override_settings(CRIVO=crivo(LIMITE_ESCRITAS=1, PROXY_CONFIAVEL=False)):
            c = Client(REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="3.3.3.3")
            d = Client(REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="4.4.4.4")
            self.assertEqual(c.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 201)
            self.assertEqual(d.post("/api/v1/paletas", corpo, content_type="application/json").status_code, 429, "sem proxy confiável o cabeçalho é ignorado")

    def test_zero_desliga(self):
        with override_settings(CRIVO=crivo(LIMITE_ESCRITAS=0)):
            c = Client()
            for _ in range(5):
                self.assertEqual(c.post("/api/v1/paletas", json.dumps({"nome": "A", "cores": ["#000000"]}), content_type="application/json").status_code, 201)


class ConfiguracaoTeste(TesteLimpo):
    def _iniciar(self, **env):
        ambiente = {k: v for k, v in os.environ.items() if not k.startswith("CRIVO_")}
        ambiente.update(env)
        return subprocess.run(
            [sys.executable, "-c", "import django, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'crivo.settings'); django.setup()"],
            cwd=RAIZ,
            env=ambiente,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_producao_recusa_chave_insegura(self):
        for chave in ("", "troque-esta-chave", "curta"):
            with self.subTest(chave=chave):
                r = self._iniciar(CRIVO_DEBUG="false", CRIVO_SECRET_KEY=chave)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("CRIVO_SECRET_KEY", r.stderr)
        self.assertEqual(self._iniciar(CRIVO_DEBUG="false", CRIVO_SECRET_KEY="x" * 50).returncode, 0)


class PngEFormatosTeste(TesteLimpo):
    def setUp(self):
        super().setUp()
        self.c = Client()
        r = self.c.post("/api/v1/projetos", json.dumps({"dados": documento(nome="Poção")}), content_type="application/json")
        self.pid = r.json()["id"]

    def test_png_do_quadro_ampliado(self):
        r = self.c.get(f"/api/v1/projetos/{self.pid}/png?quadro=1&escala=3")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/png")
        largura, altura, linhas = ler_png(r.content)
        self.assertEqual((largura, altura), (12, 12))
        self.assertEqual(struct.unpack("<I", linhas[0][0:4])[0], VERMELHO)
        self.assertEqual(struct.unpack("<I", linhas[2][8:12])[0], VERMELHO, "o pixel 0 vira um bloco 3×3")
        self.assertEqual(struct.unpack("<I", linhas[3][12:16])[0], AZUL)
        self.assertEqual(linhas[11][44:48], b"\x00\x00\x00\x00")

    def test_png_tem_limite_de_tamanho(self):
        with self.assertRaises(ValueError):
            exportacao.gerar_png([0] * 4, 2, 2, 2000)

    def test_formatos_c_e_java(self):
        h = self.c.get(f"/api/v1/projetos/{self.pid}/exportar?formato=c&quadro=1").content.decode()
        self.assertIn("#define POCAO_LARGURA 4", h)
        self.assertIn("static const int16_t pocao_pixels[POCAO_QUADROS][POCAO_ALTURA][POCAO_LARGURA]", h)
        java = self.c.get(f"/api/v1/projetos/{self.pid}/exportar?formato=java&modo=hex&baixar=1")
        self.assertIn('filename="Pocao.java"', java["Content-Disposition"])
        texto = java.content.decode()
        self.assertIn("public final class Pocao", texto)
        self.assertIn("0xFFFF0000", texto)
        self.assertNotIn("TRANSPARENTE", texto)

    def test_java_grande_compacto_e_nome_do_arquivo(self):
        pixels = [0] * (70 * 70)
        for i in range(len(pixels)):
            if i % 3:
                pixels[i] = empacotar(i % 256, (i // 256) % 256, 9)
        dados = exportacao.montar_matrizes([pixels, pixels], 70, 70, "indices")
        fonte = exportacao.gerar("java", dados, "Meu Sprite")
        self.assertIn("public final class MeuSprite", fonte)
        self.assertIn("private static final String[] DADOS = {", fonte)
        self.assertLess(fonte.count(","), 1000, "os valores não viram um literal gigante")
        java = self.c.get(f"/api/v1/projetos/{self.pid}/exportar?formato=java&baixar=1")
        self.assertIn('filename="Pocao.java"', java["Content-Disposition"], "o arquivo tem o nome da classe")

    @unittest.skipUnless(shutil.which("javac") and shutil.which("java"), "precisa do JDK")
    def test_java_compacto_compila_e_le_os_valores(self):
        pixels = [empacotar(i % 251, i % 13, 200) if i % 5 else 0 for i in range(96 * 96)]
        dados = exportacao.montar_matrizes([pixels], 96, 96, "indices")
        with tempfile.TemporaryDirectory() as pasta:
            Path(pasta, "Grande.java").write_text(exportacao.gerar("java", dados, "Grande"), encoding="utf-8")
            Path(pasta, "Ler.java").write_text(
                'public class Ler { public static void main(String[] a) { System.out.println(Grande.QUADROS[0][95][95] + " " + Grande.QUADROS[0][0][0] + " " + Grande.PALETA.length); } }',
                encoding="utf-8",
            )
            subprocess.run([shutil.which("javac"), "-encoding", "UTF-8", "Grande.java", "Ler.java"], cwd=pasta, check=True, capture_output=True)
            saida = subprocess.run([shutil.which("java"), "-cp", pasta, "Ler"], capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(saida, [str(dados["quadros"][0][95][95]), "-1", str(len(dados["paleta"]))])

    def test_c_usa_int32_com_muitas_cores(self):
        dados = {"largura": 1, "altura": 1, "modo": "indices", "paleta": ["#000000"] * 40000, "quadros": [[[39999]]]}
        self.assertIn("static const int32_t", exportacao.gerar("c", dados, "a"))

    def test_compativel_com_o_editor(self):
        """A saída C/Java do servidor é idêntica à do editor em JavaScript (mesmo gerador nos dois lados)."""
        dados = {"largura": 2, "altura": 1, "modo": "indices", "paleta": ["#ff0000"], "quadros": [[[0, -1]]]}
        self.assertIn("{ 0, -1}", exportacao.gerar("c", dados, "a"))
        self.assertEqual(exportacao.identificador("Poção do Mago", "pascal"), "PocaoDoMago")
        self.assertEqual(exportacao.identificador("Poção do Mago", "cobra"), "pocao_do_mago")
        self.assertEqual(empacotar(255, 0, 0), VERMELHO)
        self.assertTrue(PNG_MINIMO)
