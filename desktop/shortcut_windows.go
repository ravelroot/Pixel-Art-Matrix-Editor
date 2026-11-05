//go:build windows

package main

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

	methodRelease        = 2
	methodQueryInterface = 0
	shellLinkSetDesc     = 7
	shellLinkSetWorkDir  = 9
	shellLinkSetIcon     = 17
	shellLinkSetPath     = 20
	persistFileSave      = 6

	shortcutRecord = "shortcut.txt"
	legacyShortcutRecord = "atalho.txt"
)

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
			return
		}
	} else if sameLocation {
		return
	}
	if createShortcut(shortcut, exe) {
		_ = os.WriteFile(record, []byte(exe), 0o644)
	}
}

func createShortcut(target, exe string) bool {
	_ = windows.CoInitializeEx(0, coinitApartment)
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

func call(obj unsafe.Pointer, index uintptr, args ...uintptr) uintptr {
	vtable := *(*unsafe.Pointer)(obj)
	method := *(*uintptr)(unsafe.Add(vtable, index*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(method, append([]uintptr{uintptr(obj)}, args...)...)
	return r
}
