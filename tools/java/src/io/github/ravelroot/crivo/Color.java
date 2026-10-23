package io.github.ravelroot.crivo;

public final class Color {

    private Color() {
    }

    public static int argb(int r, int g, int b, int a) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    public static int blend(int background, int foreground, double opacity) {
        double sa = ((foreground >>> 24) / 255.0) * opacity;
        if (sa <= 0) {
            return background;
        }
        double da = (background >>> 24) / 255.0;
        if (sa >= 1) {
            return foreground;
        }
        if (da == 0) {
            return (((int) Math.round(sa * 255)) << 24) | (foreground & 0x00ffffff);
        }
        double oa = sa + da * (1 - sa);
        int r = mix((foreground >>> 16) & 0xff, (background >>> 16) & 0xff, sa, da, oa);
        int g = mix((foreground >>> 8) & 0xff, (background >>> 8) & 0xff, sa, da, oa);
        int b = mix(foreground & 0xff, background & 0xff, sa, da, oa);
        return argb(r, g, b, (int) Math.round(oa * 255));
    }

    private static int mix(int s, int d, double sa, double da, double oa) {
        return (int) Math.round((s * sa + d * da * (1 - sa)) / oa);
    }

    public static String hex(int argb) {
        int a = argb >>> 24;
        String rgb = String.format("#%06x", argb & 0xffffff);
        return a == 255 ? rgb : rgb + String.format("%02x", a);
    }
}
