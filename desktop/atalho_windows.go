//go:build windows

package main

// Atalho no menu Iniciar. O Crivo.exe é avulso (não tem instalador), e a pesquisa do Windows só encontra
// programas que têm atalho no menu Iniciar. Na primeira vez que abre, o app cria esse atalho só para o
// usuário atual, sem pedir administrador. Se a pessoa apagar o atalho, ele não volta, a não ser que o
// Crivo.exe seja aberto de outra pasta (aí o atalho passa a apontar para o lugar novo).

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ole32                = windows.NewLazySystemDLL("ole32.dll")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
)

const (
	clsctxInprocServer = 0x1
	coinitApartment    = 0x2

	// Posições dos métodos nas tabelas virtuais das interfaces COM.
	metodoRelease        = 2
	metodoQueryInterface = 0
	shellLinkSetDesc     = 7
	shellLinkSetWorkDir  = 9
	shellLinkSetIcon     = 17
	shellLinkSetPath     = 20
	persistFileSave      = 6
)

// registrarNoMenuIniciar cria ou atualiza %APPDATA%\Microsoft\Windows\Start Menu\Programs\Crivo.lnk.
// Qualquer erro é ignorado: o atalho é uma conveniência e nunca impede o Crivo de abrir.
func registrarNoMenuIniciar(pastaDados string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	programas, err := windows.KnownFolderPath(windows.FOLDERID_Programs, 0)
	if err != nil {
		return
	}
	atalho := filepath.Join(programas, "Crivo.lnk")
	registro := filepath.Join(pastaDados, "atalho.txt")
	anterior, _ := os.ReadFile(registro)
	mesmoLugar := strings.EqualFold(strings.TrimSpace(string(anterior)), exe)
	if _, err := os.Stat(atalho); err == nil {
		if mesmoLugar {
			return // já aponta para este Crivo.exe
		}
	} else if mesmoLugar {
		return // a pessoa apagou o atalho: respeita a escolha
	}
	if criarAtalho(atalho, exe) {
		_ = os.WriteFile(registro, []byte(exe), 0o644)
	}
}

func criarAtalho(destino, exe string) bool {
	_ = windows.CoInitializeEx(0, coinitApartment) // o WebView2 já inicia o COM; repetir é inofensivo
	clsidShellLink, _ := windows.GUIDFromString("{00021401-0000-0000-C000-000000000046}")
	iidShellLink, _ := windows.GUIDFromString("{000214F9-0000-0000-C000-000000000046}")
	iidPersistFile, _ := windows.GUIDFromString("{0000010B-0000-0000-C000-000000000046}")

	var link unsafe.Pointer
	r, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidShellLink)), uintptr(unsafe.Pointer(&link)))
	if r != 0 || link == nil {
		return false
	}
	defer chamar(link, metodoRelease)

	// Os textos ficam em variáveis até o fim da função (KeepAlive) para o coletor não liberá-los
	// enquanto o Windows ainda os lê.
	caminho, _ := windows.UTF16PtrFromString(exe)
	pasta, _ := windows.UTF16PtrFromString(filepath.Dir(exe))
	descricao, _ := windows.UTF16PtrFromString("Crivo, editor de pixel art")
	arquivoLnk, _ := windows.UTF16PtrFromString(destino)
	defer runtime.KeepAlive([]*uint16{caminho, pasta, descricao, arquivoLnk})

	chamar(link, shellLinkSetPath, uintptr(unsafe.Pointer(caminho)))
	chamar(link, shellLinkSetWorkDir, uintptr(unsafe.Pointer(pasta)))
	chamar(link, shellLinkSetDesc, uintptr(unsafe.Pointer(descricao)))
	chamar(link, shellLinkSetIcon, uintptr(unsafe.Pointer(caminho)), 0)

	var arquivo unsafe.Pointer
	if chamar(link, metodoQueryInterface, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&arquivo))) != 0 || arquivo == nil {
		return false
	}
	defer chamar(arquivo, metodoRelease)
	return chamar(arquivo, persistFileSave, uintptr(unsafe.Pointer(arquivoLnk)), 1) == 0
}

// chamar executa o método de número indice da interface COM obj (o primeiro argumento é sempre o próprio obj).
func chamar(obj unsafe.Pointer, indice uintptr, argumentos ...uintptr) uintptr {
	tabela := *(*unsafe.Pointer)(obj)
	metodo := *(*uintptr)(unsafe.Add(tabela, indice*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(metodo, append([]uintptr{uintptr(obj)}, argumentos...)...)
	return r
}
