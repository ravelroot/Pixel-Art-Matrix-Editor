export const MIN_LEAVES = 3;
export const FAN = 6;
export const PIXEL_BUDGET = 2000000;
export const MAX_FRAMES = 48;
export const KINDS = ['open', 'saved', 'blank'];
export const TITLES = { open: 'Projetos abertos', saved: 'Projetos salvos', blank: 'Caderno em branco' };
export const NAME_LIMIT = 40;
export const PHOTO_LIMIT = 600000;

export function readCovers(raw) {
  const covers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return covers;
  for (const kind of KINDS) {
    const c = raw[kind];
    if (!c || typeof c !== 'object') continue;
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, NAME_LIMIT) : '';
    const photo = typeof c.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(c.photo) && c.photo.length <= PHOTO_LIMIT ? c.photo : null;
    if (name || photo) covers[kind] = { name, photo };
  }
  return covers;
}

export function bookTitle(kind, covers) {
  return covers[kind]?.name || TITLES[kind] || '';
}

export function paginate(items, minLeaves = MIN_LEAVES) {
  const leaves = Math.max(minLeaves, Math.ceil((items.length + 1) / 2));
  const pages = Array.from({ length: leaves * 2 }, (_, i) => (i < leaves * 2 - 1 ? (items[i] ?? null) : null));
  return { leaves, pages, total: leaves + 2 };
}

export function clampFlips(value, total) {
  return Math.max(0, Math.min(total - 1, value));
}

export function leafPose(index, flips, { open = true, gap = 12, depth = 22, fan = FAN } = {}) {
  const flipped = index < flips;
  const level = flipped ? flips - 1 - index : index - flips;
  const step = Math.min(level, fan);
  return {
    flipped,
    level,
    x: (flipped ? -1 : 1) * step * gap,
    z: -(step * depth + (level - step) * 0.5),
    rotate: flipped ? -180 : 0,
    shade: Math.min(0.3, step * 0.05),
  };
}

export function spread(flips, leaves) {
  if (flips <= 0) return { left: null, right: null, cover: true, end: false };
  const left = flips === 1 ? null : 2 * (flips - 2) + 1;
  const right = flips <= leaves ? 2 * (flips - 1) : null;
  return { left, right, cover: false, end: flips > leaves };
}

export function spreadLabel(flips, leaves) {
  const s = spread(flips, leaves);
  const total = leaves * 2 - 1;
  if (s.cover) return 'Capa';
  if (s.end) return `Fim · ${total} páginas`;
  if (s.left === null) return `Página 1 de ${total}`;
  return `Páginas ${s.left + 1}–${s.right + 1} de ${total}`;
}

export function frameDelays(doc) {
  const fallback = 1000 / Math.max(1, doc.fps || 8);
  return doc.frames.map((q) => Math.max(16, q.duration || fallback));
}

export function framesToRender(doc, budget = PIXEL_BUDGET, limit = MAX_FRAMES) {
  const count = Math.min(doc.frames.length, limit);
  if (doc.width * doc.height * count > budget) return 1;
  return count;
}

export function isBlank(pixels) {
  for (let i = 0; i < pixels.length; i++) if (pixels[i] >>> 24 !== 0) return false;
  return true;
}

export function pageCount(leaves) {
  return leaves * 2 - 1;
}

export function pageNumber(index) {
  return String(index + 1).padStart(2, '0');
}
