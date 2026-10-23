"""Builds the hand-made .aseprite fixtures used by tests/js/files.test.js (written straight from the
public file format spec, independent of the JavaScript writer).

Run:  python3 tests/js/fixtures/make_aseprite_fixtures.py
"""

import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def string(s):
    b = s.encode("utf-8")
    return struct.pack("<H", len(b)) + b


def chunk(kind, body):
    return struct.pack("<IH", len(body) + 6, kind) + body


def frame(chunks, duration):
    body = b"".join(chunks)
    return struct.pack("<IHHHxxI", len(body) + 16, 0xF1FA, len(chunks), duration, len(chunks)) + body


def header(frames, width, height, depth, flags, speed, transparent, colors):
    h = struct.pack("<IHHHHHIHII", 0, 0xA5E0, frames, width, height, depth, flags, speed, 0, 0)
    h += struct.pack("<B3xHBBhhHH", transparent, colors, 1, 1, 0, 0, 16, 16)
    return h + bytes(128 - len(h))


def finish(head, frames):
    data = head + b"".join(frames)
    return struct.pack("<I", len(data)) + data[4:]


def layer(name, flags=3, kind=0, level=0, blend=0, opacity=255, tileset=None):
    body = struct.pack("<HHHHHHB3x", flags, kind, level, 0, 0, blend, opacity) + string(name)
    if kind == 2:
        body += struct.pack("<I", tileset)
    return chunk(0x2004, body)


def cel(layer_index, x, y, kind, payload, opacity=255):
    return chunk(0x2005, struct.pack("<HhhBHh5x", layer_index, x, y, opacity, kind, 0) + payload)


def indexed():
    """8-bit indexed 4x3: new palette chunk, transparent index 0, a linked cel, a ping-pong reverse tag and a slice."""
    palette = [(0, 0, 0, 255), (255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255)]
    pal = struct.pack("<III8x", len(palette), 0, len(palette) - 1)
    for r, g, b, a in palette:
        pal += struct.pack("<HBBBB", 0, r, g, b, a)
    pixels = bytes([1, 2, 0, 3, 0, 1])  # a 3x2 cel at (1, 1)
    tags = struct.pack("<H8x", 1) + struct.pack("<HHBH6xBBBx", 0, 1, 3, 2, 10, 20, 30) + string("idle")
    tag_color = chunk(0x2020, struct.pack("<IBBBB", 2, 255, 128, 0, 255))
    sl = struct.pack("<III", 1, 3, 0) + string("hitbox") + struct.pack("<IiiII", 0, 1, 0, 2, 3)
    sl += struct.pack("<iiII", 0, 1, 1, 1) + struct.pack("<ii", 1, 2)
    f1 = frame(
        [
            chunk(0x2019, pal),
            layer("Fundo", flags=3, opacity=128),
            chunk(0x2018, tags),
            tag_color,
            chunk(0x2022, sl),
            cel(0, 1, 1, 2, struct.pack("<HH", 3, 2) + zlib.compress(pixels)),
        ],
        100,
    )
    f2 = frame([cel(0, 0, 0, 1, struct.pack("<H", 0))], 200)
    return finish(header(2, 4, 3, 8, 1, 100, 0, 4), [f1, f2])


def grayscale():
    """16-bit grayscale 2x2: a group with one child (child level 1), multiply blend, raw cel with cel opacity, old palette chunk."""
    old_palette = struct.pack("<HBB", 1, 0, 2) + bytes([10, 20, 30, 40, 50, 60])
    pixels = bytes([200, 255, 100, 255, 0, 0, 50, 128])  # (value, alpha) pairs
    f1 = frame(
        [
            chunk(0x0004, old_palette),
            layer("Grupo", flags=1 | 32, kind=1, level=0, opacity=255),
            layer("Filho", flags=3, kind=0, level=1, blend=1, opacity=255),
            cel(1, 0, 0, 0, struct.pack("<HH", 2, 2) + pixels, opacity=128),
        ],
        50,
    )
    return finish(header(1, 2, 2, 16, 0, 50, 0, 2), [f1])


def tilemap():
    """32-bit RGBA 4x2: a tileset with 2 tiles of 2x2 (tile 0 empty) and a tilemap layer using tile 1 twice, the second X-flipped."""
    tile1 = struct.pack("<4I", 0xFF0000FF, 0xFF00FF00, 0xFFFF0000, 0xFFFFFFFF)
    image = bytes(16) + tile1
    ts = struct.pack("<IIIHHh14x", 0, 2 | 4, 2, 2, 2, 1) + string("Tiles") + struct.pack("<I", 0)
    data = zlib.compress(image)
    ts = ts[: -4] + struct.pack("<I", len(data)) + data
    tiles = struct.pack("<II", 1, 1 | 0x20000000)
    payload = struct.pack("<HHHIIII10x", 2, 1, 32, 0x1FFFFFFF, 0x20000000, 0x40000000, 0x80000000) + zlib.compress(tiles)
    f1 = frame([chunk(0x2023, ts), layer("Mapa", kind=2, tileset=0), cel(0, 0, 0, 3, payload)], 100)
    return finish(header(1, 4, 2, 32, 1, 100, 0, 0), [f1])


if __name__ == "__main__":
    (HERE / "indexed.aseprite").write_bytes(indexed())
    (HERE / "grayscale.ase").write_bytes(grayscale())
    (HERE / "tilemap.aseprite").write_bytes(tilemap())
