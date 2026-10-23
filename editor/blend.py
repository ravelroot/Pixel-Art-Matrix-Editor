"""Layer blend modes and group-aware frame compositing (Crivo 2.1).

The math is shared, operation by operation, with the editor (core/blend.js) and the Java tool (Blend.java), so the
three render the same pixels:

- `normal` keeps the integer path of 2.0.0 (editor.rle.blend, the twin of overlay() in core/colors.js, rounding
  halves up like Math.round).
- Every other mode uses the W3C Compositing and Blending Level 1 formulas on doubles in [0, 1]:
  αs = (alpha / 255) · opacity, Cs' = (1 − αb) · Cs + αb · B(Cb, Cs), αo = αs + αb · (1 − αs),
  Co = (αs · Cs' + αb · Cb · (1 − αs)) / αo, channel = floor(Co · 255 + 0.5), alpha = floor(αo · 255 + 0.5),
  and αo = 0 gives the transparent pixel 0. addition = min(1, b + s), subtract = max(0, b − s),
  divide = min(1, b / s) with s = 0 → 1.

Groups (as in the editor and Aseprite): a group in normal mode at 100% is pass-through, its children composite
directly onto the layers below it; any other group is isolated, its children are composited, bottom first, into a
transparent buffer that is then composited onto the backdrop with the group's own blend mode and opacity. A hidden
group hides all its children. Reference layers (and everything inside a reference group) are never part of the
rendered image.

Pixels are packed RGBA integers (R in the low byte, A in the high byte), as in editor.rle.
"""

import math
from array import array

from .models import BLEND_MODES
from .rle import blend as normal_blend

__all__ = ["BLEND_MODES", "blend_pixel", "composite_layers", "render_frame"]

MAX_GROUP_DEPTH = 32


def _multiply(b, s):
    return b * s


def _screen(b, s):
    return b + s - b * s


def _hard_light(b, s):
    if s <= 0.5:
        return _multiply(b, 2 * s)
    return _screen(b, 2 * s - 1)


def _overlay(b, s):
    return _hard_light(s, b)


def _color_dodge(b, s):
    if b == 0:
        return 0.0
    if s >= 1:
        return 1.0
    return min(1.0, b / (1 - s))


def _color_burn(b, s):
    if b >= 1:
        return 1.0
    if s <= 0:
        return 0.0
    return 1 - min(1.0, (1 - b) / s)


def _soft_light(b, s):
    if s <= 0.5:
        return b - (1 - 2 * s) * b * (1 - b)
    d = ((16 * b - 12) * b + 4) * b if b <= 0.25 else math.sqrt(b)
    return b + (2 * s - 1) * (d - b)


def _divide(b, s):
    if s == 0:
        return 1.0
    return min(1.0, b / s)


SEPARABLE = {
    "multiply": _multiply,
    "screen": _screen,
    "overlay": _overlay,
    "darken": min,
    "lighten": max,
    "color-dodge": _color_dodge,
    "color-burn": _color_burn,
    "hard-light": _hard_light,
    "soft-light": _soft_light,
    "difference": lambda b, s: abs(b - s),
    "exclusion": lambda b, s: b + s - 2 * b * s,
    "addition": lambda b, s: min(1.0, b + s),
    "subtract": lambda b, s: max(0.0, b - s),
    "divide": _divide,
}


