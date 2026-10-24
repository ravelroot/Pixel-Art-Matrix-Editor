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

    # The quick tutorial shows only on the first run, and a headless browser cannot answer the "Save as" window:
    # the tests start as if the tutorial had already been seen and save by download (they test both on their own).
    SETUP_SCRIPT = """
        try { localStorage.setItem('crivo.tutorial', '"shown"'); } catch {}
        window.showSaveFilePicker = undefined;
    """

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.context.add_init_script(self.SETUP_SCRIPT)
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

    def selection_box(self):
        return self.page.evaluate("() => { const s = window.crivo.editor.selection; return s && [s.x, s.y, s.width, s.height, Boolean(s.mask)]; }")

    def test_lasso_selection_delete_and_invert(self):
        self.tool("f", "bucket")
        self.page.mouse.click(*self.point(0, 0))
        background = self.pixel(0, 0)
        self.tool("a", "lasso")
        m = self.page.mouse
        m.move(*self.point(2, 2))
        m.down()
        for p in [(12, 2), (2, 12), (2, 2)]:
            m.move(*self.point(*p), steps=6)
        m.up()
        self.assertEqual(self.selection_box(), [2, 2, 11, 11, True], "the lasso makes a non-rectangular selection")
        steps = self.page.evaluate("() => window.crivo.editor.history.past.length")
        self.page.keyboard.press("Delete")
        self.assertEqual(self.pixel(3, 3), 0, "inside the lasso is erased")
        self.assertEqual(self.pixel(11, 11), background, "the corner of the box outside the lasso stays")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), steps + 1)
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(3, 3), background)
        self.page.keyboard.press("Control+Shift+I")
        self.assertEqual(self.selection_box(), [0, 0, 32, 32, True])
        self.page.keyboard.press("Delete")
        self.assertEqual(self.pixel(20, 20), 0, "the inverted selection erases outside the lasso")
        self.assertEqual(self.pixel(3, 3), background)
        self.page.keyboard.press("Control+d")
        self.assertIsNone(self.selection_box())
        self.page.keyboard.press("Control+Shift+D")
        self.assertEqual(self.selection_box(), [0, 0, 32, 32, True], "Reselect brings the last selection back")

    def test_magic_wand_modes_and_selection_menu(self):
        self.tool("b", "pencil")
        self.drag((2, 5), (8, 5))
        self.drag((20, 20), (20, 20), steps=1)
        self.tool("w", "magicWand")
        self.page.mouse.click(*self.point(4, 5))
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.selection"), {"x": 2, "y": 5, "width": 7, "height": 1}, "a rectangular result keeps the plain shape")
        self.page.keyboard.down("Shift")
        self.page.mouse.click(*self.point(20, 20))
        self.page.keyboard.up("Shift")
        self.assertEqual(self.selection_box(), [2, 5, 19, 16, True], "Shift adds to the selection")
        self.page.keyboard.down("Alt")
        self.page.mouse.click(*self.point(4, 5))
        self.page.keyboard.up("Alt")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.selection"), {"x": 20, "y": 20, "width": 1, "height": 1}, "Alt subtracts")
        self.page.evaluate("() => window.crivo.editor.setState('contiguous', false)")
        self.page.mouse.click(*self.point(4, 5))
        self.assertEqual(self.selection_box(), [2, 5, 19, 16, True], "not contiguous: every pixel of the color")
        self.page.keyboard.press("Delete")
        self.assertEqual([self.pixel(4, 5), self.pixel(20, 20)], [0, 0])
        self.page.keyboard.press("Control+z")
        self.page.mouse.click(*self.point(4, 5))
        self.menu("Seleção", "Expandir seleção…")
        self.page.locator("dialog input[type=number]").fill("1")
        self.page.get_by_role("button", name="Expandir", exact=True).click()
        self.assertEqual(self.selection_box(), [1, 4, 21, 18, True])
        self.menu("Seleção", "Inverter seleção")
        self.assertEqual(self.selection_box(), [0, 0, 32, 32, True])

    def test_polygon_curve_and_ink_modes(self):
        primary = self.page.evaluate("() => window.crivo.editor.state.primaryColor >>> 0")
        self.tool("Shift+O", "polygon")
        self.page.evaluate("() => window.crivo.editor.setState('filled', true)")
        steps = self.page.evaluate("() => window.crivo.editor.history.past.length")
        self.page.mouse.click(*self.point(2, 2))
        self.page.mouse.click(*self.point(10, 2))
        self.page.mouse.dblclick(*self.point(10, 10))
        self.assertEqual(self.pixel(8, 4), primary, "the polygon is filled")
        self.assertEqual(self.pixel(3, 9), 0, "outside the triangle stays empty")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), steps + 1, "one undo step")
        self.tool("Shift+L", "curve")
        self.drag((0, 20), (12, 20))
        self.assertEqual(self.pixel(6, 20), 0, "the curve waits for the bends")
        self.drag((6, 20), (6, 14))
        self.page.keyboard.press("Enter")
        self.assertEqual([self.pixel(0, 20), self.pixel(12, 20)], [primary, primary], "the curve keeps its endpoints")
        self.assertNotEqual(self.pixel(6, 20), primary, "and bends away from the straight line")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.nextUndo"), "Curva")
        self.page.evaluate("() => { const e = window.crivo.editor; e.setColor('primary', 0xff00ff00); e.setState('inkMode', 'behind'); }")
        self.tool("b", "pencil")
        self.assertEqual(self.page.locator("#options select[aria-label='Modo de tinta']").input_value(), "behind")
        self.drag((2, 2), (12, 2))
        self.assertEqual(self.pixel(4, 2), primary, "Atrás does not cover painted pixels")
        self.assertEqual(self.pixel(12, 2), 0xFF00FF00, "and paints where it is transparent")

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

    # files & workspace (2.1) ------------------------------------------------------------------------------
    def tab_count(self):
        return self.page.locator("#doc-tabs .doc-tab").count()

    def test_tabs_open_a_second_document_switch_and_close(self):
        self.tool("b", "pencil")
        self.drag((3, 3), (3, 3), steps=1)
        color = self.pixel(3, 3)
        self.assertNotEqual(color, 0)
        self.menu("Arquivo", "Novo projeto…")
        self.page.get_by_role("button", name="Criar").click()
        self.assertEqual(self.tab_count(), 2, "a new project opens in a second tab")
        self.assertEqual(self.pixel(3, 3), 0)
        self.page.locator("#viewport").hover()
        self.page.keyboard.press("Control+Tab")
        self.assertEqual(self.pixel(3, 3), color, "Ctrl+Tab brings the first document back")
        self.assertEqual(self.page.evaluate("() => [window.crivo.editor.history.past.length, window.crivo.editor.modified]"), [1, True], "with its own history")
        self.page.locator("#doc-tabs .doc-tab-name").nth(1).click()
        self.assertEqual(self.pixel(3, 3), 0)
        self.page.locator("#doc-tabs .doc-tab-close").nth(1).click()
        self.assertEqual(self.tab_count(), 1, "an unmodified tab closes without asking")
        self.assertEqual(self.pixel(3, 3), color)
        self.page.locator("#doc-tabs .doc-tab-close").first.click()
        self.page.get_by_role("button", name="Fechar sem salvar").click()
        self.assertEqual(self.pixel(3, 3), 0, "closing the last modified tab asks first and leaves a blank project")
        self.page.locator("#viewport").hover()
        self.page.keyboard.press("F7")
        self.assertTrue(self.page.locator("#minimap").is_visible(), "F7 shows the preview window")
        before = self.page.evaluate("() => [window.crivo.viewport.panX, window.crivo.viewport.panY]")
        box = self.page.locator("#minimap canvas").bounding_box()
        self.page.mouse.click(box["x"] + 2, box["y"] + 2)
        self.assertNotEqual(self.page.evaluate("() => [window.crivo.viewport.panX, window.crivo.viewport.panY]"), before, "clicking the preview pans the view")
        self.page.keyboard.press("F7")
        self.assertFalse(self.page.locator("#minimap").is_visible())

    def test_export_aseprite_apng_and_reopen(self):
        self.tool("b", "pencil")
        self.drag((5, 5), (8, 5))
        color = self.pixel(6, 5)
        with self.page.expect_download() as download:
            self.menu("Arquivo", "Exportar como .ase")
        self.assertTrue(download.value.suggested_filename.endswith(".ase"))
        path = download.value.path()
        data = Path(path).read_bytes()
        self.assertEqual(data[4:6], b"\xe0\xa5", "Aseprite magic number")
        with self.page.expect_file_chooser() as chooser:
            self.menu("Arquivo", "Abrir arquivo…")
        chooser.value.set_files(path)
        self.page.wait_for_function("() => document.querySelectorAll('#doc-tabs .doc-tab').length === 2")
        self.assertEqual(self.pixel(6, 5), color, "the exported .ase opens back in a new tab")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.modified"), False)
        self.menu("Arquivo", "Exportar PNG animado (APNG)…")
        with self.page.expect_download() as download:
            self.page.get_by_role("button", name="Baixar").click()
        png = Path(download.value.path()).read_bytes()
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertIn(b"acTL", png)
        # Dropping a .crivo file on the canvas opens it in another tab.
        self.page.evaluate(
            """() => {
                const data = { format: 'crivo', version: 2, name: 'Solto', width: 4, height: 4, fps: 8, layers: [{ id: 'c1', name: 'C' }], frames: [{ id: 'q1' }], cells: [] };
                const dt = new DataTransfer();
                dt.items.add(new File([JSON.stringify(data)], 'solto.crivo', { type: 'application/json' }));
                document.querySelector('.area').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
            }"""
        )
        self.page.wait_for_function("() => window.crivo.editor.doc.name === 'Solto'")
        self.assertEqual(self.tab_count(), 3)

    # quick tutorial and the "Save as" window -------------------------------------------------------------
    def test_first_run_tutorial_shows_once_and_can_be_declined(self):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script("window.showSaveFilePicker = undefined;")
        page = context.new_page()
        try:
            page.goto(self.url)
            page.wait_for_selector("body.ready")
            welcome = page.locator("dialog.tour .tour-welcome")
            welcome.wait_for()
            self.assertIn("Bem-vindo ao Crivo", welcome.inner_text())
            page.get_by_role("button", name="Agora não").click()
            self.assertEqual(page.locator("dialog.tour").count(), 0)
            self.assertEqual(page.evaluate("() => localStorage.getItem('crivo.tutorial')"), '"declined"')
            page.reload()
            page.wait_for_selector("body.ready")
            page.wait_for_timeout(200)
            self.assertEqual(page.locator("dialog.tour").count(), 0, "the tutorial is offered only once")

            # Ajuda › Tutorial rápido opens it again, straight on the first step, and covers every tool.
            page.get_by_role("button", name="Ajuda", exact=True).click()
            page.get_by_role("menuitem", name="Tutorial rápido").click()
            self.assertEqual(page.locator(".tour-step").text_content(), "1 de 8")
            listed = []
            for step in range(8):
                listed += page.eval_on_selector_all(".tour-tools li strong", "items => items.map((i) => i.textContent)")
                self.assertGreater(page.locator(".tour-ring").count(), 0, "each step lights up part of the screen")
                if step < 7:
                    page.keyboard.press("ArrowRight")
            self.assertEqual(page.locator(".tour-step").text_content(), "8 de 8")
            self.assertEqual(sorted(listed), sorted(page.evaluate("() => [...document.querySelectorAll('#tools .tool')].map((b) => b.title.replace(/ \\(.*$/, ''))")))
            page.get_by_role("button", name="Começar a desenhar").click()
            self.assertEqual(page.locator("dialog.tour").count(), 0)
            page.locator("#viewport").hover()
            page.keyboard.press("e")
            self.assertEqual(page.evaluate("() => window.crivo.editor.state.tool"), "eraser", "shortcuts work again after the tutorial")
        finally:
            context.close()

    def test_first_run_tutorial_can_be_followed_and_closed_with_esc(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()
        try:
            page.goto(self.url)
            page.wait_for_selector("dialog.tour .tour-welcome")
            page.get_by_role("button", name="Ver tutorial").click()
            self.assertIn("Desenhar", page.inner_text("dialog.tour .tour-card"))
            page.get_by_role("button", name="Próximo").click()
            self.assertEqual(page.locator(".tour-step").text_content(), "2 de 8")
            page.get_by_role("button", name="Voltar").click()
            self.assertEqual(page.locator(".tour-step").text_content(), "1 de 8")
            box = page.locator("dialog.tour .tour-card").bounding_box()
            self.assertGreaterEqual(box["x"], 0)
            self.assertLessEqual(box["y"] + box["height"], 720, "the card fits on the screen")
            page.keyboard.press("Escape")
            self.assertEqual(page.locator("dialog.tour").count(), 0)
            page.reload()
            page.wait_for_selector("body.ready")
            page.wait_for_timeout(200)
            self.assertEqual(page.locator("dialog.tour").count(), 0)
        finally:
            context.close()

    def test_save_opens_the_save_as_window_once_and_exports_ask_too(self):
        # Chrome and Edge open the system "Save as" window through showSaveFilePicker; here it is a stand-in.
        self.page.evaluate(
            """() => {
                window.__picks = [];
                window.__writes = [];
                window.showSaveFilePicker = async (options) => {
                    window.__picks.push(options);
                    if (window.__cancel) throw new DOMException('canceled', 'AbortError');
                    const name = options.suggestedName;
                    return { name, createWritable: async () => ({ write: async (blob) => window.__writes.push([name, blob.type, blob.size, blob.type.includes('json') ? await blob.text() : '']), close: async () => {} }) };
                };
            }"""
        )
        self.tool("b", "pencil")
        self.drag((1, 1), (5, 1))
        self.page.keyboard.press("Control+s")
        self.page.wait_for_function("() => window.__writes.length === 1 && !window.crivo.editor.modified")
        picks = self.page.evaluate("() => window.__picks")
        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0]["suggestedName"], "Sem título.crivo")
        self.assertEqual(picks[0]["types"][0]["accept"], {"application/json": [".crivo"]})
        name, _, _, text = self.page.evaluate("() => window.__writes[0]")
        self.assertEqual(name, "Sem título.crivo")
        self.assertEqual(json.loads(text)["format"], "crivo")
        self.assertTrue(self.page.evaluate("() => Boolean(window.crivo.editor.project.id || window.crivo.editor.project.local)"), "it also goes to Projetos salvos")

        # The next Ctrl+S writes to the same file without asking again.
        self.drag((1, 3), (5, 3))
        self.page.keyboard.press("Control+s")
        self.page.wait_for_function("() => window.__writes.length === 2")
        self.assertEqual(self.page.evaluate("() => window.__picks.length"), 1)

        # "Salvar como…" (Ctrl+Shift+S) always asks; canceling saves nothing.
        self.page.evaluate("() => { window.__cancel = true; }")
        self.page.keyboard.press("Control+Shift+s")
        self.page.wait_for_function("() => window.__picks.length === 2")
        self.page.wait_for_timeout(200)
        self.assertEqual(self.page.evaluate("() => window.__writes.length"), 2)
        self.assertIn("Salvamento cancelado", self.page.inner_text("#toasts"))

        # Exports open the window too, with the image type; canceling keeps the export dialog open.
        self.menu("Arquivo", "Exportar imagem (PNG, JPEG ou GIF)…")
        self.page.get_by_role("button", name="Salvar…").click()
        self.page.wait_for_function("() => window.__picks.length === 3")
        self.assertTrue(self.page.locator("dialog.dialog").is_visible(), "canceling the Save as window keeps the export dialog")
        self.page.evaluate("() => { window.__cancel = false; }")
        self.page.get_by_role("button", name="Salvar…").click()
        self.page.wait_for_function("() => window.__writes.length === 3")
        pick = self.page.evaluate("() => window.__picks[3]")
        self.assertTrue(pick["suggestedName"].endswith(".png"))
        self.assertEqual(pick["types"][0]["accept"], {"image/png": [".png"]})
        self.assertEqual(self.page.evaluate("() => window.__writes[2][1]"), "image/png")
        self.page.wait_for_function("() => !document.querySelector('dialog.dialog')")

    # color (2.1) ------------------------------------------------------------------------------------------
    def test_color_brightness_dialog_previews_and_cancel_restores(self):
        self.tool("b", "pencil")
        self.drag((4, 4), (4, 4), steps=1)
        original = self.pixel(4, 4)
        self.page.get_by_role("button", name="Cor", exact=True).click()
        self.page.get_by_role("menuitem", name="Brilho e contraste…").click()
        self.page.get_by_role("slider", name="Brilho").fill("60")
        self.page.wait_for_function("([o]) => (window.crivo.editor.activeCell()[4 * 32 + 4] >>> 0) !== o", arg=[original])
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.past.length"), 1, "the preview is not an undo step")
        self.page.get_by_role("button", name="Cancelar").click()
        self.assertEqual(self.pixel(4, 4), original, "Cancel restores the cel")
        self.page.get_by_role("button", name="Cor", exact=True).click()
        self.page.get_by_role("menuitem", name="Brilho e contraste…").click()
        self.page.get_by_role("slider", name="Brilho").fill("60")
        self.page.get_by_role("button", name="OK").click()
        brighter = self.pixel(4, 4)
        self.assertNotEqual(brighter, original)
        self.assertEqual(brighter >> 24, original >> 24, "alpha kept")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.nextUndo"), "Brilho e contraste")
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(4, 4), original)

    def test_color_indexed_mode_snaps_colors_and_palette_edit_remaps(self):
        palette = self.page.evaluate("() => window.crivo.app.palette.current.colors.map((c) => c >>> 0)")
        self.page.evaluate("() => window.crivo.editor.setColor('primary', 0xff1020f0)")  # #f02010: not in the palette
        self.tool("b", "pencil")
        self.drag((2, 2), (2, 2), steps=1)
        self.assertNotIn(self.pixel(2, 2), palette)
        self.page.get_by_role("button", name="Cor", exact=True).click()
        self.page.get_by_role("menuitemcheckbox", name="Modo de cor: Indexado…").click()
        self.page.get_by_role("button", name="Converter").click()
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.doc.colorMode"), "indexed")
        self.assertIn(self.pixel(2, 2), palette, "the pixel went to the nearest palette color")
        self.assertIn(self.page.evaluate("() => window.crivo.editor.state.primaryColor"), palette, "the drawing color snaps too")
        self.page.evaluate("() => window.crivo.editor.setColor('primary', 0xff00ff00)")
        self.assertIn(self.page.evaluate("() => window.crivo.editor.state.primaryColor"), palette)
        # Editing the entry of that color in the palette editor recolors the pixel (a preset is copied first).
        index = palette.index(self.pixel(2, 2))
        self.page.get_by_role("button", name="Editar paleta", exact=True).click()
        dialog = self.page.locator("dialog[open]")
        dialog.locator(".palette-editor-grid .swatch").nth(index).click()
        hex_field = dialog.get_by_label("Código hexadecimal")
        hex_field.fill("#00ff00")
        hex_field.press("Enter")
        dialog.get_by_role("button", name="Salvar").click()
        self.page.wait_for_function("() => (window.crivo.editor.activeCell()[2 * 32 + 2] >>> 0) === 0xff00ff00")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.history.nextUndo"), "Editar paleta")
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(2, 2), palette[index])
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.doc.colorMode || 'rgba'"), "rgba", "undo goes back to RGBA")
        self.assertEqual(self.pixel(2, 2), 0xFF1020F0)

    # layers & animation (2.1) -----------------------------------------------------------------------------
    def layers_state(self):
        return self.page.evaluate(
            "() => { const d = window.crivo.editor.doc; return d.layers.map((c) => [c.name, c.kind, c.parent ? d.layer(c.parent).name : null, c.blendMode, c.reference]); }"
        )

    def composite_pixel(self, x, y):
        return self.page.evaluate("([x, y]) => { const e = window.crivo.editor; return e.doc.composite(e.state.frame)[y * e.doc.width + x] >>> 0; }", [x, y])

    def test_layer_group_blend_mode_and_reference_layer(self):
        self.tool("b", "pencil")
        self.drag((4, 4), (4, 4), steps=1)
        base = self.pixel(4, 4)
        self.menu("Camada", "Novo grupo")
        self.page.locator("#viewport").hover()
        self.page.keyboard.press("Shift+N")
        self.page.get_by_role("button", name="Descer camada").click()
        self.assertEqual([c[:3] for c in self.layers_state()], [["Camada 1", "image", None], ["Camada 2", "image", "Grupo 1"], ["Grupo 1", "group", None]])
        self.page.evaluate("() => window.crivo.editor.setColor('primary', 0xff3366cc)")
        self.drag((4, 4), (5, 4), steps=2)
        child = self.pixel(4, 4)
        self.assertEqual(self.composite_pixel(4, 4), child, "a normal group at 100% passes its children through")
        self.page.locator(".layer-list .layer.group .name").dblclick()
        dialog = self.page.locator("dialog[open]")
        dialog.locator("select[name=blendMode]").select_option("multiply")
        dialog.get_by_role("button", name="Aplicar").click()
        self.assertEqual(self.layers_state()[2][3], "multiply")
        mixed = self.composite_pixel(4, 4)
        self.assertNotIn(mixed, (base, child), "the group blends its children with multiply")
        self.assertEqual(self.composite_pixel(5, 4), child, "over transparent the child shows as is")
        self.assertIn("Multiplicar", self.page.locator(".layer-list .layer.group").inner_text())
        self.page.locator(".layer-list .layer", has_text="Camada 2").click()
        self.page.get_by_role("button", name="Camada", exact=True).click()
        self.page.get_by_role("menuitemcheckbox", name="Camada de referência").click()
        self.assertTrue(self.layers_state()[1][4])
        self.assertEqual(self.composite_pixel(4, 4), base, "reference layers stay out of the composite used by exports")
        self.page.keyboard.press("Control+z")
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.layers_state()[2][3], "normal", "undo restores the blend mode")

    def test_tags_playback_linked_frames_and_tilemap(self):
        self.page.locator("#viewport").hover()
        self.page.keyboard.press("Alt+n")
        self.page.keyboard.press("Alt+n")
        self.assertEqual(self.page.evaluate("() => window.crivo.editor.doc.frames.length"), 3)
        self.menu("Quadro", "Nova tag…")
        dialog = self.page.locator("dialog[open]")
        dialog.get_by_label("Do quadro").fill("2")
        dialog.get_by_label("Até o quadro").fill("3")
        dialog.get_by_label("Direção").select_option("pingpong")
        dialog.get_by_role("button", name="Criar tag").click()
        tags = self.page.evaluate("() => { const d = window.crivo.editor.doc; return d.tags.map((t) => [t.name, d.frameIndex(t.from), d.frameIndex(t.to), t.direction]); }")
        self.assertEqual(tags, [["Tag 1", 1, 2, "pingpong"]])
        self.assertEqual(self.page.locator(".frame-list .frame-tag").count(), 2)
        visited = self.page.evaluate(
            """() => new Promise((resolve) => {
                const e = window.crivo.editor;
                e.setState('frame', 1);
                e.selectFrame(1);
                e.doc.fps = 30;
                const seen = [];
                e.on('frame', () => seen.push(e.state.frame));
                e.play();
                setTimeout(() => { e.stop(); resolve(seen); }, 400);
            })"""
        )
        self.assertTrue(set(visited[:-1]) <= {1, 2} and len(visited) > 3, visited)
        self.menu("Quadro", "Novo quadro vinculado")
        self.tool("b", "pencil")
        self.drag((2, 2), (2, 2), steps=1)
        linked = self.page.evaluate("() => { const d = window.crivo.editor.doc; const c = d.layers[0].id; return [d.frames.length, d.cell(d.frames[1].id, c)[2 * 32 + 2] === d.cell(d.frames[2].id, c)[2 * 32 + 2], d.isLinked(d.frames[1].id, c)]; }")
        self.assertEqual(linked, [4, True, True])
        self.assertGreaterEqual(self.page.locator(".frame-list .link-mark").count(), 2)
        # Tilemap layer: pixel mode creates a tile, tile mode places it elsewhere.
        self.menu("Camada", "Nova camada de tiles…")
        dialog = self.page.locator("dialog[open]")
        dialog.get_by_label("Largura do tile").fill("4")
        dialog.get_by_label("Altura do tile").fill("4")
        dialog.get_by_role("button", name="Criar").click()
        self.drag((1, 1), (1, 1), steps=1)
        color = self.pixel(1, 1)
        self.assertNotEqual(color, 0)
        self.assertEqual(self.page.locator(".tile-grid .tile").count(), 2)
        self.page.get_by_role("button", name="Modo pixel").click()
        self.drag((9, 1), (9, 1), steps=1)
        self.assertEqual(self.pixel(9, 1), color, "tile mode placed tile 1 on the third cell")
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(9, 1), 0)
        self.assertEqual(self.pixel(1, 1), color)


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
        self.assertEqual(self.page.locator("#tools .tool").count(), 23)
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
        self.assertEqual(self.page.locator("#tools .tool").count(), 23)
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
        # The dialog closes first and the project loads from IndexedDB right after: wait for its pixels.
        self.page.wait_for_function(
            "([x, y, c]) => { const e = window.crivo.editor; return e.project.local && e.activeCell()[y * e.doc.width + x] >>> 0 === c; }", arg=[3, 1, color]
        )
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
            self.menu("Arquivo", "Abrir arquivo…")
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
            window.__files = {};
            window.crivoDesktop = Object.freeze({
              version: 'test',
              toggleFullscreen: () => { window.__calls.push('fullscreen'); return Promise.resolve(false); },
              quit: () => { window.__calls.push('quit'); return Promise.resolve(); },
              saveDialog: (o) => { window.__calls.push('saveDialog:' + o.name + ':' + o.extension); return Promise.resolve('C:\\\\Users\\\\Erik\\\\Desktop\\\\' + o.name); },
              writeFile: (path, data) => { window.__calls.push('writeFile'); window.__files[path] = atob(data); return Promise.resolve(); },
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
        # Saving opens the Windows "Save as" window (desktop/save_windows.go) and writes the chosen file.
        self.page.keyboard.press("Control+s")
        self.page.wait_for_function("() => window.__calls.includes('writeFile')")
        self.assertIn("saveDialog:Sem título.crivo:crivo", self.page.evaluate("() => window.__calls"))
        saved = json.loads(self.page.evaluate("() => window.__files['C:\\\\Users\\\\Erik\\\\Desktop\\\\Sem título.crivo']"))
        self.assertEqual((saved["format"], saved["version"]), ("crivo", 2))
        self.page.wait_for_function("() => document.querySelector('#toasts').textContent.includes('Desktop')")
        self.menu("Arquivo", "Exportar como .ase")
        self.page.wait_for_function("() => Object.keys(window.__files).some((p) => p.endsWith('.ase'))")
        data = self.page.evaluate("() => [...window.__files[Object.keys(window.__files).find((p) => p.endsWith('.ase'))].slice(4, 6)].map((c) => c.charCodeAt(0))")
        self.assertEqual(data, [0xE0, 0xA5], "Aseprite magic number")
        self.menu("Arquivo", "Sair do Crivo")
        self.page.wait_for_function("() => window.__calls.includes('quit')")
        self.page.reload()
        self.page.wait_for_selector("body.ready")
        self.assertNotEqual(self.pixel(4, 2), 0, "the draft was saved before quitting and comes back when reopening")


if __name__ == "__main__":
    unittest.main()
