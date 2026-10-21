package io.github.ravelroot.crivo;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

public final class Rle {

    private Rle() {
    }

    public static int[] decodificar(byte[] dados, int total) {
        int[] pixels = new int[total];
        int p = 0;
        int i = 0;
        while (p < dados.length) {
            long corrida = 0;
            int deslocamento = 0;
            while (true) {
                if (p >= dados.length) {
                    throw new IllegalArgumentException("RLE truncado");
                }
                int b = dados[p++] & 0xff;
                corrida |= (long) (b & 0x7f) << deslocamento;
                if (b < 0x80) {
                    break;
                }
                deslocamento += 7;
                if (deslocamento > 35) {
                    throw new IllegalArgumentException("Corrida inválida");
                }
            }
            if (p + 4 > dados.length) {
                throw new IllegalArgumentException("RLE truncado");
            }
            int r = dados[p] & 0xff;
            int g = dados[p + 1] & 0xff;
            int b = dados[p + 2] & 0xff;
            int a = dados[p + 3] & 0xff;
            p += 4;
            if (i + corrida > total) {
                throw new IllegalArgumentException("RLE maior que a matriz");
            }
            Arrays.fill(pixels, i, (int) (i + corrida), Cor.argb(r, g, b, a));
            i += (int) corrida;
        }
        if (i != total) {
            throw new IllegalArgumentException("RLE menor que a matriz");
        }
        return pixels;
    }

    public static byte[] codificar(int[] pixels) {
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        int i = 0;
        while (i < pixels.length) {
            int cor = pixels[i];
            int j = i + 1;
            while (j < pixels.length && pixels[j] == cor) {
                j++;
            }
            int corrida = j - i;
            while (corrida >= 0x80) {
                saida.write((corrida & 0x7f) | 0x80);
                corrida >>>= 7;
            }
            saida.write(corrida);
            saida.write((cor >>> 16) & 0xff);
            saida.write((cor >>> 8) & 0xff);
            saida.write(cor & 0xff);
            saida.write((cor >>> 24) & 0xff);
            i = j;
        }
        return saida.toByteArray();
    }
}
