package io.github.ravelroot.crivo;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

public final class Rle {

    private Rle() {
    }

    public static int[] decode(byte[] data, int total) {
        int[] pixels = new int[total];
        int p = 0;
        int i = 0;
        while (p < data.length) {
            long run = 0;
            int shift = 0;
            while (true) {
                if (p >= data.length) {
                    throw new IllegalArgumentException("RLE truncado");
                }
                int b = data[p++] & 0xff;
                run |= (long) (b & 0x7f) << shift;
                if (b < 0x80) {
                    break;
                }
                shift += 7;
                if (shift > 35) {
                    throw new IllegalArgumentException("Corrida inválida");
                }
            }
            if (p + 4 > data.length) {
                throw new IllegalArgumentException("RLE truncado");
            }
            int r = data[p] & 0xff;
            int g = data[p + 1] & 0xff;
            int b = data[p + 2] & 0xff;
            int a = data[p + 3] & 0xff;
            p += 4;
            if (i + run > total) {
                throw new IllegalArgumentException("RLE maior que a matriz");
            }
            Arrays.fill(pixels, i, (int) (i + run), Color.argb(r, g, b, a));
            i += (int) run;
        }
        if (i != total) {
            throw new IllegalArgumentException("RLE menor que a matriz");
        }
        return pixels;
    }

    public static byte[] encode(int[] pixels) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int i = 0;
        while (i < pixels.length) {
            int color = pixels[i];
            int j = i + 1;
            while (j < pixels.length && pixels[j] == color) {
                j++;
            }
            int run = j - i;
            while (run >= 0x80) {
                out.write((run & 0x7f) | 0x80);
                run >>>= 7;
            }
            out.write(run);
            out.write((color >>> 16) & 0xff);
            out.write((color >>> 8) & 0xff);
            out.write(color & 0xff);
            out.write((color >>> 24) & 0xff);
            i = j;
        }
        return out.toByteArray();
    }
}
