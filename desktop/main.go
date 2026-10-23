//go:build windows

// Crivo para desktop: abre o editor (o mesmo do Crivo.html) numa janela própria do Windows, já
// maximizada (F11 alterna a tela cheia), sem servidor, sem backend e sem navegador. A janela usa o Microsoft Edge WebView2,
// que já vem no Windows 10 e 11. Projetos, paletas e o rascunho ficam em %LOCALAPPDATA%\Crivo.
//
// Na primeira abertura, cria um atalho no menu Iniciar (atalho_windows.go) para o Crivo aparecer na pesquisa.
//
// Para gerar o Crivo.exe da raiz do repositório: npm run desktop (precisa do Go e do Node).
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

// O editor inteiro, gerado por scripts/gerar-portatil.js e copiado para cá por scripts/gerar-desktop.js.
//
//go:embed Crivo.html
var pagina []byte

// Preenchida no build com a versão do arquivo VERSION (-ldflags "-X main.versao=...").
var versao = "dev"

const (
	// Recurso gravado pelo goversioninfo: o manifesto é o 1 e o grupo de ícones, o 2.
	idIcone = 2

	linkWebView2 = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

	wmClose              = 0x0010
	wmSetIcon            = 0x0080
	swMaximizar          = 3
	iconeGrande          = 1
	iconePequeno         = 0
	imagemIcone          = 1
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
	// GWL_STYLE (-16) e GWLP_WNDPROC (-4) em complemento de dois.
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

type retangulo struct{ Esquerda, Topo, Direita, Base int32 }

type ponto struct{ X, Y int32 }

type infoMonitor struct {
	Tamanho  uint32
	Monitor  retangulo
	Trabalho retangulo
	Flags    uint32
}

type posicaoJanela struct {
	Tamanho       uint32
	Flags         uint32
	Mostrar       uint32
	Minimizada    ponto
	Maximizada    ponto
	PosicaoNormal retangulo
}

// app guarda o estado da janela. Tudo aqui roda na thread da interface (a do laço de mensagens).
type app struct {
	w          webview2.WebView
	hwnd       uintptr
	procAntigo uintptr

	telaCheia bool
	estilo    uintptr
	posicao   posicaoJanela

	fechamentoPedido bool
	podeFechar       bool
}

var aberto *app

func init() {
	// A janela e o WebView2 precisam ficar sempre na mesma thread do sistema.
	runtime.LockOSThread()
}

func main() {
	pasta, err := prepararPasta()
	if err != nil {
		avisar("Não foi possível preparar a pasta do Crivo:\n\n" + err.Error())
		return
	}
	registrarNoMenuIniciar(pasta)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(pasta, "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Crivo",
			Width:  1280,
			Height: 800,
			IconId: idIcone,
			Center: true,
		},
	})
	if w == nil {
		semWebView2()
		return
	}

	a := &app{w: w, hwnd: uintptr(w.Window())}
	aberto = a
	a.icones()
	a.interceptarFechamento()

	must(w.Bind("__crivoTelaCheia", func() bool {
		w.Dispatch(a.alternarTelaCheia)
		return !a.telaCheia
	}))
	must(w.Bind("__crivoSair", func() {
		w.Dispatch(a.fecharAgora)
	}))
	must(w.Bind("__crivoTitulo", func(titulo string) {
		if titulo == "" {
			titulo = "Crivo"
		}
		w.SetTitle(titulo)
	}))
	w.Init(fmt.Sprintf(`
window.crivoDesktop = Object.freeze({
  versao: %q,
  alternarTelaCheia: () => window.__crivoTelaCheia(),
  sair: () => window.__crivoSair(),
});
document.addEventListener('DOMContentLoaded', () => {
  const enviar = () => window.__crivoTitulo(document.title);
  enviar();
  const titulo = document.querySelector('title');
  if (titulo) new MutationObserver(enviar).observe(titulo, { childList: true, characterData: true, subtree: true });
});`, versao))

	a.janelaNormalCentralizada()
	procShowWindow.Call(a.hwnd, swMaximizar) // abre maximizado; F11 leva à tela cheia e volta
	w.Navigate(enderecoDoArquivo(filepath.Join(pasta, "Crivo.html")))
	w.Run()
}

