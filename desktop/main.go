//go:build windows

// Crivo for desktop: opens the editor (the same one as Crivo.html) in its own Windows window, already
// maximized (F11 toggles fullscreen), with no server, no backend and no browser. The window uses Microsoft Edge WebView2,
// which ships with Windows 10 and 11. Projects, palettes and the draft are kept in %LOCALAPPDATA%\Crivo.
//
// On first run, it creates a Start Menu shortcut (shortcut_windows.go) so Crivo shows up in Windows search.
// Saving and exporting open the Windows "Save as" window, so the person chooses the folder (save_windows.go).
//
// To build Crivo.exe from the repository root: npm run desktop (needs Go and Node).
package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// The whole editor, built by scripts/build-portable.js and copied here by scripts/build-desktop.js.
//
//go:embed Crivo.html
var page []byte

// Set at build time from the VERSION file (-ldflags "-X main.version=...").
var version = "dev"

const (
	// Resource written by goversioninfo: the manifest is 1 and the icon group is 2.
	iconID = 2

	webView2DownloadURL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

	wmClose              = 0x0010
	wmSetIcon            = 0x0080
	swMaximize           = 3
	iconBig              = 1
	iconSmall            = 0
	imageIcon            = 1
	smCxIcon             = 11
	smCyIcon             = 12
	smCxSmIcon           = 49
	smCySmIcon           = 50
	wsOverlappedWindow   = 0x00CF0000
	swpNoSize            = 0x0001
	swpNoMove            = 0x0002
	swpNoZOrder          = 0x0004
	swpFrameChanged      = 0x0020
	swpNoOwnerZOrder     = 0x0200
	monitorDefaultToNear = 0x00000002
	mbYesNo              = 0x00000004
	mbIconWarning        = 0x00000030
	idYes                = 6
)

var (
	// GWL_STYLE (-16) and GWLP_WNDPROC (-4) in two's complement.
	gwlStyle    = ^uintptr(15)
	gwlpWndProc = ^uintptr(3)

	user32                 = windows.NewLazySystemDLL("user32.dll")
	procGetWindowLongPtrW  = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW  = user32.NewProc("SetWindowLongPtrW")
	procGetWindowPlacement = user32.NewProc("GetWindowPlacement")
	procSetWindowPlacement = user32.NewProc("SetWindowPlacement")
	procSetWindowPos       = user32.NewProc("SetWindowPos")
	procMonitorFromWindow  = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW    = user32.NewProc("GetMonitorInfoW")
	procCallWindowProcW    = user32.NewProc("CallWindowProcW")
	procPostMessageW       = user32.NewProc("PostMessageW")
	procSendMessageW       = user32.NewProc("SendMessageW")
	procShowWindow         = user32.NewProc("ShowWindow")
	procLoadImageW         = user32.NewProc("LoadImageW")
	procGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	procGetDpiForWindow    = user32.NewProc("GetDpiForWindow")
	procGetSysMetricsDpi   = user32.NewProc("GetSystemMetricsForDpi")
)

type rect struct{ Left, Top, Right, Bottom int32 }

type point struct{ X, Y int32 }

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

type windowPlacement struct {
	Length         uint32
	Flags          uint32
	ShowCmd        uint32
	MinPosition    point
	MaxPosition    point
	NormalPosition rect
}

// app holds the window state. Everything here runs on the UI thread (the message loop thread).
type app struct {
	w       webview2.WebView
	hwnd    uintptr
	oldProc uintptr

	fullscreen bool
	style      uintptr
	placement  windowPlacement

	closeRequested bool
	canClose       bool

	// Files chosen in the "Save as" window during this run: the only ones the page can write.
	chosen map[string]bool
}

var current *app

func init() {
	// The window and WebView2 must always stay on the same OS thread.
	runtime.LockOSThread()
}

