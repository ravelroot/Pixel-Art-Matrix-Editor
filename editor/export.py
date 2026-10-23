import json
import re
import struct
import unicodedata
import zlib

from .rle import to_hex

FORMATS = {
    "json": ("application/json", "json"),
    "csv": ("text/csv", "csv"),
    "js": ("text/javascript", "js"),
    "py": ("text/x-python", "py"),
    "c": ("text/x-c", "h"),
    "java": ("text/x-java", "java"),
}

PNG_MAX_SIDE = 2048


def identifier(name, style="camel"):
    """Turn a project name into a code identifier. Styles: camel, pascal, snake, constant."""
    base = unicodedata.normalize("NFD", name or "sprite")
    base = "".join(c for c in base if unicodedata.category(c) != "Mn")
    parts = [p.lower() for p in re.split(r"[^A-Za-z0-9]+", base) if p]
    if not parts:
        parts = ["sprite"]
    if parts[0][0].isdigit():
        parts.insert(0, "sprite")
    if style == "constant":
        return "_".join(parts).upper()
    if style == "snake":
        return "_".join(parts)
    if style == "pascal":
        return "".join(p.capitalize() for p in parts)
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def build_matrices(frames, width, height, mode="indices"):
    order = {}
    if mode == "indices":
        for px in frames:
            for c in px:
                if c >> 24 and c not in order:
                    order[c] = len(order)
    matrices = []
    for px in frames:
        rows = []
        for y in range(height):
            row = []
            for x in range(width):
                c = px[y * width + x]
                if mode == "indices":
                    row.append(order[c] if c >> 24 else -1)
                else:
                    row.append(to_hex(c) if c >> 24 else None)
            rows.append(row)
        matrices.append(rows)
    return {
        "width": width,
        "height": height,
        "mode": mode,
        "palette": [to_hex(c) for c in order],
        "frames": matrices,
    }


def _value(v, quote, null):
    if v is None:
        return null
    if isinstance(v, str):
        return f"{quote}{v}{quote}"
    return str(v)


def _rows(matrix, indent, quote, null):
    return ",\n".join(indent + "[" + ", ".join(_value(v, quote, null) for v in row) + "]" for row in matrix)


def _hex_to_int(hex_, order):
    h = hex_.replace("#", "")
    rgb = h[:6].upper()
    a = (h[6:8] if len(h) == 8 else "FF").upper()
    return "0x" + a + rgb if order == "argb" else "0x" + rgb + a


def _value_width(data):
    widest = 1
    for frame in data["frames"]:
        for row in frame:
            for v in row:
                widest = max(widest, len(str(v)))
    return widest


def _generate_c(data, name):
    id_ = identifier(name, "snake")
    ID = id_.upper()
    indices = data["mode"] == "indices"
    c_type = ("int32_t" if len(data["palette"]) > 32767 else "int16_t") if indices else "uint32_t"
    w = _value_width(data) if indices else 10

    def convert(v):
        if indices:
            return str(v)
        return "0x00000000" if v is None else _hex_to_int(v, "rgba")

    frames = ",\n".join(
        "    {\n" + ",\n".join("        {" + ", ".join(convert(v).rjust(w) for v in row) + "}" for row in frame) + "\n    }" for frame in data["frames"]
    )
    palette = ", ".join(_hex_to_int(c, "rgba") for c in data["palette"]) if data["palette"] else "0x00000000"
    return (
        f"#ifndef {ID}_H\n#define {ID}_H\n\n#include <stdint.h>\n\n"
        f"#define {ID}_WIDTH {data['width']}\n#define {ID}_HEIGHT {data['height']}\n#define {ID}_FRAMES {len(data['frames'])}\n"
        f"#define {ID}_COLORS {len(data['palette'])}\n\n"
        f"static const uint32_t {id_}_palette[{max(1, len(data['palette']))}] = {{{palette}}};\n\n"
        f"static const {c_type} {id_}_pixels[{ID}_FRAMES][{ID}_HEIGHT][{ID}_WIDTH] = {{\n" + frames + "\n};\n\n#endif\n"
    )