// prepararPasta cria %LOCALAPPDATA%\Crivo e grava nela a página do editor, se ela mudou.
// A página é aberta como arquivo (file://) para os projetos ficarem guardados entre uma abertura e outra.
func prepararPasta() (string, error) {
	base, err := os.UserCacheDir() // no Windows, %LOCALAPPDATA%
	if err != nil {
		return "", err
	}
	pasta := filepath.Join(base, "Crivo")
	if err := os.MkdirAll(pasta, 0o755); err != nil {
		return "", err
	}
	destino := filepath.Join(pasta, "Crivo.html")
	if atual, err := os.ReadFile(destino); err == nil && bytes.Equal(atual, pagina) {
		return pasta, nil
	}
	temporario := destino + ".novo"
	if err := os.WriteFile(temporario, pagina, 0o644); err != nil {
		return "", err
	}
	return pasta, os.Rename(temporario, destino)
}

func enderecoDoArquivo(caminho string) string {
	return (&url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(caminho)}).String()
}

// icones carrega o ícone grande (barra de tarefas, Alt+Tab) e o pequeno (barra de título) no tamanho
// certo para o DPI do monitor. Sem isso, o Windows reduz o ícone grande e o ponteiro fica desproporcional.
func (a *app) icones() {
	var modulo windows.Handle
	if windows.GetModuleHandleEx(0, nil, &modulo) != nil { // sem nome = o próprio Crivo.exe
		return
	}
	medida := func(indice uintptr) uintptr {
		if procGetDpiForWindow.Find() == nil && procGetSysMetricsDpi.Find() == nil {
			if dpi, _, _ := procGetDpiForWindow.Call(a.hwnd); dpi != 0 {
				v, _, _ := procGetSysMetricsDpi.Call(indice, dpi)
				return v
			}
		}
		v, _, _ := procGetSystemMetrics.Call(indice)
		return v
	}
	for _, t := range []struct{ tipo, largura, altura uintptr }{
		{iconeGrande, smCxIcon, smCyIcon},
		{iconePequeno, smCxSmIcon, smCySmIcon},
	} {
		h, _, _ := procLoadImageW.Call(uintptr(modulo), idIcone, imagemIcone, medida(t.largura), medida(t.altura), 0)
		if h != 0 {
			procSendMessageW.Call(a.hwnd, wmSetIcon, t.tipo, h)
		}
	}
}

// janelaNormalCentralizada deixa a janela com 85% da área útil do monitor. É o tamanho que ela
// tem quando a pessoa tira a janela do modo maximizado.
func (a *app) janelaNormalCentralizada() {
	m, ok := a.monitor()
	if !ok {
		return
	}
	area := m.Trabalho
	largura := (area.Direita - area.Esquerda) * 85 / 100
	altura := (area.Base - area.Topo) * 85 / 100
	x := area.Esquerda + (area.Direita-area.Esquerda-largura)/2
	y := area.Topo + (area.Base-area.Topo-altura)/2
	procSetWindowPos.Call(a.hwnd, 0, uintptr(x), uintptr(y), uintptr(largura), uintptr(altura), swpNoZOrder|swpNoOwnerZOrder)
}

func (a *app) monitor() (infoMonitor, bool) {
	m := infoMonitor{Tamanho: uint32(unsafe.Sizeof(infoMonitor{}))}
	h, _, _ := procMonitorFromWindow.Call(a.hwnd, monitorDefaultToNear)
	ok, _, _ := procGetMonitorInfoW.Call(h, uintptr(unsafe.Pointer(&m)))
	return m, ok != 0
}

