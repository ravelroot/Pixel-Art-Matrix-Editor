//go:build windows

package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	comdlg32                 = windows.NewLazySystemDLL("comdlg32.dll")
	procGetSaveFileNameW     = comdlg32.NewProc("GetSaveFileNameW")
	procCommDlgExtendedError = comdlg32.NewProc("CommDlgExtendedError")
)

const (
	ofnOverwritePrompt = 0x00000002
	ofnHideReadOnly    = 0x00000004
	ofnNoChangeDir     = 0x00000008
	ofnPathMustExist   = 0x00000800
	ofnExplorer        = 0x00080000

	pathBuffer = 32768
)

type openFileName struct {
	StructSize     uint32
	Owner          uintptr
	Instance       uintptr
	Filter         *uint16
	CustomFilter   *uint16
	MaxCustFilter  uint32
	FilterIndex    uint32
	File           *uint16
	MaxFile        uint32
	FileTitle      *uint16
	MaxFileTitle   uint32
	InitialDir     *uint16
	Title          *uint16
	Flags          uint32
	FileOffset     uint16
	FileExtension  uint16
	DefExt         *uint16
	CustData       uintptr
	Hook           uintptr
	TemplateName   *uint16
	Reserved       uintptr
	ReservedNumber uint32
	FlagsEx        uint32
}

type saveOptions struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Extension   string `json:"extension"`
}

func utf16z(text string) []uint16 {
	return append(utf16.Encode([]rune(strings.ReplaceAll(text, "\x00", ""))), 0)
}

func multiString(parts ...string) []uint16 {
	var out []uint16
	for _, p := range parts {
		out = append(out, utf16z(p)...)
	}
	return append(out, 0)
}

func cleanExtension(ext string) string {
	ext = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(ext)), ".")
	for _, r := range ext {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return ""
		}
	}
	if len(ext) > 15 {
		return ""
	}
	return ext
}

func cleanFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	if name == "" {
		return "Sem título"
	}
	return name
}

func (a *app) saveDialog(o saveOptions) (string, error) {
	ext := cleanExtension(o.Extension)
	file := make([]uint16, pathBuffer)
	copy(file[:pathBuffer-1], utf16.Encode([]rune(cleanFileName(o.Name))))

	var types []string
	if ext != "" {
		description := strings.TrimSpace(o.Description)
		if description == "" {
			description = "Arquivo ." + ext
		}
		types = append(types, fmt.Sprintf("%s (*.%s)", description, ext), "*."+ext)
	}
	types = append(types, "Todos os arquivos (*.*)", "*.*")
	filter := multiString(types...)

	title := strings.TrimSpace(o.Title)
	if title == "" {
		title = "Salvar"
	}
	titleText := utf16z(title)

	ofn := &openFileName{
		Owner:       a.hwnd,
		Filter:      &filter[0],
		FilterIndex: 1,
		File:        &file[0],
		MaxFile:     pathBuffer,
		Title:       &titleText[0],
		Flags:       ofnOverwritePrompt | ofnHideReadOnly | ofnNoChangeDir | ofnPathMustExist | ofnExplorer,
	}
	ofn.StructSize = uint32(unsafe.Sizeof(*ofn))
	if ext != "" {
		defExt := utf16z(ext)
		ofn.DefExt = &defExt[0]
	}

	ok, _, _ := procGetSaveFileNameW.Call(uintptr(unsafe.Pointer(ofn)))
	if ok == 0 {
		if code, _, _ := procCommDlgExtendedError.Call(); code != 0 {
			return "", fmt.Errorf("a janela Salvar como não abriu (código 0x%X)", code)
		}
		return "", nil
	}
	return windows.UTF16ToString(file), nil
}

func (a *app) showSaveDialog(id int, o saveOptions) {
	path, err := a.saveDialog(o)
	answer := struct {
		Path  string `json:"path,omitempty"`
		Error string `json:"error,omitempty"`
	}{Path: path}
	if err != nil {
		answer.Error = err.Error()
	}
	if path != "" {
		a.chosen[filepath.Clean(path)] = true
	}
	payload, _ := json.Marshal(answer)
	a.w.Eval(fmt.Sprintf("window.__crivoSaveDone && window.__crivoSaveDone(%d, %s)", id, payload))
	a.w.Dispatch(func() {})
}

func (a *app) writeChosenFile(path, data string) error {
	path = filepath.Clean(path)
	if !a.chosen[path] {
		return errors.New("o Crivo só grava arquivos escolhidos na janela Salvar como")
	}
	content, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return errors.New("o conteúdo do arquivo chegou incompleto")
	}
	return writeFileSafely(path, content)
}

func writeFileSafely(path string, content []byte) error {
	if err := replaceFile(path, content); err == nil {
		return nil
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return plainError(err)
	}
	return nil
}

func replaceFile(path string, content []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".crivo-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	_, err = temporary.Write(content)
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	if err != nil {
		_ = os.Remove(name)
	}
	return err
}

func plainError(err error) error {
	for {
		inner := errors.Unwrap(err)
		if inner == nil {
			return err
		}
		err = inner
	}
}
