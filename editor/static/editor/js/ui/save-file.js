// Saving files through the system "Save as" window, so the person chooses the folder and the name:
// - desktop app (Crivo.exe): the native Windows window, through window.crivoDesktop.saveDialog and writeFile
//   (desktop/main.go);
// - Chrome and Edge (Django server or Crivo.html): the File System Access API (showSaveFilePicker), which
//   opens the same Windows window;
// - other browsers: an ordinary download to the Downloads folder.
// This module imports nothing, so ui/util.js can build on it.

const TYPES = {
  crivo: ['Projeto do Crivo', 'application/json'],
  png: ['Imagem PNG', 'image/png'],
  jpg: ['Imagem JPEG', 'image/jpeg'],
  jpeg: ['Imagem JPEG', 'image/jpeg'],
  gif: ['Imagem GIF', 'image/gif'],
  zip: ['Arquivo ZIP', 'application/zip'],
  json: ['Dados JSON', 'application/json'],
  csv: ['Planilha CSV', 'text/csv'],
  txt: ['Texto', 'text/plain'],
  ase: ['Arquivo .ase', 'application/octet-stream'],
  aseprite: ['Arquivo .aseprite', 'application/octet-stream'],
};

const desktop = () => (typeof window.crivoDesktop?.saveDialog === 'function' ? window.crivoDesktop : null);
const browserPicker = () => (typeof window.showSaveFilePicker === 'function' ? window.showSaveFilePicker.bind(window) : null);

function describe(name) {
  const extension = (/\.([a-z0-9]{1,15})$/i.exec(name)?.[1] || '').toLowerCase();
  const [description, mime] = TYPES[extension] || [extension ? `Arquivo .${extension}` : 'Arquivo', 'application/octet-stream'];
  return { extension, description, mime };
}

// True when saving opens the "Save as" window (desktop app, Chrome or Edge).
export function canChooseLocation() {
  return Boolean(desktop() || browserPicker());
}

// The picker could not open here (no click or key press right before it, or an unsupported type).
export class PickerUnavailable extends Error {}

// Opens the "Save as" window. Returns where to save ({ label, path } or { label, handle })
// or null when the person cancels. Throws PickerUnavailable when there is no window to open.
export async function chooseLocation(name, { title = 'Salvar', purpose = 'export' } = {}) {
  const { extension, description, mime } = describe(name);
  const app = desktop();
  if (app) {
    const path = await app.saveDialog({ name, title, description, extension });
    return path ? { label: path, path } : null;
  }
  const picker = browserPicker();
  if (!picker) throw new PickerUnavailable('Este navegador não abre a janela "Salvar como".');
  try {
    const handle = await picker({
      id: purpose === 'project' ? 'crivo-projetos' : 'crivo-exportar',
      startIn: purpose === 'project' ? 'documents' : 'pictures',
      suggestedName: name,
      types: extension ? [{ description, accept: { [mime]: ['.' + extension] } }] : undefined,
    });
    return { label: handle.name, handle };
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw new PickerUnavailable(error?.message || String(error));
  }
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Writes the file to a place returned by chooseLocation (replacing what was there).
export async function writeToLocation(target, blob) {
  if (target.path) {
    await desktop().writeFile(target.path, await base64(blob));
    return;
  }
  const stream = await target.handle.createWritable();
  try {
    await stream.write(blob);
  } finally {
    await stream.close();
  }
}

// Plain browser download, to the Downloads folder.
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Saves a file asking where, when possible. Returns { saved: target } when the person chose the folder,
// { downloaded: true } when it went to the Downloads folder, or null when the person canceled.
export async function saveBlob(blob, name, options = {}) {
  if (canChooseLocation()) {
    let target;
    try {
      target = await chooseLocation(name, options);
    } catch (error) {
      if (!(error instanceof PickerUnavailable)) throw error;
      download(blob, name);
      return { downloaded: true };
    }
    if (!target) return null;
    await writeToLocation(target, blob);
    return { saved: target };
  }
  download(blob, name);
  return { downloaded: true };
}
