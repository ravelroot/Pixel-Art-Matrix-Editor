package io.github.ravelroot.crivo;

public final class Cor {

    private Cor() {
    }

    public static int argb(int r, int g, int b, int a) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    public static int sobrepor(int fundo, int frente, double opacidade) {
        double sa = ((frente >>> 24) / 255.0) * opacidade;
        if (sa <= 0) {
            return fundo;
        }
        double da = (fundo >>> 24) / 255.0;
        if (sa >= 1) {
            return frente;
        }
        if (da == 0) {
            return (((int) Math.round(sa * 255)) << 24) | (frente & 0x00ffffff);
        }
        double oa = sa + da * (1 - sa);
        int r = mistura((frente >>> 16) & 0xff, (fundo >>> 16) & 0xff, sa, da, oa);
        int g = mistura((frente >>> 8) & 0xff, (fundo >>> 8) & 0xff, sa, da, oa);
        int b = mistura(frente & 0xff, fundo & 0xff, sa, da, oa);
        return argb(r, g, b, (int) Math.round(oa * 255));
    }

    private static int mistura(int s, int d, double sa, double da, double oa) {
        return (int) Math.round((s * sa + d * da * (1 - sa)) / oa);
    }

    public static String hex(int argb) {
        int a = argb >>> 24;
        String rgb = String.format("#%06x", argb & 0xffffff);
        return a == 255 ? rgb : rgb + String.format("%02x", a);
    }
}