func main() {
	dir, err := prepareDataDir()
	if err != nil {
		warn("Não foi possível preparar a pasta do Crivo:\n\n" + err.Error())
		return
	}
	registerInStartMenu(dir)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(dir, "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Crivo",
			Width:  1280,
			Height: 800,
			IconId: iconID,
			Center: true,
		},
	})
	if w == nil {
		missingWebView2()
		return
	}

	a := &app{w: w, hwnd: uintptr(w.Window()), chosen: map[string]bool{}}
	current = a
	a.loadIcons()
	a.interceptClose()

	must(w.Bind("__crivoToggleFullscreen", func() bool {
		w.Dispatch(a.toggleFullscreen)
		return !a.fullscreen
	}))
	must(w.Bind("__crivoQuit", func() {
		w.Dispatch(a.closeNow)
	}))
	must(w.Bind("__crivoTitle", func(title string) {
		if title == "" {
			title = "Crivo"
		}
		w.SetTitle(title)
	}))
	// "Save as" (save_windows.go): the window opens after the call returns, and the answer comes back
	// through window.__crivoSaveDone.
	must(w.Bind("__crivoSaveDialog", func(id int, options saveOptions) {
		w.Dispatch(func() { a.showSaveDialog(id, options) })
	}))
	must(w.Bind("__crivoWriteFile", func(path, data string) error {
		return a.writeChosenFile(path, data)
	}))
	w.Init(fmt.Sprintf(`
(() => {
  const pending = new Map();
  let next = 0;
  window.__crivoSaveDone = (id, answer) => {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (answer && answer.error) call.reject(new Error(answer.error));
    else call.resolve((answer && answer.path) || null);
  };
  window.crivoDesktop = Object.freeze({
    version: %q,
    toggleFullscreen: () => window.__crivoToggleFullscreen(),
    quit: () => window.__crivoQuit(),
    saveDialog: (options) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        Promise.resolve(window.__crivoSaveDialog(id, options)).catch((error) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }),
    writeFile: (path, data) => window.__crivoWriteFile(path, data),
  });
})();
document.addEventListener('DOMContentLoaded', () => {
  const send = () => window.__crivoTitle(document.title);
  send();
  const title = document.querySelector('title');
  if (title) new MutationObserver(send).observe(title, { childList: true, characterData: true, subtree: true });
});`, version))

	a.centerNormalWindow()
	procShowWindow.Call(a.hwnd, swMaximize) // opens maximized; F11 goes to fullscreen and back
	w.Navigate(fileURL(filepath.Join(dir, "Crivo.html")))
	w.Run()
}

// prepareDataDir creates %LOCALAPPDATA%\Crivo and writes the editor page into it, if the page changed.
// The page is opened as a file (file://) so projects are kept from one run to the next.
func prepareDataDir() (string, error) {
	base, err := os.UserCacheDir() // on Windows, %LOCALAPPDATA%
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Crivo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(dir, "Crivo.html")
	if existing, err := os.ReadFile(target); err == nil && bytes.Equal(existing, page) {
		return dir, nil
	}
	temporary := target + ".new"
	if err := os.WriteFile(temporary, page, 0o644); err != nil {
		return "", err
	}
	return dir, os.Rename(temporary, target)
}

func fileURL(path string) string {
	return (&url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(path)}).String()
}

// loadIcons loads the big icon (taskbar, Alt+Tab) and the small one (title bar) at the right size
// for the monitor DPI. Without this, Windows shrinks the big icon and the pointer looks out of proportion.
func (a *app) loadIcons() {
	var module windows.Handle
	if windows.GetModuleHandleEx(0, nil, &module) != nil { // no name = Crivo.exe itself
		return
	}
	metric := func(index uintptr) uintptr {
		if procGetDpiForWindow.Find() == nil && procGetSysMetricsDpi.Find() == nil {
			if dpi, _, _ := procGetDpiForWindow.Call(a.hwnd); dpi != 0 {
				v, _, _ := procGetSysMetricsDpi.Call(index, dpi)
				return v
			}
		}
		v, _, _ := procGetSystemMetrics.Call(index)
		return v
	}
	for _, icon := range []struct{ kind, width, height uintptr }{
		{iconBig, smCxIcon, smCyIcon},
		{iconSmall, smCxSmIcon, smCySmIcon},
	} {
		h, _, _ := procLoadImageW.Call(uintptr(module), iconID, imageIcon, metric(icon.width), metric(icon.height), 0)
		if h != 0 {
			procSendMessageW.Call(a.hwnd, wmSetIcon, icon.kind, h)
		}
	}
}

// centerNormalWindow sizes the window to 85% of the monitor work area. That is the size it
// has when the user takes the window out of the maximized state.
func (a *app) centerNormalWindow() {
	m, ok := a.monitor()
	if !ok {
		return
	}
	area := m.Work
	width := (area.Right - area.Left) * 85 / 100
	height := (area.Bottom - area.Top) * 85 / 100
	x := area.Left + (area.Right-area.Left-width)/2
	y := area.Top + (area.Bottom-area.Top-height)/2
	procSetWindowPos.Call(a.hwnd, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height), swpNoZOrder|swpNoOwnerZOrder)
}

