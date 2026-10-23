// Store-only ZIP writer (no compression: the entries are PNGs, already compressed) with CRC-32,
// local file headers, central directory and end record. Names are written as UTF-8 (flag bit 11).
import { crc32, ByteWriter } from './zlib.js';

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// files: [{ name, data: Uint8Array }]. Returns the .zip bytes.
export function createZip(files, { date = new Date() } = {}) {
  const w = new ByteWriter(1024 + files.reduce((t, f) => t + f.data.length + 100, 0));
  const { time, day } = dosDateTime(date);
  const encoder = new TextEncoder();
  const central = [];
  for (const f of files) {
    const name = encoder.encode(f.name);
    const crc = crc32(f.data);
    const offset = w.length;
    w.u32(0x04034b50);
    w.u16(20); // version needed
    w.u16(0x0800); // UTF-8 names
    w.u16(0); // method: stored
    w.u16(time);
    w.u16(day);
    w.u32(crc);
    w.u32(f.data.length);
    w.u32(f.data.length);
    w.u16(name.length);
    w.u16(0);
    w.bytes(name);
    w.bytes(f.data);
    central.push({ name, crc, size: f.data.length, offset });
  }
  const start = w.length;
  for (const c of central) {
    w.u32(0x02014b50);
    w.u16(20); // version made by
    w.u16(20); // version needed
    w.u16(0x0800);
    w.u16(0);
    w.u16(time);
    w.u16(day);
    w.u32(c.crc);
    w.u32(c.size);
    w.u32(c.size);
    w.u16(c.name.length);
    w.u16(0); // extra
    w.u16(0); // comment
    w.u16(0); // disk
    w.u16(0); // internal attributes
    w.u32(0); // external attributes
    w.u32(c.offset);
    w.bytes(c.name);
  }
  const size = w.length - start;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(size);
  w.u32(start);
  w.u16(0);
  return w.result();
}
