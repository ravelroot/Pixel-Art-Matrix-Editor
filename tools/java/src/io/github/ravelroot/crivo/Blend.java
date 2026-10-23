package io.github.ravelroot.crivo;

import java.util.List;

/**
 * Layer blend modes (Crivo 2.1), with the same math, operation by operation, as the editor (core/blend.js) and the
 * server (editor/blend.py).
 *
 * <p>{@code normal} keeps the 2.0 path ({@link Color#blend}). Every other mode uses the W3C Compositing and Blending
 * Level 1 formulas on doubles in [0, 1]: αs = (alpha / 255) · opacity, Cs' = (1 − αb) · Cs + αb · B(Cb, Cs),
 * αo = αs + αb · (1 − αs), Co = (αs · Cs' + αb · Cb · (1 − αs)) / αo, channel = floor(Co · 255 + 0.5),
 * alpha = floor(αo · 255 + 0.5), and αo = 0 gives the transparent pixel 0. addition = min(1, b + s),
 * subtract = max(0, b − s), divide = min(1, b / s) with s = 0 → 1. Pixels are ARGB integers.
 */
public final class Blend {

    public static final List<String> MODES = List.of(
            "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
            "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "addition", "subtract",
            "divide");

    private Blend() {
    }

    private static double multiply(double b, double s) {
        return b * s;
    }

    private static double screen(double b, double s) {
        return b + s - b * s;
    }

    private static double hardLight(double b, double s) {
        if (s <= 0.5) {
            return multiply(b, 2 * s);
        }
        return screen(b, 2 * s - 1);
    }

    private static double separable(String mode, double b, double s) {
        return switch (mode) {
            case "multiply" -> multiply(b, s);
            case "screen" -> screen(b, s);
            case "overlay" -> hardLight(s, b);
            case "darken" -> Math.min(b, s);
            case "lighten" -> Math.max(b, s);
            case "color-dodge" -> b == 0 ? 0.0 : s >= 1 ? 1.0 : Math.min(1.0, b / (1 - s));
            case "color-burn" -> b >= 1 ? 1.0 : s <= 0 ? 0.0 : 1 - Math.min(1.0, (1 - b) / s);
            case "hard-light" -> hardLight(b, s);
            case "soft-light" -> {
                if (s <= 0.5) {
                    yield b - (1 - 2 * s) * b * (1 - b);
                }
                double d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
                yield b + (2 * s - 1) * (d - b);
            }
            case "difference" -> Math.abs(b - s);
            case "exclusion" -> b + s - 2 * b * s;
            case "addition" -> Math.min(1.0, b + s);
            case "subtract" -> Math.max(0.0, b - s);
            case "divide" -> s == 0 ? 1.0 : Math.min(1.0, b / s);
            default -> throw new IllegalArgumentException("Modo de mesclagem inválido: " + mode);
        };
    }

    private static double lum(double[] c) {
        return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    }

    private static double[] clipColor(double[] c) {
        double l = lum(c);
        double n = Math.min(c[0], Math.min(c[1], c[2]));
        double x = Math.max(c[0], Math.max(c[1], c[2]));
        double[] out = c.clone();
        if (n < 0) {
            for (int i = 0; i < 3; i++) {
                out[i] = l + (out[i] - l) * l / (l - n);
            }
        }
        if (x > 1) {
            for (int i = 0; i < 3; i++) {
                out[i] = l + (out[i] - l) * (1 - l) / (x - l);
            }
        }
        return out;
    }

    private static double[] setLum(double[] c, double l) {
        double d = l - lum(c);
        return clipColor(new double[] {c[0] + d, c[1] + d, c[2] + d});
    }

    private static double sat(double[] c) {
        return Math.max(c[0], Math.max(c[1], c[2])) - Math.min(c[0], Math.min(c[1], c[2]));
    }

    private static double[] setSat(double[] c, double s) {
        // Indices from the largest to the smallest component, with a stable sort so ties keep the R, G, B order
        // (as [0, 1, 2].sort((i, j) => c[j] - c[i]) in core/blend.js).
        int[] order = {0, 1, 2};
        for (int i = 1; i < 3; i++) {
            for (int j = i; j > 0 && c[order[j - 1]] < c[order[j]]; j--) {
                int t = order[j];
                order[j] = order[j - 1];
                order[j - 1] = t;
            }
        }
        int hi = order[0];
        int mid = order[1];
        int lo = order[2];
        double[] out = new double[3];
        if (c[hi] > c[lo]) {
            out[mid] = (c[mid] - c[lo]) * s / (c[hi] - c[lo]);
            out[hi] = s;
        }
        return out;
    }

    private static double[] nonSeparable(String mode, double[] b, double[] s) {
        return switch (mode) {
            case "hue" -> setLum(setSat(s, sat(b)), lum(b));
            case "saturation" -> setLum(setSat(b, sat(s)), lum(b));
            case "color" -> setLum(s, lum(b));
            case "luminosity" -> setLum(b, lum(s));
            default -> null;
        };
    }

    private static int round(double v) {
        return Math.min(255, Math.max(0, (int) Math.floor(v * 255 + 0.5)));
    }

    /** Composites one ARGB source pixel over an ARGB backdrop pixel with a layer opacity in [0, 1]. */
    public static int blend(int backdrop, int source, double opacity, String mode) {
        if (mode.equals("normal")) {
            return Color.blend(backdrop, source, opacity);
        }
        double as = ((source >>> 24) / 255.0) * opacity;
        double ab = (backdrop >>> 24) / 255.0;
        double[] cs = {((source >>> 16) & 0xff) / 255.0, ((source >>> 8) & 0xff) / 255.0, (source & 0xff) / 255.0};
        double[] cb = {((backdrop >>> 16) & 0xff) / 255.0, ((backdrop >>> 8) & 0xff) / 255.0, (backdrop & 0xff) / 255.0};
        double[] mixed = nonSeparable(mode, cb, cs);
        if (mixed == null) {
            mixed = new double[3];
            for (int i = 0; i < 3; i++) {
                mixed[i] = separable(mode, cb[i], cs[i]);
            }
        }
        double ao = as + ab * (1 - as);
        if (ao == 0) {
            return 0;
        }
        int[] out = new int[3];
        for (int i = 0; i < 3; i++) {
            double csPrime = (1 - ab) * cs[i] + ab * mixed[i];
            double co = (as * csPrime + ab * cb[i] * (1 - as)) / ao;
            out[i] = round(co);
        }
        return Color.argb(out[0], out[1], out[2], round(ao));
    }

    /** Composites a whole layer (same size as {@code target}) onto {@code target}. */
    public static void composite(int[] target, int[] source, double opacity, String mode) {
        if (opacity <= 0) {
            return;
        }
        boolean normal = mode.equals("normal");
        for (int i = 0; i < source.length; i++) {
            int color = source[i];
            int a = color >>> 24;
            if (a == 0) {
                continue;
            }
            if (normal) {
                target[i] = (a == 255 && opacity >= 1) ? color : Color.blend(target[i], color, opacity);
            } else {
                target[i] = blend(target[i], color, opacity, mode);
            }
        }
    }
}