// entrarEmTelaCheia tira a borda e a barra de título e cobre o monitor inteiro, como o F11 de um navegador.
func (a *app) entrarEmTelaCheia() {
	if a.telaCheia {
		return
	}
	m, ok := a.monitor()
	if !ok {
		return
	}
	a.posicao = posicaoJanela{Tamanho: uint32(unsafe.Sizeof(posicaoJanela{}))}
	procGetWindowPlacement.Call(a.hwnd, uintptr(unsafe.Pointer(&a.posicao)))
	a.estilo, _, _ = procGetWindowLongPtrW.Call(a.hwnd, gwlStyle)
	procSetWindowLongPtrW.Call(a.hwnd, gwlStyle, a.estilo&^wsOverlappedWindow)
	r := m.Monitor
	procSetWindowPos.Call(a.hwnd, 0, uintptr(r.Esquerda), uintptr(r.Topo), uintptr(r.Direita-r.Esquerda), uintptr(r.Base-r.Topo), swpNoOwnerZOrder|swpFrameChanged)
	a.telaCheia = true
}

// sairDaTelaCheia devolve a borda, a barra de título e o tamanho que a janela tinha antes.
func (a *app) sairDaTelaCheia() {
	if !a.telaCheia {
		return
	}
	procSetWindowLongPtrW.Call(a.hwnd, gwlStyle, a.estilo|wsOverlappedWindow)
	procSetWindowPlacement.Call(a.hwnd, uintptr(unsafe.Pointer(&a.posicao)))
	procSetWindowPos.Call(a.hwnd, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
	a.telaCheia = false
}

func (a *app) alternarTelaCheia() {
	if a.telaCheia {
		a.sairDaTelaCheia()
	} else {
		a.entrarEmTelaCheia()
	}
}

// interceptarFechamento faz o Alt+F4 (e o X da janela) esperar o editor gravar o rascunho antes de fechar.
func (a *app) interceptarFechamento() {
	a.procAntigo, _, _ = procSetWindowLongPtrW.Call(a.hwnd, gwlpWndProc, windows.NewCallback(procJanela))
}

func procJanela(hwnd, msg, wp, lp uintptr) uintptr {
	if a := aberto; a != nil && msg == wmClose && !a.podeFechar {
		a.pedirFechamento()
		return 0
	}
	r, _, _ := procCallWindowProcW.Call(aberto.procAntigo, hwnd, msg, wp, lp)
	return r
}

func (a *app) pedirFechamento() {
	if a.fechamentoPedido {
		// Segundo Alt+F4 seguido: fecha na hora.
		a.fecharAgora()
		return
	}
	a.fechamentoPedido = true
	a.w.Eval(`Promise.resolve(window.__crivoAntesDeFechar && window.__crivoAntesDeFechar()).catch(() => {}).finally(() => window.__crivoSair())`)
	// Se a página não responder (travada ou ainda carregando), fecha mesmo assim.
	time.AfterFunc(3*time.Second, func() { a.w.Dispatch(a.fecharAgora) })
}

func (a *app) fecharAgora() {
	if a.podeFechar {
		return
	}
	a.podeFechar = true
	procPostMessageW.Call(a.hwnd, wmClose, 0, 0)
}

func semWebView2() {
	texto := "O Crivo precisa do Microsoft Edge WebView2 Runtime, que já vem no Windows 10 e 11 atualizados.\n\n" +
		"Quer abrir a página de download da Microsoft agora? Depois de instalar, abra o Crivo de novo."
	if mensagem(texto, mbYesNo|mbIconWarning) == idYes {
		_ = windows.ShellExecute(0, windows.StringToUTF16Ptr("open"), windows.StringToUTF16Ptr(linkWebView2), nil, nil, windows.SW_SHOWNORMAL)
	}
}

func avisar(texto string) { mensagem(texto, mbIconWarning) }

func mensagem(texto string, tipo uint32) int32 {
	r, _ := windows.MessageBox(0, windows.StringToUTF16Ptr(texto), windows.StringToUTF16Ptr("Crivo"), tipo)
	return r
}

func must(err error) {
	if err != nil {
		avisar("Erro ao preparar o Crivo: " + err.Error())
		os.Exit(1)
	}
}
