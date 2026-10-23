import base64
import math
import struct
from array import array

# Pixels are packed RGBA integers (R in the low byte, A in the high byte), the same layout as the JavaScript editor.
# RLE format: each run is a varint length (7 bits per byte, low bits first) followed by the 4-byte little-endian color.
# The error messages below reach the user through the API, so they stay in Portuguese.


class RLEError(ValueError):
    pass


def encode(pixels):
    output = bytearray()
    n = len(pixels)
    i = 0
    while i < n:
        color = pixels[i]
        j = i + 1
        while j < n and pixels[j] == color:
            j += 1
        run = j - i
        while run >= 128:
            output.append((run & 127) | 128)
            run >>= 7
        output.append(run)
        output += struct.pack("<I", color)
        i = j
    return bytes(output)


def decode(data, total):
    pixels = array("I", bytes(4 * total)) if total else array("I")
    p = 0
    i = 0
    n = len(data)
    while p < n:
        run = 0
        shift = 0
        while True:
            if p >= n:
                raise RLEError("RLE truncado")
            b = data[p]
            p += 1
            run |= (b & 127) << shift
            if b < 128:
                break
            shift += 7
            if shift > 35:
                raise RLEError("Corrida inválida")
        if p + 4 > n:
            raise RLEError("RLE truncado")
        color = struct.unpack_from("<I", data, p)[0]
        p += 4
        if i + run > total:
            raise RLEError("RLE maior que a matriz")
        if color:
            pixels[i : i + run] = array("I", [color]) * run
        i += run
    if i != total:
        raise RLEError("RLE menor que a matriz")
    return pixels


def _runs(data, limit):
    """Yield (length, packed color) for each run, checking the structure without building the pixels."""
    p = 0
    n = len(data)
    count = 0
    while p < n:
        run = 0
        shift = 0
        while True:
            if p >= n:
                raise RLEError("RLE truncado")
            b = data[p]
            p += 1
            run |= (b & 127) << shift
            if b < 128:
                break
            shift += 7
            if shift > 35:
                raise RLEError("Corrida inválida")
        if p + 4 > n:
            raise RLEError("RLE truncado")
        color = struct.unpack_from("<I", data, p)[0]
        p += 4
        count += run
        if count > limit:
            raise RLEError("RLE maior que a matriz")
        yield run, color


def run_length(data, limit):
    """Number of pixels described by `data` (at most `limit`), without decoding them."""
    return sum(run for run, _ in _runs(data, limit))


def split_runs(data, size, count):
    """Split the RLE of `count` concatenated blocks of `size` pixels into one RLE per block (runs crossing a boundary
    are cut in two), keeping the original bytes of every run that does not cross one."""
    blocks = []
    current = bytearray()
    filled = 0

    def emit(run, color):
        while run >= 128:
            current.append((run & 127) | 128)
            run >>= 7
        current.append(run)
        current.extend(struct.pack("<I", color))

    for run, color in _runs(data, size * count):
        while run:
            take = min(run, size - filled)
            if take:
                emit(take, color)
            run -= take
            filled += take
            if filled == size:
                blocks.append(bytes(current))
                current.clear()
                filled = 0
    if filled or len(blocks) != count:
        raise RLEError("RLE menor que a matriz")
    return blocks


def from_base64(text):
    try:
        return base64.b64decode(text, validate=True)
    except (ValueError, TypeError) as error:
        raise RLEError("Base64 inválido") from error


def to_base64(data):
    return base64.b64encode(data).decode("ascii")


def channels(color):
    return color & 255, (color >> 8) & 255, (color >> 16) & 255, (color >> 24) & 255


def pack(r, g, b, a=255):
    return (a << 24) | (b << 16) | (g << 8) | r


def round_half_up(value):
    """JavaScript's Math.round (and Java's) for values >= 0: halves go up, unlike Python's round (half to even).

    Computed exactly (value - floor(value) has no rounding error), so it never differs from Math.round."""
    whole = math.floor(value)
    return whole + 1 if value - whole >= 0.5 else whole


def blend(background, foreground, opacity=1.0):
    """The editor's overlay() (core/colors.js): normal compositing, with Math.round rounding."""
    fr, fg, fb, fa = channels(foreground)
    sa = fa / 255 * opacity
    if sa <= 0:
        return background
    br, bg, bb, ba = channels(background)
    da = ba / 255
    if sa >= 1:
        return foreground
    if da == 0:
        return pack(fr, fg, fb, round_half_up(sa * 255))
    oa = sa + da * (1 - sa)

    def mix(s, d):
        return round_half_up((s * sa + d * da * (1 - sa)) / oa)

    return pack(mix(fr, br), mix(fg, bg), mix(fb, bb), round_half_up(oa * 255))


def composite(width, height, layers):
    """Flatten (pixels, opacity) layers, bottom first, into one frame."""
    total = width * height
    target = array("I", bytes(4 * total))
    for pixels, opacity in layers:
        if opacity <= 0:
            continue
        for i, c in enumerate(pixels):
            if not c >> 24:
                continue
            if c >> 24 == 255 and opacity >= 1:
                target[i] = c
            else:
                target[i] = blend(target[i], c, opacity)
    return target


def to_hex(color):
    r, g, b, a = channels(color)
    text = f"#{r:02x}{g:02x}{b:02x}"
    return text if a == 255 else text + f"{a:02x}"