# A Java initializer goes past 64 KB of bytecode with a few thousand numbers, and the class does not compile.
# Above this limit the matrix and the palette are packed into strings and decoded when the class loads
# (the same output as the JavaScript editor).
JAVA_LITERAL_LIMIT = 4096
JAVA_CHUNK = 20000


def _java_string(codes):
    parts = []
    for c in codes:
        if c == 34:
            parts.append('\\"')
        elif c == 92:
            parts.append("\\\\")
        elif 32 <= c < 127:
            parts.append(chr(c))
        elif c < 128:
            parts.append("\\" + format(c, "03o"))
        else:
            parts.append("\\u" + format(c, "04X"))
    return "".join(parts)


def _java_chunks(codes, indent):
    return ",\n".join(f'{indent}"{_java_string(codes[i : i + JAVA_CHUNK])}"' for i in range(0, len(codes), JAVA_CHUNK))


def _argb(hex_):
    h = hex_.replace("#", "")
    return (int(h[6:8] if len(h) == 8 else "ff", 16) << 24) | int(h[:6], 16)


def _generate_compact_java(data, class_name):
    indices = data["mode"] == "indices"
    frame_count = len(data["frames"])
    total = frame_count * data["height"] * data["width"]
    one_char = indices and len(data["palette"]) + 33 <= 0xFFFF
    base = (33 if one_char else 1) if indices else 0
    codes = []
    for frame in data["frames"]:
        for row in frame:
            for v in row:
                if one_char:
                    codes.append(v + 33)
                else:
                    u = v + 1 if indices else (0 if v is None else _argb(v))
                    codes.extend((u >> 16, u & 0xFFFF))
    colors = []
    for c in data["palette"]:
        u = _argb(c)
        colors.extend((u >> 16, u & 0xFFFF))
    encoding = "one character per pixel (value + 33)" if one_char else "two characters per value (high and low 16 bits)"
    transparent = "    public static final int TRANSPARENT = -1;\n" if indices else ""
    return (
        f"public final class {class_name} {{\n\n"
        f"    public static final int WIDTH = {data['width']};\n"
        f"    public static final int HEIGHT = {data['height']};\n{transparent}"
        "\n    public static final int[] PALETTE;\n"
        "    public static final int[][][] FRAMES;\n\n"
        "    // Matrix too large for a Java literal (64 KB limit per method): the values are packed\n"
        f"    // as text, {encoding}, and are read when the class loads.\n"
        f"    private static final String[] PALETTE_DATA = {{\n{_java_chunks(colors, '        ')}{',' if colors else ''}\n    }};\n\n"
        f"    private static final String[] DATA = {{\n{_java_chunks(codes, '        ')},\n    }};\n\n"
        "    static {\n"
        f"        PALETTE = read(PALETTE_DATA, 2, 0, {len(data['palette'])});\n"
        f"        int[] v = read(DATA, {1 if one_char else 2}, {base}, {total});\n"
        f"        FRAMES = new int[{frame_count}][HEIGHT][WIDTH];\n"
        f"        for (int f = 0, i = 0; f < {frame_count}; f++)\n"
        "            for (int y = 0; y < HEIGHT; y++)\n"
        "                for (int x = 0; x < WIDTH; x++) FRAMES[f][y][x] = v[i++];\n"
        "    }\n\n"
        "    private static int[] read(String[] parts, int width, int base, int total) {\n"
        "        StringBuilder text = new StringBuilder();\n"
        "        for (String part : parts) text.append(part);\n"
        "        int[] values = new int[total];\n"
        "        for (int i = 0, k = 0; i < total; i++) {\n"
        "            if (width == 1) values[i] = text.charAt(k++) - base;\n"
        "            else values[i] = ((text.charAt(k++) << 16) | text.charAt(k++)) - base;\n"
        "        }\n"
        "        return values;\n"
        "    }\n\n"
        f"    private {class_name}() {{\n    }}\n}}\n"
    )


