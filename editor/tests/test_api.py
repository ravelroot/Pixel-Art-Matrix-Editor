import base64
import json

from django.test import Client, TestCase, override_settings

from editor.models import Celula, Paleta, Projeto, Revisao
from editor.seguranca import LimiteDeEscritasMiddleware
from editor.rle import codificar, decodificar, empacotar, para_base64, sobrepor

VERMELHO = empacotar(255, 0, 0)
AZUL = empacotar(0, 0, 255)
PNG_MINIMO = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
    )
).decode()


def documento(nome="Poção", largura=4, altura=4, cor=VERMELHO):
    pixels = [0] * (largura * altura)
    pixels[0] = cor
    pixels[5] = AZUL
    return {
        "formato": "crivo",
        "versao": 1,
        "nome": nome,
        "largura": largura,
        "altura": altura,
        "fps": 6,
        "paleta": ["#ff0000", "#0000ff"],
        "camadas": [{"id": "c1", "nome": "Base", "visivel": True, "opacidade": 100, "bloqueada": False}],
        "quadros": [{"id": "q1", "duracao": None}, {"id": "q2", "duracao": 200}],
        "celulas": [{"quadro": "q1", "camada": "c1", "rle": para_base64(codificar(pixels))}],
    }


class RLETeste(TestCase):
    def test_ida_e_volta(self):
        pixels = [0] * 300 + [VERMELHO] * 5000 + [AZUL]
        self.assertEqual(list(decodificar(codificar(pixels), len(pixels))), pixels)

    def test_compativel_com_o_javascript(self):
        self.assertEqual(codificar([VERMELHO] * 3), bytes([3, 255, 0, 0, 255]))
        self.assertEqual(codificar([0] * 200), bytes([200 & 127 | 128, 1, 0, 0, 0, 0]))

    def test_rejeita_tamanho_errado(self):
        with self.assertRaises(ValueError):
            decodificar(codificar([VERMELHO] * 3), 4)

    def test_sobreposicao(self):
        self.assertEqual(sobrepor(AZUL, VERMELHO, 1), VERMELHO)
        self.assertEqual(sobrepor(0, VERMELHO, 0), 0)