def _lum(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def _clip_color(c):
    lum = _lum(c)
    n = min(c[0], c[1], c[2])
    x = max(c[0], c[1], c[2])
    r, g, b = c
    if n < 0:
        r, g, b = (lum + (v - lum) * lum / (lum - n) for v in (r, g, b))
    if x > 1:
        r, g, b = (lum + (v - lum) * (1 - lum) / (x - lum) for v in (r, g, b))
    return r, g, b


def _set_lum(c, lum):
    d = lum - _lum(c)
    return _clip_color((c[0] + d, c[1] + d, c[2] + d))


def _sat(c):
    return max(c[0], c[1], c[2]) - min(c[0], c[1], c[2])


def _set_sat(c, s):
    # Indices of the largest, middle and smallest components: a stable sort from the largest down, so ties keep the
    # R, G, B order (as `[0, 1, 2].sort((i, j) => c[j] - c[i])` in core/blend.js).
    hi, mid, lo = sorted(range(3), key=lambda i: -c[i])
    out = [0.0, 0.0, 0.0]
    if c[hi] > c[lo]:
        out[mid] = (c[mid] - c[lo]) * s / (c[hi] - c[lo])
        out[hi] = s
    return out[0], out[1], out[2]


NON_SEPARABLE = {
    "hue": lambda b, s: _set_lum(_set_sat(s, _sat(b)), _lum(b)),
    "saturation": lambda b, s: _set_lum(_set_sat(b, _sat(s)), _lum(b)),
    "color": lambda b, s: _set_lum(s, _lum(b)),
    "luminosity": lambda b, s: _set_lum(b, _lum(s)),
}


def _channels(color):
    return color & 255, (color >> 8) & 255, (color >> 16) & 255, color >> 24


def _round(v):
    return math.floor(v * 255 + 0.5)


def blend_pixel(backdrop, source, opacity=1.0, mode="normal"):
    """Composite one packed source pixel over a packed backdrop pixel with a layer opacity in [0, 1]."""
    if mode == "normal":
        return normal_blend(backdrop, source, opacity)
    sr, sg, sb, sa8 = _channels(source)
    br, bg, bb, ba8 = _channels(backdrop)
    a_s = (sa8 / 255) * opacity
    a_b = ba8 / 255
    cs = (sr / 255, sg / 255, sb / 255)
    cb = (br / 255, bg / 255, bb / 255)
    function = SEPARABLE.get(mode)
    mixed = tuple(function(cb[i], cs[i]) for i in range(3)) if function else NON_SEPARABLE[mode](cb, cs)
    a_o = a_s + a_b * (1 - a_s)
    if a_o == 0:
        return 0
    out = []
    for i in range(3):
        cs_prime = (1 - a_b) * cs[i] + a_b * mixed[i]
        co = (a_s * cs_prime + a_b * cb[i] * (1 - a_s)) / a_o
        out.append(min(255, max(0, _round(co))))
    alpha = min(255, max(0, _round(a_o)))
    return (alpha << 24) | (out[2] << 16) | (out[1] << 8) | out[0]


def _composite_into(target, pixels, opacity, mode):
    if opacity <= 0:
        return
    if mode == "normal":
        # Exactly the 2.0.0 loop (editor.rle.composite).
        for i, c in enumerate(pixels):
            if not c >> 24:
                continue
            if c >> 24 == 255 and opacity >= 1:
                target[i] = c
            else:
                target[i] = normal_blend(target[i], c, opacity)
        return
    for i, c in enumerate(pixels):
        if not c >> 24:
            continue
        target[i] = blend_pixel(target[i], c, opacity, mode)


def composite_layers(total, layers):
    """Flatten (pixels, opacity, blend mode) layers, bottom first, into a new buffer of `total` pixels."""
    target = array("I", bytes(4 * total))
    for pixels, opacity, mode in layers:
        _composite_into(target, pixels, opacity, mode)
    return target


def render_frame(layers, cells, total, include_hidden=False, include_reference=False):
    """Composite one frame, exactly like PixelDocument.composite in the editor (core/document.js).

    `layers` are the document's layer dicts (bottom first, with optional "kind", "parent", "blendMode",
    "reference"), and `cells` maps a layer id to its decoded pixels in this frame. A layer whose parent does not
    exist is drawn at the top level. A group in normal mode at 100% passes its children straight through onto the
    layers below it; any other group is isolated: its children are composited into a transparent buffer, which is
    then blended with the group's mode and opacity. Groups nested deeper than 32 levels are skipped. Without
    groups, blend modes or reference layers this is exactly editor.rle.composite.
    """
    ids = {layer["id"] for layer in layers}
    children = {}
    for layer in layers:
        parent = layer.get("parent")
        children.setdefault(parent if parent in ids else None, []).append(layer)

    def draw(parent, target, depth):
        for layer in children.get(parent, ()):
            if (not layer.get("visible", True) and not include_hidden) or (layer.get("reference") and not include_reference):
                continue
            opacity = layer.get("opacity", 100) / 100
            if opacity <= 0:
                continue
            mode = layer.get("blendMode") or "normal"
            if layer.get("kind") == "group":
                if depth > MAX_GROUP_DEPTH:
                    continue
                if mode == "normal" and layer.get("opacity", 100) >= 100:
                    draw(layer["id"], target, depth + 1)
                else:
                    _composite_into(target, draw(layer["id"], array("I", bytes(4 * total)), depth + 1), opacity, mode)
                continue
            pixels = cells.get(layer["id"])
            if pixels is not None:
                _composite_into(target, pixels, opacity, mode)
        return target

    return draw(None, array("I", bytes(4 * total)), 0)
