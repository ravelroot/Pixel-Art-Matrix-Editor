"""Teste ponta a ponta da interface com Playwright (Chromium), nos dois jeitos de abrir o editor:

- InterfaceTeste: contra o servidor Django de verdade (API + banco);
- ArquivoUnicoTeste: o Crivo.html aberto direto do disco (file://), sem servidor e sem backend,
  inclusive a integração com o app desktop (o Crivo.exe abre esse mesmo arquivo).

Os testes de desenho valem para os dois e ficam em TestesDoEditor.

Rodar:  pip install playwright && python -m playwright install chromium
        python -m unittest discover -s tests/e2e -v
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
VERSAO = (RAIZ / "VERSION").read_text(encoding="utf-8").strip()


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestesDoEditor:
    """Testes que valem para o editor servido pelo Django e para o Crivo.html aberto do disco."""

    url = ""
    navegador = None

    def setUp(self):
        self.contexto = self.navegador.new_context(viewport={"width": 1440, "height": 900})
        self.pagina = self.contexto.new_page()
        self.erros = []
        self.pagina.on("console", lambda m: self.erros.append(m.text) if m.type == "error" else None)
        self.pagina.on("pageerror", lambda e: self.erros.append(str(e)))
        self.pagina.goto(self.url)
        self.pagina.wait_for_selector("body.pronto")
        self.pagina.evaluate("() => { const e = window.crivo.editor; e.definirCor('primaria', 0xff161c5d); e.definirCor('secundaria', 0xffcedde6); }")

    def tearDown(self):
        self.contexto.close()
        self.assertEqual(self.erros, [], "a página não pode ter erros no console (inclusive violações de CSP)")

    # utilidades -------------------------------------------------------------------------------------------
    def ponto(self, x, y):
        return self.pagina.evaluate(
            """([x, y]) => {
                const v = window.crivo.visor;
                const r = v.canvas.getBoundingClientRect();
                return [r.left + v.panX + (x + 0.5) * v.zoom, r.top + v.panY + (y + 0.5) * v.zoom];
            }""",
            [x, y],
        )

    def arrastar(self, de, para, botao="left", passos=8):
        m = self.pagina.mouse
        m.move(*self.ponto(*de))
        m.down(button=botao)
        m.move(*self.ponto(*para), steps=passos)
        m.up(button=botao)

    def pixel(self, x, y):
        return self.pagina.evaluate("([x, y]) => { const e = window.crivo.editor; return e.celulaAtiva()[y * e.doc.largura + x] >>> 0; }", [x, y])

    def ferramenta(self, tecla, id_):
        self.pagina.locator("#visor").hover()
        self.pagina.keyboard.press(tecla)
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.estado.ferramenta"), id_)

    def menu(self, titulo, item):
        self.pagina.get_by_role("button", name=titulo, exact=True).click()
        self.pagina.get_by_role("menuitem", name=item).click()

    # testes -----------------------------------------------------------------------------------------------
    def test_pontilhado_desenha_o_padrao_de_xadrez(self):
        self.ferramenta("d", "pontilhado")
        self.pagina.evaluate("() => window.crivo.editor.definir('densidade', 50)")
        self.arrastar((2, 4), (9, 4))
        prim, sec = self.pixel(2, 4), self.pixel(3, 4)
        self.assertNotEqual(prim, sec)
        self.assertEqual(self.pixel(4, 4), prim)
        self.assertEqual(self.pixel(5, 4), sec)

    def test_selecao_copiar_colar_e_mover(self):
        self.ferramenta("b", "lapis")
        self.arrastar((3, 3), (3, 3), passos=1)
        self.arrastar((20, 20), (20, 20), passos=1)
        cor = self.pixel(3, 3)
        self.assertNotEqual(cor, 0)
        self.ferramenta("s", "selecao")
        self.arrastar((2, 2), (4, 4))
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.selecao"), {"x": 2, "y": 2, "largura": 3, "altura": 3})
        self.pagina.keyboard.press("Control+c")
        self.pagina.keyboard.press("Control+v")
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.estado.ferramenta"), "moverPixels")
        self.arrastar((3, 3), (13, 8))
        self.assertEqual(self.pixel(13, 8), cor, "o conteúdo colado foi arrastado")
        self.assertEqual(self.pixel(3, 3), cor, "a colagem flutua: o original continua no lugar")
        self.pagina.keyboard.press("ArrowRight")
        self.assertEqual(self.pixel(14, 8), cor, "as setas empurram 1 px")
        self.pagina.keyboard.press("Delete")
        self.assertEqual(self.pixel(14, 8), 0, "Delete apaga só a seleção")
        self.assertEqual(self.pixel(20, 20), cor, "fora da seleção nada muda")
        self.pagina.keyboard.press("Escape")
        self.assertIsNone(self.pagina.evaluate("() => window.crivo.editor.selecao"))

    def test_degrade_e_clarear_escurecer(self):
        self.ferramenta("u", "degrade")
        self.arrastar((0, 0), (31, 0))
        inicio, fim = self.pixel(0, 10), self.pixel(31, 10)
        self.assertEqual(inicio, self.pagina.evaluate("() => window.crivo.editor.estado.corPrimaria"))
        self.assertEqual(fim, self.pagina.evaluate("() => window.crivo.editor.estado.corSecundaria"))
        self.ferramenta("q", "sombra")
        self.pagina.evaluate("() => window.crivo.editor.definir('modoSombra', 'luz')")
        antes = self.pixel(0, 10)
        self.arrastar((0, 10), (0, 10), passos=1)
        self.assertNotEqual(self.pixel(0, 10), antes)
        self.arrastar((0, 12), (0, 12), botao="right", passos=1)
        self.assertNotEqual(self.pixel(0, 12), antes)

    def test_pixel_perfect_remove_cantos(self):
        self.ferramenta("b", "lapis")
        self.pagina.evaluate("() => { window.crivo.editor.definir('tamanho', 1); window.crivo.editor.definir('pixelPerfect', true); }")
        m = self.pagina.mouse
        m.move(*self.ponto(5, 5))
        m.down()
        for x, y in ((6, 5), (6, 6), (7, 6), (7, 7)):
            m.move(*self.ponto(x, y), steps=2)
        m.up()
        self.assertEqual(self.pixel(6, 5), 0, "o canto em L foi removido")
        self.assertNotEqual(self.pixel(6, 6), 0)

    def test_comandos_de_imagem_e_desfazer(self):
        self.ferramenta("r", "retangulo")
        self.pagina.evaluate("() => window.crivo.editor.definir('preenchido', true)")
        self.arrastar((10, 10), (14, 12))
        self.menu("Imagem", "Adicionar contorno (4 vizinhos)")
        self.assertNotEqual(self.pixel(9, 10), 0)
        self.menu("Imagem", "Aparar bordas transparentes")
        tamanho = self.pagina.evaluate("() => [window.crivo.editor.doc.largura, window.crivo.editor.doc.altura]")
        self.assertEqual(tamanho, [7, 5])
        self.menu("Imagem", "Inverter cores")
        self.menu("Imagem", "Tons de cinza")
        self.menu("Imagem", "Converter para a paleta atual")
        self.pagina.keyboard.press("t")
        self.assertTrue(self.pagina.evaluate("() => window.crivo.editor.estado.ladrilho"))
        self.pagina.keyboard.press("Shift+T")
        for _ in range(10):
            self.pagina.keyboard.press("Control+z")
        self.assertEqual(self.pagina.evaluate("() => [window.crivo.editor.doc.largura, window.crivo.editor.historico.passado.length]"), [32, 0])

    def test_espelhar_selecao_substituir_cor_e_gif(self):
        self.ferramenta("b", "lapis")
        self.arrastar((0, 0), (0, 0), passos=1)
        primaria = self.pixel(0, 0)
        self.ferramenta("s", "selecao")
        self.arrastar((0, 0), (3, 1))
        self.pagina.keyboard.press("Shift+H")
        self.assertEqual(self.pixel(3, 0), primaria, "espelhou só dentro da seleção")
        self.assertEqual(self.pixel(0, 0), 0)
        self.pagina.keyboard.press("Control+d")
        self.menu("Imagem", "Substituir a cor primária pela secundária (todos os quadros)")
        self.assertEqual(self.pixel(3, 0), self.pagina.evaluate("() => window.crivo.editor.estado.corSecundaria"))
        self.pagina.locator("#visor").hover()
        self.pagina.keyboard.press("Control+Shift+G")
        with self.pagina.expect_download() as baixado:
            self.pagina.get_by_role("button", name="Baixar").click()
        caminho = baixado.value.path()
        self.assertTrue(baixado.value.suggested_filename.endswith(".gif"))
        self.assertEqual(Path(caminho).read_bytes()[:6], b"GIF89a")

    def test_colagem_nao_fura_o_fundo_e_gestos_sao_protegidos(self):
        self.ferramenta("f", "balde")
        self.pagina.mouse.click(*self.ponto(0, 0))
        fundo = self.pixel(0, 0)
        self.pagina.evaluate("() => { const e = window.crivo.editor; e.definirCor('primaria', 0xff0000ff); }")
        self.ferramenta("b", "lapis")
        self.arrastar((2, 2), (2, 2), passos=1)
        vermelho = self.pixel(2, 2)
        self.ferramenta("s", "selecao")
        self.arrastar((2, 2), (4, 4))
        self.pagina.keyboard.press("Control+c")
        self.pagina.keyboard.press("Control+v")
        self.arrastar((3, 3), (13, 3))
        self.assertEqual(self.pixel(12, 2), vermelho)
        self.assertEqual(self.pixel(13, 3), fundo, "o pixel transparente da colagem mostra o fundo, sem levar nada junto")
        self.assertEqual(self.pixel(2, 2), vermelho, "onde estava a colagem o fundo continua inteiro")
        for _ in range(40):
            self.pagina.keyboard.press("ArrowLeft")
        for _ in range(40):
            self.pagina.keyboard.press("ArrowRight")
        self.assertEqual(self.pixel(12, 2), vermelho, "levar para fora da borda e trazer de volta não perde pixels")
        passos = self.pagina.evaluate("() => window.crivo.editor.historico.passado.length")
        m = self.pagina.mouse
        m.move(*self.ponto(12, 2))
        m.down()
        m.move(*self.ponto(20, 10), steps=3)
        self.pagina.keyboard.press("Control+z")
        m.up()
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.historico.passado.length"), passos + 1, "Ctrl+Z no meio do arraste é ignorado")
        self.pagina.keyboard.press("Control+z")
        self.assertEqual(self.pixel(12, 2), vermelho)
        self.pagina.get_by_role("button", name="Editar", exact=True).click()
        self.pagina.keyboard.press("ArrowDown")
        self.pagina.keyboard.press("Escape")
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.historico.passado.length"), passos, "setas no menu não mexem nos pixels")
        self.assertIsNotNone(self.pagina.evaluate("() => window.crivo.editor.selecao"), "Esc no menu fecha o menu sem desmarcar")
        self.ferramenta("u", "degrade")
        self.pagina.mouse.click(*self.ponto(25, 25))
        self.assertEqual(self.pagina.evaluate("() => window.crivo.editor.historico.passado.length"), passos, "clique sem arrastar com o degradê não pinta nada")

    def test_preferencias_invalidas_no_navegador_sao_ignoradas(self):
        self.pagina.evaluate("() => { localStorage.setItem('crivo.matrizDegrade', '16'); localStorage.setItem('crivo.ferramenta', '\"<img>\"'); localStorage.setItem('crivo.tamanho', '999'); }")
        self.pagina.reload()
        self.pagina.wait_for_selector("body.pronto")
        estado = self.pagina.evaluate("() => { const e = window.crivo.editor.estado; return [e.matrizDegrade, e.ferramenta, e.tamanho]; }")
        self.assertEqual(estado, [4, "lapis", 1])


class InterfaceTeste(TestesDoEditor, unittest.TestCase):
    """O editor servido pelo Django, com a API e o banco de dados."""

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.TemporaryDirectory()
        ambiente = {k: v for k, v in os.environ.items() if not k.startswith("CRIVO_")}
        ambiente.update(CRIVO_SQLITE_PATH=str(Path(cls.pasta.name) / "e2e.sqlite3"), CRIVO_DEBUG="true", CRIVO_LIMITE_ESCRITAS="0")
        subprocess.run([sys.executable, "manage.py", "migrate", "-v", "0"], cwd=RAIZ, env=ambiente, check=True)
        cls.porta = porta_livre()
        cls.servidor = subprocess.Popen(
            [sys.executable, "manage.py", "runserver", f"127.0.0.1:{cls.porta}", "--noreload"],
            cwd=RAIZ,
            env=ambiente,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.url = f"http://127.0.0.1:{cls.porta}/"
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.url + "api/v1/saude", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        cls.pw = sync_playwright().start()
        cls.navegador = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.navegador.close()
        cls.pw.stop()
        cls.servidor.terminate()
        cls.servidor.wait(10)
        cls.pasta.cleanup()

    def test_carrega_com_a_versao_nova_e_todas_as_ferramentas(self):
        self.assertEqual(self.pagina.evaluate("() => window.crivo.versao"), VERSAO)
        self.assertEqual(self.pagina.locator("#ferramentas .ferramenta").count(), 13)
        cabecalhos = self.pagina.request.get(self.url).headers
        self.assertIn("default-src 'self'", cabecalhos["content-security-policy"])

    def test_salvar_no_servidor_e_baixar_png(self):
        self.ferramenta("b", "lapis")
        self.arrastar((1, 1), (5, 1))
        self.pagina.keyboard.press("Control+s")
        self.pagina.wait_for_function("() => window.crivo.editor.projeto.id")
        pid = self.pagina.evaluate("() => window.crivo.editor.projeto.id")
        r = self.pagina.request.get(f"{self.url}api/v1/projetos/{pid}/png?escala=2")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.body()[:8], b"\x89PNG\r\n\x1a\n")


class ArquivoUnicoTeste(TestesDoEditor, unittest.TestCase):
    """O mesmo editor no Crivo.html, aberto direto do disco (file://), sem servidor local e sem backend."""

    @classmethod
    def setUpClass(cls):
        cls.url = (RAIZ / "Crivo.html").as_uri()
        cls.pw = sync_playwright().start()
        cls.navegador = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.navegador.close()
        cls.pw.stop()

    def test_abre_do_disco_sem_servidor_e_com_csp_embutida(self):
        self.assertEqual(self.pagina.evaluate("() => location.protocol"), "file:")
        self.assertEqual(self.pagina.evaluate("() => window.crivo.versao"), VERSAO)
        self.assertEqual(self.pagina.locator("#ferramentas .ferramenta").count(), 13)
        politica = self.pagina.get_attribute('meta[http-equiv="Content-Security-Policy"]', "content")
        self.assertIn("default-src 'none'", politica)
        self.assertIn("connect-src 'none'", politica, "sem servidor, a página não fala com a rede")
        self.assertIn("Modo local", self.pagina.inner_text("#status-armazenamento"))
        self.pagina.get_by_role("button", name="Arquivo", exact=True).click()
        self.assertEqual(self.pagina.get_by_role("menuitem", name="Sair do Crivo").count(), 0, "fora do app desktop não há Sair")
        self.pagina.keyboard.press("Escape")

    def test_salvar_no_navegador_reabrir_baixar_e_abrir_arquivo(self):
        self.ferramenta("b", "lapis")
        self.arrastar((1, 1), (5, 1))
        cor = self.pixel(3, 1)
        self.assertNotEqual(cor, 0)
        self.pagina.keyboard.press("Control+s")
        self.pagina.wait_for_function("() => window.crivo.editor.projeto.local")
        self.assertTrue(self.pagina.evaluate("() => window.crivo.editor.projeto.local").startswith("local-"))
        self.assertIsNone(self.pagina.evaluate("() => window.crivo.editor.projeto.id"), "nada foi para um servidor")

        self.pagina.reload()
        self.pagina.wait_for_selector("body.pronto")
        self.menu("Arquivo", "Projetos salvos…")
        self.pagina.locator(".lista-projetos .projeto").first.wait_for()  # a lista carrega do IndexedDB sem bloquear
        self.assertEqual(self.pagina.locator(".lista-projetos .projeto").count(), 1, "o projeto ficou salvo no navegador")
        self.pagina.locator(".lista-projetos .projeto").get_by_role("button", name="Abrir").click()
        self.pagina.wait_for_function("() => !document.querySelector('.lista-projetos')")
        self.assertEqual(self.pixel(3, 1), cor)

        with self.pagina.expect_download() as baixado:
            self.menu("Arquivo", "Baixar arquivo .crivo")
        caminho = baixado.value.path()
        self.assertTrue(baixado.value.suggested_filename.endswith(".crivo"))
        self.assertEqual(json.loads(Path(caminho).read_text(encoding="utf-8"))["formato"], "crivo")

        self.pagina.locator("#visor").hover()
        self.pagina.keyboard.press("Delete")
        self.assertEqual(self.pixel(3, 1), 0)
        with self.pagina.expect_file_chooser() as escolha:
            self.menu("Arquivo", "Abrir arquivo .crivo…")
        escolha.value.set_files(caminho)
        confirmar = self.pagina.get_by_role("button", name="Abrir mesmo assim")
        if confirmar.count():
            confirmar.click()
        self.pagina.wait_for_function("([x, y]) => { const e = window.crivo.editor; return e.celulaAtiva()[y * e.doc.largura + x] !== 0; }", arg=[3, 1])
        self.assertEqual(self.pixel(3, 1), cor, "o arquivo .crivo baixado abre de volta no Crivo.html")

    def test_integracao_com_o_app_desktop(self):
        """Com o window.crivoDesktop que o Crivo.exe cria, aparecem a tela cheia (F11), o Sair e o rótulo do desktop."""
        self.pagina.add_init_script(
            """
            window.__chamadas = [];
            window.crivoDesktop = Object.freeze({
              versao: 'teste',
              alternarTelaCheia: () => { window.__chamadas.push('telaCheia'); return Promise.resolve(false); },
              sair: () => { window.__chamadas.push('sair'); return Promise.resolve(); },
            });
            """
        )
        self.pagina.reload()
        self.pagina.wait_for_selector("body.pronto")
        self.assertIn("Desktop", self.pagina.inner_text("#status-armazenamento"))
        self.pagina.keyboard.press("F11")
        self.assertEqual(self.pagina.evaluate("() => window.__chamadas"), ["telaCheia"])
        self.menu("Exibir", "Tela cheia")
        self.assertEqual(self.pagina.evaluate("() => window.__chamadas"), ["telaCheia", "telaCheia"])
        self.assertTrue(self.pagina.evaluate("() => typeof window.__crivoAntesDeFechar === 'function'"))

        self.ferramenta("b", "lapis")
        self.arrastar((2, 2), (6, 2))
        self.menu("Arquivo", "Sair do Crivo")
        self.pagina.wait_for_function("() => window.__chamadas.includes('sair')")
        self.pagina.reload()
        self.pagina.wait_for_selector("body.pronto")
        self.assertNotEqual(self.pixel(4, 2), 0, "o rascunho foi gravado antes de sair e volta ao reabrir")


if __name__ == "__main__":
    unittest.main()