def _generate_java(data, name):
    class_name = identifier(name, "pascal")
    if len(data["frames"]) * data["height"] * data["width"] > JAVA_LITERAL_LIMIT or len(data["palette"]) > 2048:
        return _generate_compact_java(data, class_name)
    indices = data["mode"] == "indices"
    w = _value_width(data) if indices else 10

    def convert(v):
        if indices:
            return str(v)
        return "0x00000000" if v is None else _hex_to_int(v, "argb")

    frames = ",\n".join(
        "        {\n" + ",\n".join("            {" + ", ".join(convert(v).rjust(w) for v in row) + "}" for row in frame) + "\n        }"
        for frame in data["frames"]
    )
    transparent = "    public static final int TRANSPARENT = -1;\n" if indices else ""
    palette = ", ".join(_hex_to_int(c, "argb") for c in data["palette"])
    return (
        f"public final class {class_name} {{\n\n"
        f"    public static final int WIDTH = {data['width']};\n"
        f"    public static final int HEIGHT = {data['height']};\n{transparent}"
        f"\n    public static final int[] PALETTE = {{{palette}}};\n\n"
        f"    public static final int[][][] FRAMES = {{\n" + frames + f"\n    }};\n\n    private {class_name}() {{\n    }}\n}}\n"
    )


def _png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def generate_png(pixels, width, height, scale=1):
    """Encode packed RGBA pixels (R in the low byte) as an 8-bit-per-channel PNG, upscaled with nearest neighbor."""
    scale = int(scale)
    if scale < 1 or width * scale > PNG_MAX_SIDE or height * scale > PNG_MAX_SIDE:
        raise ValueError(f"A imagem final precisa ter no máximo {PNG_MAX_SIDE} px de lado.")
    rows = bytearray()
    for y in range(height):
        row = bytearray()
        for c in pixels[y * width : (y + 1) * width]:
            row += struct.pack("<I", c & 0xFFFFFFFF) * scale
        rows += (b"\x00" + bytes(row)) * scale
    header = struct.pack(">IIBBBBB", width * scale, height * scale, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + _png_chunk(b"IEND", b"")


def generate(fmt, data, name):
    """Render the matrices from build_matrices() in one of FORMATS."""
    if fmt == "c":
        return _generate_c(data, name)
    if fmt == "java":
        return _generate_java(data, name)
    if fmt == "json":
        return json.dumps({"name": name, **data, **({"transparent": -1} if data["mode"] == "indices" else {})}, ensure_ascii=False) + "\n"
    if fmt == "csv":
        blocks = []
        for frame in data["frames"]:
            blocks.append("\n".join(",".join("" if v is None else str(v) for v in row) for row in frame))
        return "\n\n".join(blocks) + "\n"
    if fmt == "js":
        frames = ",\n".join("    [\n" + _rows(frame, "      ", "'", "null") + ",\n    ]" for frame in data["frames"])
        palette = ", ".join(f"'{c}'" for c in data["palette"])
        transparent = "  transparent: -1,\n" if data["mode"] == "indices" else ""
        return (
            f"export const {identifier(name)} = {{\n"
            f"  width: {data['width']},\n  height: {data['height']},\n{transparent}"
            f"  palette: [{palette}],\n  frames: [\n{frames},\n  ],\n}};\n"
        )
    if fmt == "py":
        frames = ",\n".join("        [\n" + _rows(frame, "            ", '"', "None") + ",\n        ]" for frame in data["frames"])
        palette = ", ".join(f'"{c}"' for c in data["palette"])
        transparent = '    "transparent": -1,\n' if data["mode"] == "indices" else ""
        return (
            f"{identifier(name, 'constant')} = {{\n"
            f'    "width": {data["width"]},\n    "height": {data["height"]},\n{transparent}'
            f'    "palette": [{palette}],\n    "frames": [\n{frames},\n    ],\n}}\n'
        )
    raise ValueError(f"Unknown format: {fmt}")
