// Tilesets and tilemap layers. A tilemap cel stores tile indices (columns × rows) in doc.tileCells; its pixels
// (doc.cell) are always kept rendered from the tiles, so every other code path just reads pixels.
// This module does not import document.js (document.js imports it).

export const MAX_TILES = 4096;

export function gridSize(doc, tileset) {
  return { columns: Math.ceil(doc.width / tileset.tileWidth), rows: Math.ceil(doc.height / tileset.tileHeight) };
}

export function tilesetOf(doc, layer) {
  if (!layer || layer.kind !== 'tilemap') return null;
  return doc.tilesets.find((t) => t.id === layer.tileset) ?? null;
}

export function hasTileGrid(doc, frameId, layerId) {
  return doc.tileCells.has(doc.key(frameId, layerId));
}

// Tile indices of a tilemap cel (created empty on demand; linked cels share the same array).
export function tileGrid(doc, frameId, layerId) {
  const layer = doc.layer(layerId);
  const tileset = tilesetOf(doc, layer);
  if (!tileset) return null;
  const k = doc.key(frameId, layerId);
  let grid = doc.tileCells.get(k);
  if (!grid) {
    const source = doc.links.get(k);
    grid = source && doc.tileCells.get(source);
    if (!grid) {
      const { columns, rows } = gridSize(doc, tileset);
      grid = new Uint32Array(columns * rows);
      if (source) doc.tileCells.set(source, grid);
    }
    doc.tileCells.set(k, grid);
  }
  return grid;
}

function drawTile(doc, pixels, tileset, column, row, index) {
  const { tileWidth: tw, tileHeight: th } = tileset;
  const tile = tileset.tiles[index] ?? tileset.tiles[0];
  for (let y = 0; y < th; y++) {
    const py = row * th + y;
    if (py >= doc.height) break;
    for (let x = 0; x < tw; x++) {
      const px = column * tw + x;
      if (px >= doc.width) break;
      pixels[py * doc.width + px] = tile ? tile[y * tw + x] : 0;
    }
  }
}

// Re-renders the pixels of one tilemap cel from its tiles.
export function renderTilemapCel(doc, frameId, layerId) {
  const tileset = tilesetOf(doc, doc.layer(layerId));
  if (!tileset || !hasTileGrid(doc, frameId, layerId)) return;
  const grid = tileGrid(doc, frameId, layerId);
  const pixels = doc.cell(frameId, layerId);
  const { columns, rows } = gridSize(doc, tileset);
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) drawTile(doc, pixels, tileset, c, r, grid[r * columns + c]);
}

// Re-renders every cel of every tilemap layer that uses the tileset (or all tilesets when id is null).
export function renderTilesets(doc, tilesetId = null) {
  for (const layer of doc.layers) {
    if (layer.kind !== 'tilemap' || (tilesetId && layer.tileset !== tilesetId)) continue;
    for (const q of doc.frames) renderTilemapCel(doc, q.id, layer.id);
  }
}

export function createTileset(doc, tileWidth, tileHeight, { id, name } = {}) {
  const tw = Math.max(1, Math.min(256, Math.round(tileWidth) || 16));
  const th = Math.max(1, Math.min(256, Math.round(tileHeight) || 16));
  const tileset = {
    id: id ?? 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: name ?? `Tileset ${doc.tilesets.length + 1}`,
    tileWidth: tw,
    tileHeight: th,
    tiles: [new Uint32Array(tw * th)],
  };
  doc.tilesets.push(tileset);
  return tileset;
}

export function addTile(tileset, pixels = null) {
  if (tileset.tiles.length >= MAX_TILES) throw new Error(`O tileset pode ter no máximo ${MAX_TILES} tiles.`);
  const tile = new Uint32Array(tileset.tileWidth * tileset.tileHeight);
  if (pixels) tile.set(pixels);
  tileset.tiles.push(tile);
  return tileset.tiles.length - 1;
}

export function tileIndexAt(doc, frameId, layerId, x, y) {
  const tileset = tilesetOf(doc, doc.layer(layerId));
  if (!tileset || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return -1;
  const { columns } = gridSize(doc, tileset);
  const grid = tileGrid(doc, frameId, layerId);
  return grid[Math.floor(y / tileset.tileHeight) * columns + Math.floor(x / tileset.tileWidth)];
}

// Places a tile at the cell under the pixel (x, y). Returns true when something changed.
export function placeTile(doc, frameId, layerId, x, y, index) {
  const tileset = tilesetOf(doc, doc.layer(layerId));
  if (!tileset || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
  if (index < 0 || index >= tileset.tiles.length) return false;
  const { columns } = gridSize(doc, tileset);
  const grid = tileGrid(doc, frameId, layerId);
  const column = Math.floor(x / tileset.tileWidth);
  const row = Math.floor(y / tileset.tileHeight);
  if (grid[row * columns + column] === index) return false;
  grid[row * columns + column] = index;
  drawTile(doc, doc.cell(frameId, layerId), tileset, column, row, index);
  return true;
}

// Pixel mode on a tilemap layer: writes the painted pixels into the tiles under them (every instance updates).
// Painting over the empty tile (0) creates a new tile for that cell. `changes` is a list of [index, color].
export function applyPixelsToTiles(doc, frameId, layerId, changes) {
  const tileset = tilesetOf(doc, doc.layer(layerId));
  if (!tileset) return false;
  const { columns } = gridSize(doc, tileset);
  const grid = tileGrid(doc, frameId, layerId);
  const { tileWidth: tw, tileHeight: th } = tileset;
  let changed = false;
  for (const [i, color] of changes) {
    const x = i % doc.width;
    const y = Math.floor(i / doc.width);
    const g = Math.floor(y / th) * columns + Math.floor(x / tw);
    if (grid[g] === 0) {
      if (!color) continue;
      grid[g] = addTile(tileset, tileset.tiles[0]);
    }
    const tile = tileset.tiles[grid[g]];
    const local = (y % th) * tw + (x % tw);
    if (tile[local] !== color) {
      tile[local] = color;
      changed = true;
    }
  }
  renderTilesets(doc, tileset.id);
  return changed;
}

// After the matrix changes size, the grids get the new number of columns and rows (keeping the top-left
// tiles) and the pixels are rendered again.
export function fitTileGrids(doc, oldWidth = doc.width) {
  for (const [k, grid] of doc.tileCells) {
    const layerId = k.slice(k.indexOf(':') + 1);
    const tileset = tilesetOf(doc, doc.layer(layerId));
    if (!tileset) {
      doc.tileCells.delete(k);
      continue;
    }
    const { columns, rows } = gridSize(doc, tileset);
    if (grid.length === columns * rows) continue;
    const oldColumns = Math.max(1, Math.ceil(oldWidth / tileset.tileWidth));
    const fitted = new Uint32Array(columns * rows);
    for (let i = 0; i < Math.min(grid.length, fitted.length); i++) {
      const r = Math.floor(i / oldColumns);
      const c = i % oldColumns;
      if (c < columns && r < rows) fitted[r * columns + c] = grid[i];
    }
    doc.tileCells.set(k, fitted);
  }
  for (const [k, source] of doc.links) if (doc.tileCells.has(source)) doc.tileCells.set(k, doc.tileCells.get(source));
  renderTilesets(doc);
}