class ApiTeste(TestCase):
    def setUp(self):
        LimiteDeEscritasMiddleware.reiniciar()
        self.c = Client()

    def post(self, url, dados):
        return self.c.post(url, json.dumps(dados), content_type="application/json")

    def put(self, url, dados):
        return self.c.put(url, json.dumps(dados), content_type="application/json")

    def test_saude_e_pagina(self):
        r = self.c.get("/api/v1/saude")
        self.assertEqual(r.json()["status"], "ok")
        r = self.c.get("/")
        self.assertContains(r, '<base href="/static/editor/">')
        self.assertIn("csrftoken", r.cookies)

    def test_paletas_predefinidas_semeadas(self):
        nomes = {p["slug"] for p in self.c.get("/api/v1/paletas").json()["paletas"]}
        self.assertTrue({"crivo", "game-boy", "nes", "pico-8", "cga"} <= nomes)
        pico = Paleta.objects.get(slug="pico-8")
        self.assertEqual(pico.cores.count(), 16)
        r = self.put(f"/api/v1/paletas/{pico.pk}", {"nome": "x", "cores": ["#000000"]})
        self.assertEqual(r.status_code, 403)

    def test_paleta_customizada(self):
        r = self.post("/api/v1/paletas", {"nome": "Minha", "cores": ["#5D1C16", "a3b4be", "#f6e4a6ff"]})
        self.assertEqual(r.status_code, 201)
        p = r.json()
        self.assertEqual(p["cores"], ["#5d1c16", "#a3b4be", "#f6e4a6"])
        r = self.put(f"/api/v1/paletas/{p['id']}", {"nome": "Minha 2", "cores": ["#000000"]})
        self.assertEqual(r.json()["nome"], "Minha 2")
        self.assertEqual(self.post("/api/v1/paletas", {"nome": "Ruim", "cores": ["verde"]}).status_code, 422)
        self.assertEqual(self.c.delete(f"/api/v1/paletas/{p['id']}").status_code, 204)

    def test_ciclo_do_projeto(self):
        r = self.post("/api/v1/projetos", {"dados": documento(), "miniatura": "data:image/png;base64," + PNG_MINIMO})
        self.assertEqual(r.status_code, 201, r.content)
        p = r.json()
        self.assertEqual((p["largura"], p["quadros"], p["camadas"], p["revisao"]), (4, 2, 1, 1))
        self.assertEqual(self.c.get(p["miniatura_url"])["Content-Type"], "image/png")
        dados = self.c.get(f"/api/v1/projetos/{p['id']}").json()["dados"]
        self.assertEqual(dados["quadros"][1]["duracao"], 200)
        self.assertEqual(dados["celulas"], documento()["celulas"])
        lista = self.c.get("/api/v1/projetos").json()["projetos"]
        self.assertEqual(lista[0]["nome"], "Poção")
        r = self.put(f"/api/v1/projetos/{p['id']}", {"dados": documento("Poção 2", cor=AZUL), "revisao": 1})
        self.assertEqual(r.json()["revisao"], 2)
        self.assertEqual(Revisao.objects.count(), 1)
        r = self.put(f"/api/v1/projetos/{p['id']}", {"dados": documento("Velho"), "revisao": 1})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["revisao_atual"], 2)
        revs = self.c.get(f"/api/v1/projetos/{p['id']}/revisoes").json()["revisoes"]
        self.assertEqual(revs[0]["numero"], 1)
        r = self.post(f"/api/v1/projetos/{p['id']}/revisoes/1/restaurar", {})
        self.assertEqual(r.json()["nome"], "Poção")
        self.assertEqual(r.json()["revisao"], 3)
        self.assertEqual(self.c.delete(f"/api/v1/projetos/{p['id']}").status_code, 204)
        self.assertEqual(Celula.objects.count(), 0)

    def test_exportar(self):
        p = self.post("/api/v1/projetos", {"dados": documento("Espada Curta")}).json()
        r = self.c.get(f"/api/v1/projetos/{p['id']}/exportar?formato=json&quadro=1")
        dados = json.loads(r.content)
        self.assertEqual(dados["paleta"], ["#ff0000", "#0000ff"])
        self.assertEqual(dados["quadros"][0][0][:2], [0, -1])
        self.assertEqual(dados["quadros"][0][1][1], 1)
        r = self.c.get(f"/api/v1/projetos/{p['id']}/exportar?formato=js&modo=hex")
        self.assertIn("export const espadaCurta", r.content.decode())
        r = self.c.get(f"/api/v1/projetos/{p['id']}/exportar?formato=py&baixar=1")
        self.assertIn("ESPADA_CURTA = {", r.content.decode())
        self.assertIn("attachment", r["Content-Disposition"])
        csv = self.c.get(f"/api/v1/projetos/{p['id']}/exportar?formato=csv").content.decode()
        self.assertEqual(csv.split("\n")[0], "0,-1,-1,-1")
        self.assertEqual(self.c.get(f"/api/v1/projetos/{p['id']}/exportar?formato=bmp").status_code, 400)

    def test_validacao(self):
        ruim = documento()
        ruim["celulas"][0]["rle"] = para_base64(codificar([VERMELHO] * 3))
        self.assertEqual(self.post("/api/v1/projetos", {"dados": ruim}).status_code, 422)
        ruim = documento(largura=2000)
        self.assertEqual(self.post("/api/v1/projetos", {"dados": ruim}).status_code, 422)
        ruim = documento()
        ruim["quadros"][1]["id"] = "c1"
        self.assertEqual(self.post("/api/v1/projetos", {"dados": ruim}).status_code, 422)
        self.assertEqual(self.post("/api/v1/projetos", {"dados": documento(), "miniatura": "data:image/gif;base64,AAAA"}).status_code, 422)
        self.assertEqual(self.c.post("/api/v1/projetos", "{", content_type="application/json").status_code, 422)
        self.assertEqual(Projeto.objects.count(), 0)

    def test_csrf_e_token(self):
        cliente = Client(enforce_csrf_checks=True)
        r = cliente.post("/api/v1/paletas", json.dumps({"nome": "A", "cores": ["#000000"]}), content_type="application/json")
        self.assertEqual(r.status_code, 403)
        cliente.get("/")
        token = cliente.cookies["csrftoken"].value
        r = cliente.post("/api/v1/paletas", json.dumps({"nome": "A", "cores": ["#000000"]}), content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 201)
        with override_settings(CRIVO={**self.settings_crivo(), "TOKEN_API": "segredo"}):
            outro = Client(enforce_csrf_checks=True)
            r = outro.post("/api/v1/paletas", json.dumps({"nome": "B", "cores": ["#ffffff"]}), content_type="application/json", HTTP_AUTHORIZATION="Bearer segredo")
            self.assertEqual(r.status_code, 201)

    def settings_crivo(self):
        from django.conf import settings

        return settings.CRIVO