func (a *app) monitor() (monitorInfo, bool) {
	m := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	h, _, _ := procMonitorFromWindow.Call(a.hwnd, monitorDefaultToNear)
	ok, _, _ := procGetMonitorInfoW.Call(h, uintptr(unsafe.Pointer(&m)))
	return m, ok != 0
}

// enterFullscreen removes the border and the title bar and covers the whole monitor, like a browser's F11.
func (a *app) enterFullscreen() {
	if a.fullscreen {
		return
	}
	m, ok := a.monitor()
	if !ok {
		return
	}
	a.placement = windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
	procGetWindowPlacement.Call(a.hwnd, uintptr(unsafe.Pointer(&a.placement)))
	a.style, _, _ = procGetWindowLongPtrW.Call(a.hwnd, gwlStyle)
	procSetWindowLongPtrW.Call(a.hwnd, gwlStyle, a.style&^wsOverlappedWindow)
	r := m.Monitor
	procSetWindowPos.Call(a.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), swpNoOwnerZOrder|swpFrameChanged)
	a.fullscreen = true
}

// exitFullscreen brings back the border, the title bar and the size the window had before.
func (a *app) exitFullscreen() {
	if !a.fullscreen {
		return
	}
	procSetWindowLongPtrW.Call(a.hwnd, gwlStyle, a.style|wsOverlappedWindow)
	procSetWindowPlacement.Call(a.hwnd, uintptr(unsafe.Pointer(&a.placement)))
	procSetWindowPos.Call(a.hwnd, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
	a.fullscreen = false
}

func (a *app) toggleFullscreen() {
	if a.fullscreen {
		a.exitFullscreen()
	} else {
		a.enterFullscreen()
	}
}

// interceptClose makes Alt+F4 (and the window's X) wait for the editor to save the draft before closing.
func (a *app) interceptClose() {
	a.oldProc, _, _ = procSetWindowLongPtrW.Call(a.hwnd, gwlpWndProc, windows.NewCallback(windowProc))
}

func windowProc(hwnd, msg, wp, lp uintptr) uintptr {
	if a := current; a != nil && msg == wmClose && !a.canClose {
		a.requestClose()
		return 0
	}
	r, _, _ := procCallWindowProcW.Call(current.oldProc, hwnd, msg, wp, lp)
	return r
}

func (a *app) requestClose() {
	if a.closeRequested {
		// Second Alt+F4 in a row: close right away.
		a.closeNow()
		return
	}
	a.closeRequested = true
	a.w.Eval(`Promise.resolve(window.__crivoBeforeClose && window.__crivoBeforeClose()).catch(() => {}).finally(() => window.__crivoQuit())`)
	// If the page does not answer (frozen or still loading), close anyway.
	time.AfterFunc(3*time.Second, func() { a.w.Dispatch(a.closeNow) })
}

func (a *app) closeNow() {
	if a.canClose {
		return
	}
	a.canClose = true
	procPostMessageW.Call(a.hwnd, wmClose, 0, 0)
}

// missingWebView2 offers to open the WebView2 Runtime download page.
func missingWebView2() {
	text := "O Crivo precisa do Microsoft Edge WebView2 Runtime, que já vem no Windows 10 e 11 atualizados.\n\n" +
		"Quer abrir a página de download da Microsoft agora? Depois de instalar, abra o Crivo de novo."
	if messageBox(text, mbYesNo|mbIconWarning) == idYes {
		_ = windows.ShellExecute(0, windows.StringToUTF16Ptr("open"), windows.StringToUTF16Ptr(webView2DownloadURL), nil, nil, windows.SW_SHOWNORMAL)
	}
}

func warn(text string) { messageBox(text, mbIconWarning) }

func messageBox(text string, flags uint32) int32 {
	r, _ := windows.MessageBox(0, windows.StringToUTF16Ptr(text), windows.StringToUTF16Ptr("Crivo"), flags)
	return r
}

func must(err error) {
	if err != nil {
		warn("Erro ao preparar o Crivo: " + err.Error())
		os.Exit(1)
	}
}
