"""End-to-end tests of the interface with Playwright (Chromium), in both ways of opening the editor:

- ServerInterfaceTest: against the real Django server (API + database);
- SingleFileTest: Crivo.html opened straight from disk (file://), with no server and no backend,
  including the integration with the desktop app (Crivo.exe opens this same file).

The drawing tests apply to both and live in EditorTests.

Run:  pip install playwright && python -m playwright install chromium
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

ROOT = Path(__file__).resolve().parents[2]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class EditorTests:
    """Tests that apply to the editor served by Django and to Crivo.html opened from disk."""

    url = ""
    browser = None

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(self.url)
        self.page.wait_for_selector("body.ready")
        self.page.evaluate("() => { const e = window.crivo.editor; e.setColor('primary', 0xff161c5d); e.setColor('secondary', 0xffcedde6); }")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "the page must not log console errors (including CSP violations)")

    # helpers ----------------------------------------------------------------------------------------------
    def point(self, x, y):
        return self.page.evaluate(
            """([x, y]) => {
                const v = window.crivo.viewport;
                const r = v.canvas.getBoundingClientRect();
                return [r.left + v.panX + (x + 0.5) * v.zoom, r.top + v.panY + (y + 0.5) * v.zoom];
            }""",
            [x, y],
        )

    def drag(self, start, end, button="left", steps=8):
        m = self.page.mouse
        m.move(*self.point(*start))
        m.down(button=button)
        m.move(*self.point(*end), steps=steps)
        m.up(button=button)

    def pixel(self, x, y):
        return self.page.evaluate("([x, y]) => { const e = window.crivo.editor; return e.activeCell()[y * e.doc.width + x] >>> 0; }", [x, y])

    def tool(self, key, id_):
        self.page.locator("#viewport").hover()
        self.page.keyboard.press(key)
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.state.tool"), id_)

    def menu(self, title, item):
        self.page.get_by_role("button", name=title, exact=True).click()
        self.page.get_by_role("menuitem", name=item).click()

    # tests ------------------------------------------------------------------------------------------------
    def test_dither_draws_the_checkerboard_pattern(self):
        self.tool("d", "dither")
        self.page.evaluate("() => window.crivo.editor.setState('density', 50)")
        self.drag((2, 4), (9, 4))
        first, second = self.pixel(2, 4), self.pixel(3, 4)
        self.assertNotEqual(first, second)
        self.assertEqual(self.pixel(4, 4), first)
        self.assertEqual(self.pixel(5, 4), second)

    def test_selection_copy_paste_and_move(self):
        self.tool("b", "pencil")
        self.drag((3, 3), (3, 3), steps=1)
        self.drag((20, 20), (20, 20), steps=1)
        color = self.pixel(3, 3)
        self.assertNotEqual(color, 0)
        self.tool("s", "selection")
        self.drag((2, 2), (4, 4))
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.selection"), {"x": 2, "y": 2, "width": 3, "height": 3})
        self.page.keyboard.press("Control+c")
        self.page.keyboard.press("Control+v")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.state.tool"), "movePixels")
        self.drag((3, 3), (13, 8))
        self.assertEqual(self.pixel(13, 8), color, "the pasted content was dragged")
        self.assertEqual(self.pixel(3, 3), color, "the paste floats: the original stays in place")
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(self.pixel(14, 8), color, "arrow keys push 1 px")
        self.page.keyboard.press("Delete")
        self.assertEqual(self.pixel(14, 8), 0, "Delete erases only the selection")
        self.assertEqual(self.pixel(20, 20), color, "nothing changes outside the selection")
        self.page.keyboard.press("Escape")
        self.assertIsNone(self.page.evaluate("() => window.crivo.editor.selection"))

    def test_gradient_and_lighten_darken(self):
        self.tool("u", "gradient")
        self.drag((0, 0), (31, 0))
        start, end = self.pixel(0, 10), self.pixel(31, 10)
        self.assertEqual(start, self.page.evaluate("() => window.crivo.editor.state.primaryColor"))
        self.assertEqual(end, self.page.evaluate("() => window.crivo.editor.state.secondaryColor"))
        self.tool("q", "shade")
        self.page.evaluate("() => window.crivo.editor.setState('shadeMode', 'light')")
        before = self.pixel(0, 10)
        self.drag((0, 10), (0, 10), steps=1)
        self.assertNotEqual(self.pixel(0, 10), before)
        self.drag((0, 12), (0, 12), button="right", steps=1)
        self.assertNotEqual(self.pixel(0, 12), before)

    def test_pixel_perfect_removes_corners(self):
        self.tool("b", "pencil")
        self.page.evaluate("() => { window.crivo.editor.setState('size', 1); window.crivo.editor.setState('pixelPerfect', true); }")
        m = self.page.mouse
        m.move(*self.point(5, 5))
        m.down()
        for x, y in ((6, 5), (6, 6), (7, 6), (7, 7)):
            m.move(*self.point(x, y), steps=2)
        m.up()
        self.assertEqual(self.pixel(6, 5), 0, "the L corner was removed")
        self.assertNotEqual(self.pixel(6, 6), 0)

    def test_image_commands_and_undo(self):
        self.tool("r", "rectangle")
        self.page.evaluate("() => window.crivo.editor.setState('filled', true)")
        self.drag((10, 10), (14, 12))
        self.menu("Imagem", "Adicionar contorno (4 vizinhos)")
        self.assertNotEqual(self.pixel(9, 10), 0)
        self.menu("Imagem", "Aparar bordas transparentes")
        size = self.page.evaluate("() => [window.crivo.editor.doc.width, window.crivo.editor.doc.height]")
        self.assertEqual(size, [7, 5])
        self.menu("Imagem", "Inverter cores")
        self.menu("Imagem", "Tons de cinza")
        self.menu("Imagem", "Converter para a paleta atual")
        self.page.keyboard.press("t")
        self.assertTrue(self.page.evaluate("() => window.crivo.editor.state.tile"))
        self.page.keyboard.press("Shift+T")
        for _ in range(10):
            self.page.keyboard.press("Control+z")
        self.assertEqual(self.page.evaluate("() => [window.crivo.editor.doc.width, window.crivo.editor.history.past.length]"), [32, 0])

    def test_flip_selection_replace_color_and_gif(self):
        self.tool("b", "pencil")
        self.drag((0, 0), (0, 0), steps=1)
        primary = self.pixel(0, 0)
        self.tool("s", "selection")
        self.drag((0, 0), (3, 1))
        self.page.keyboard.press("Shift+H")
        self.assertEqual(self.pixel(3, 0), primary, "flipped only inside the selection")
        self.assertEqual(self.pixel(0, 0), 0)
        self.page.keyboard.press("Control+d")
        self.menu("Imagem", "Substituir a cor primária pela secundária (todos os quadros)")
        self.assertEqual(self.pixel(3, 0), self.page.evaluate("() => window.crivo.editor.state.secondaryColor"))
        self.page.locator("#viewport").hover()
        self.page.keyboard.press("Control+Shift+G")
        with self.page.expect_download() as download:
            self.page.get_by_role("button", name="Baixar").click()
        path = download.value.path()
        self.assertTrue(download.value.suggested_filename.endswith(".gif"))
        self.assertEqual(Path(path).read_bytes()[:6], b"GIF89a")

    def test_paste_keeps_the_background_and_gestures_are_protected(self):
        self.tool("f", "bucket")
        self.page.mouse.click(*self.point(0, 0))
        background = self.pixel(0, 0)
        self.page.evaluate("() => { const e = window.crivo.editor; e.setColor('primary', 0xff0000ff); }")
        self.tool("b", "pencil")
        self.drag((2, 2), (2, 2), steps=1)
        red = self.pixel(2, 2)
        self.tool("s", "selection")
        self.drag((2, 2), (4, 4))
        self.page.keyboard.press("Control+c")
        self.page.keyboard.press("Control+v")
        self.drag((3, 3), (13, 3))
        self.assertEqual(self.pixel(12, 2), red)
        self.assertEqual(self.pixel(13, 3), background, "a transparent pixel of the paste shows the background, carrying nothing along")
        self.assertEqual(self.pixel(2, 2), red, "where the paste was, the background stays whole")
        for _ in range(40):
            self.page.keyboard.press("ArrowLeft")
        for _ in range(40):
            self.page.keyboard.press("ArrowRight")
        self.assertEqual(self.pixel(12, 2), red, "moving past the edge and back loses no pixels")
        steps = self.page.evaluate("() => window.crivo.editor.history.past.length")
        m = self.page.mouse
        m.move(*self.point(12, 2))
        m.down()
        m.move(*self.point(20, 10), steps=3)
        self.page.keyboard.press("Control+z")
        m.up()
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), steps + 1, "Ctrl+Z in the middle of a drag is ignored")
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(12, 2), red)
        self.page.get_by_role("button", name="Editar", exact=True).click()
        self.page.keyboard.press("ArrowDown")
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), steps, "arrow keys in a menu do not move pixels")
        self.assertIsNotNone(self.page.evaluate("() => window.crivo.editor.selection"), "Esc in a menu closes the menu without deselecting")
        self.tool("u", "gradient")
        self.page.mouse.click(*self.point(25, 25))
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), steps, "a click without dragging with the gradient paints nothing")

    def test_invalid_browser_preferences_are_ignored(self):
        self.page.evaluate("() => { localStorage.setItem('crivo.gradientMatrix', '16'); localStorage.setItem('crivo.tool', '\"<img>\"'); localStorage.setItem('crivo.size', '999'); }")
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        state = self.page.evaluate("() => { const e = window.crivo.editor.state; return [e.gradientMatrix, e.tool, e.size]; }")
        self.assertEqual(state, [4, "pencil", 1])

    def test_crivo_1_preferences_are_migrated(self):
        self.page.evaluate(
            """() => {
                localStorage.clear();
                localStorage.setItem('crivo.ferramenta', '"balde"');
                localStorage.setItem('crivo.tema', '"escuro"');
                localStorage.setItem('crivo.simetria', '"ambas"');
                localStorage.setItem('crivo.tons', '{"passos":5,"intensidade":60,"desvio":10}');
            }"""
        )
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        state = self.page.evaluate("() => { const e = window.crivo.editor.state; return [e.tool, e.symmetry, document.documentElement.dataset.theme]; }")
        self.assertEqual(state, ["bucket", "both", "dark"])
        stored = self.page.evaluate("() => [localStorage.getItem('crivo.ferramenta'), JSON.parse(localStorage.getItem('crivo.ramp'))]")
        self.assertEqual(stored, [None, {"steps": 5, "intensity": 60, "shift": 10}])


class ServerInterfaceTest(EditorTests, unittest.TestCase):
    """The editor served by Django, with the API and the database."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        env = {k: v for k, v in os.environ.items() if not k.startswith("CRIVO_")}
        env.update(CRIVO_SQLITE_PATH=str(Path(cls.folder.name) / "e2e.sqlite3"), CRIVO_DEBUG="true", CRIVO_WRITE_LIMIT="0")
        subprocess.run([sys.executable, "manage.py", "migrate", "-v", "0"], cwd=ROOT, env=env, check=True)
        cls.port = free_port()
        cls.server = subprocess.Popen(
            [sys.executable, "manage.py", "runserver", f"127.0.0.1:{cls.port}", "--noreload"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.url = f"http://127.0.0.1:{cls.port}/"
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.url + "api/v2/health", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.terminate()
        cls.server.wait(10)
        cls.folder.cleanup()

    def test_loads_the_new_version_and_every_tool(self):
        self.assertEqual(self.page.evaluate("() => window.crivo.version"), VERSION)
        self.assertEqual(self.page.locator("#tools .tool").count(), 13)
        headers = self.page.request.get(self.url).headers
        self.assertIn("default-src 'self'", headers["content-security-policy"])

    def test_save_to_the_server_and_download_png(self):
        self.tool("b", "pencil")
        self.drag((1, 1), (5, 1))
        self.page.keyboard.press("Control+s")
        self.page.wait_for_function("() => window.crivo.editor.project.id")
        pid = self.page.evaluate("() => window.crivo.editor.project.id")
        r = self.page.request.get(f"{self.url}api/v2/projects/{pid}/png?scale=2")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.body()[:8], b"\x89PNG\r\n\x1a\n")
        data = self.page.request.get(f"{self.url}api/v2/projects/{pid}").json()["data"]
        self.assertEqual((data["format"], data["version"]), ("crivo", 2))


class SingleFileTest(EditorTests, unittest.TestCase):
    """The same editor in Crivo.html, opened straight from disk (file://), with no local server and no backend."""

    @classmethod
    def setUpClass(cls):
        cls.url = (ROOT / "Crivo.html").as_uri()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def test_opens_from_disk_without_a_server_and_with_an_inline_csp(self):
        self.assertEqual(self.page.evaluate("() => location.protocol"), "file:")
        self.assertEqual(self.page.evaluate("() => window.crivo.version"), VERSION)
        self.assertEqual(self.page.locator("#tools .tool").count(), 13)
        policy = self.page.get_attribute('meta[http-equiv="Content-Security-Policy"]', "content")
        self.assertIn("default-src 'none'", policy)
        self.assertIn("connect-src 'none'", policy, "without a server, the page does not talk to the network")
        self.assertIn("Modo local", self.page.inner_text("#status-storage"))
        self.page.get_by_role("button", name="Arquivo", exact=True).click()
        self.assertEqual(self.page.get_by_role("menuitem", name="Sair do Crivo").count(), 0, "outside the desktop app there is no Quit")
        self.page.keyboard.press("Escape")

    def test_save_in_the_browser_reopen_download_and_open_file(self):
        self.tool("b", "pencil")
        self.drag((1, 1), (5, 1))
        color = self.pixel(3, 1)
        self.assertNotEqual(color, 0)
        self.page.keyboard.press("Control+s")
        self.page.wait_for_function("() => window.crivo.editor.project.local")
        self.assertTrue(self.page.evaluate("() => window.crivo.editor.project.local").startswith("local-"))
        self.assertIsNone(self.page.evaluate("() => window.crivo.editor.project.id"), "nothing went to a server")

        self.page.reload()
        self.page.wait_for_selector("body.ready")
        self.menu("Arquivo", "Projetos salvos…")
        self.page.locator(".project-list .project").first.wait_for()  # the list loads from IndexedDB without blocking
        self.assertEqual(self.page.locator(".project-list .project").count(), 1, "the project stayed saved in the browser")
        self.page.locator(".project-list .project").get_by_role("button", name="Abrir").click()
        self.page.wait_for_function("() => !document.querySelector('.project-list')")
        self.assertEqual(self.pixel(3, 1), color)

        with self.page.expect_download() as download:
            self.menu("Arquivo", "Baixar arquivo .crivo")
        path = download.value.path()
        self.assertTrue(download.value.suggested_filename.endswith(".crivo"))
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        self.assertEqual((saved["format"], saved["version"]), ("crivo", 2))

        self.page.locator("#viewport").hover()
        self.page.keyboard.press("Delete")
        self.assertEqual(self.pixel(3, 1), 0)
        with self.page.expect_file_chooser() as chooser:
            self.menu("Arquivo", "Abrir arquivo .crivo…")
        chooser.value.set_files(path)
        confirm = self.page.get_by_role("button", name="Abrir mesmo assim")
        if confirm.count():
            confirm.click()
        self.page.wait_for_function("([x, y]) => { const e = window.crivo.editor; return e.activeCell()[y * e.doc.width + x] !== 0; }", arg=[3, 1])
        self.assertEqual(self.pixel(3, 1), color, "the downloaded .crivo file opens back in Crivo.html")

    def test_crivo_1_browser_data_is_migrated(self):
        """Projects and the draft saved by Crivo 1.x (IndexedDB version 1, Portuguese stores and fields) survive the upgrade."""
        self.page.evaluate(
            """async () => {
                await new Promise((resolve, reject) => {
                    const del = indexedDB.deleteDatabase('crivo');
                    del.onsuccess = resolve;
                    del.onerror = () => reject(del.error);
                });
                const v1 = {
                    formato: 'crivo', versao: 1, nome: 'Antigo', largura: 4, altura: 4, fps: 8, paleta: ['#ff0000'],
                    camadas: [{ id: 'c1', nome: 'Camada 1', visivel: true, opacidade: 100, bloqueada: false }],
                    quadros: [{ id: 'q1', duracao: null }],
                    celulas: [],
                };
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('crivo', 1);
                    req.onupgradeneeded = () => {
                        req.result.createObjectStore('projetos', { keyPath: 'id' });
                        req.result.createObjectStore('rascunho');
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(['projetos', 'rascunho'], 'readwrite');
                    tx.objectStore('projetos').put({ id: 'local-antigo', nome: 'Antigo', dados: v1, miniatura: null, revisao: null, atualizado_em: '2026-01-01T00:00:00Z' });
                    tx.objectStore('rascunho').put({ dados: { ...v1, nome: 'Rascunho antigo' }, projeto: { id: null, revisao: null, local: 'local-antigo' }, modificado: true, quando: '2026-01-01T00:00:00Z' }, 'atual');
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
                db.close();
                // Keep the page from saving its own draft on reload, which would open (and upgrade) the database first.
                indexedDB.open = () => {
                    throw new Error('blocked by the test');
                };
            }"""
        )
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        restored = self.page.evaluate("() => { const e = window.crivo.editor; return [e.doc.name, e.doc.width, e.project.local, e.modified]; }")
        self.assertEqual(restored, ["Rascunho antigo", 4, "local-antigo", True])
        stores = self.page.evaluate(
            """() => new Promise((resolve) => {
                const req = indexedDB.open('crivo');
                req.onsuccess = () => { const db = req.result; const names = [...db.objectStoreNames].sort(); db.close(); resolve([db.version, names]); };
            })"""
        )
        self.assertEqual(stores, [2, ["draft", "projects"]])
        self.menu("Arquivo", "Projetos salvos…")
        self.page.locator(".project-list .project").first.wait_for()
        self.assertIn("Antigo", self.page.inner_text(".project-list"))

    def test_desktop_app_integration(self):
        """With the window.crivoDesktop that Crivo.exe creates, fullscreen (F11), Quit and the desktop label show up."""
        self.page.add_init_script(
            """
            window.__calls = [];
            window.crivoDesktop = Object.freeze({
              version: 'test',
              toggleFullscreen: () => { window.__calls.push('fullscreen'); return Promise.resolve(false); },
              quit: () => { window.__calls.push('quit'); return Promise.resolve(); },
            });
            """
        )
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        self.assertIn("Desktop", self.page.inner_text("#status-storage"))
        self.page.keyboard.press("F11")
        self.assertEqual(self.page.evaluate("() => window.__calls"), ["fullscreen"])
        self.menu("Exibir", "Tela cheia")
        self.assertEqual(self.page.evaluate("() => window.__calls"), ["fullscreen", "fullscreen"])
        self.assertTrue(self.page.evaluate("() => typeof window.__crivoBeforeClose === 'function'"))

        self.tool("b", "pencil")
        self.drag((2, 2), (6, 2))
        self.menu("Arquivo", "Sair do Crivo")
        self.page.wait_for_function("() => window.__calls.includes('quit')")
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        self.assertNotEqual(self.pixel(4, 2), 0, "the draft was saved before quitting and comes back when reopening")


if __name__ == "__main__":
    unittest.main()
