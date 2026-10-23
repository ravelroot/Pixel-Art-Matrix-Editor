//go:build windows

package main

// Start Menu shortcut. Crivo.exe is standalone (it has no installer), and Windows search only finds
// programs that have a Start Menu shortcut. The first time it runs, the app creates that shortcut for the
// current user only, without asking for administrator rights. If the user deletes the shortcut, it does not
// come back, unless Crivo.exe is opened from another folder (then the shortcut points to the new location).

import (
	"errors"
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

	// Method positions in the virtual tables of the COM interfaces.
	methodRelease        = 2
	methodQueryInterface = 0
	shellLinkSetDesc     = 7
	shellLinkSetWorkDir  = 9
	shellLinkSetIcon     = 17
	shellLinkSetPath     = 20
	persistFileSave      = 6

	// File in the data folder that records which Crivo.exe the shortcut points to.
	shortcutRecord = "shortcut.txt"
	// Name of that file up to Crivo 1.x, still read when shortcut.txt does not exist.
	legacyShortcutRecord = "atalho.txt"
)

// registerInStartMenu creates or updates %APPDATA%\Microsoft\Windows\Start Menu\Programs\Crivo.lnk.
// Any error is ignored: the shortcut is a convenience and never stops Crivo from opening.
func registerInStartMenu(dataDir string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	programs, err := windows.KnownFolderPath(windows.FOLDERID_Programs, 0)
	if err != nil {
		return
	}
	shortcut := filepath.Join(programs, "Crivo.lnk")
	record := filepath.Join(dataDir, shortcutRecord)
	previous, err := os.ReadFile(record)
	if errors.Is(err, os.ErrNotExist) {
		previous, _ = os.ReadFile(filepath.Join(dataDir, legacyShortcutRecord))
	}
	sameLocation := strings.EqualFold(strings.TrimSpace(string(previous)), exe)
	if _, err := os.Stat(shortcut); err == nil {
		if sameLocation {
			return // already points to this Crivo.exe
		}
	} else if sameLocation {
		return // the user deleted the shortcut: respect that choice
	}
	if createShortcut(shortcut, exe) {
		_ = os.WriteFile(record, []byte(exe), 0o644)
	}
}

func createShortcut(target, exe string) bool {
	_ = windows.CoInitializeEx(0, coinitApartment) // WebView2 already initializes COM; doing it again is harmless
	clsidShellLink, _ := windows.GUIDFromString("{00021401-0000-0000-C000-000000000046}")
	iidShellLink, _ := windows.GUIDFromString("{000214F9-0000-0000-C000-000000000046}")
	iidPersistFile, _ := windows.GUIDFromString("{0000010B-0000-0000-C000-000000000046}")

	var link unsafe.Pointer
	r, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidShellLink)), uintptr(unsafe.Pointer(&link)))
	if r != 0 || link == nil {
		return false
	}
	defer call(link, methodRelease)

	// The strings stay in variables until the end of the function (KeepAlive) so the garbage collector
	// does not free them while Windows is still reading them.
	path, _ := windows.UTF16PtrFromString(exe)
	workDir, _ := windows.UTF16PtrFromString(filepath.Dir(exe))
	description, _ := windows.UTF16PtrFromString("Crivo, editor de pixel art")
	lnkFile, _ := windows.UTF16PtrFromString(target)
	defer runtime.KeepAlive([]*uint16{path, workDir, description, lnkFile})

	call(link, shellLinkSetPath, uintptr(unsafe.Pointer(path)))
	call(link, shellLinkSetWorkDir, uintptr(unsafe.Pointer(workDir)))
	call(link, shellLinkSetDesc, uintptr(unsafe.Pointer(description)))
	call(link, shellLinkSetIcon, uintptr(unsafe.Pointer(path)), 0)

	var file unsafe.Pointer
	if call(link, methodQueryInterface, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&file))) != 0 || file == nil {
		return false
	}
	defer call(file, methodRelease)
	return call(file, persistFileSave, uintptr(unsafe.Pointer(lnkFile)), 1) == 0
}

// call invokes method number index of the COM interface obj (the first argument is always obj itself).
func call(obj unsafe.Pointer, index uintptr, args ...uintptr) uintptr {
	vtable := *(*unsafe.Pointer)(obj)
	method := *(*uintptr)(unsafe.Add(vtable, index*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(method, append([]uintptr{uintptr(obj)}, args...)...)
	return r
}
