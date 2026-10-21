package io.github.ravelroot.crivo;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.imageio.ImageIO;

public final class Crivo {

    private static final String USO = """
            Crivo · ferramenta de linha de comando em Java

            Uso:
              crivo info    <projeto.crivo>
              crivo paleta  <projeto.crivo>
              crivo png     <projeto.crivo> <saida.png> [--quadro N] [--escala N]
              crivo folha   <projeto.crivo> <saida.png> [--disposicao horizontal|vertical|grade] [--colunas N] [--espaco N] [--escala N]
              crivo matriz  <projeto.crivo> [--quadro N|todos] [--modo indices|argb] [--classe Nome]
              crivo verificar <projeto.crivo>
            """;

    private Crivo() {
    }

    public static void main(String[] args) {
        if (args.length < 2) {
            System.out.print(USO);
            System.exit(args.length == 0 ? 0 : 2);
        }
        try {
            String comando = args[0];
            Projeto projeto = Projeto.abrir(Path.of(args[1]));
            Map<String, String> opcoes = opcoes(args, comando.equals("png") || comando.equals("folha") ? 3 : 2);
            switch (comando) {
                case "info" -> info(projeto);
                case "paleta" -> paleta(projeto);
                case "png" -> png(projeto, Path.of(exigir(args, 2, "arquivo de saída")), opcoes);
                case "folha" -> folha(projeto, Path.of(exigir(args, 2, "arquivo de saída")), opcoes);
                case "matriz" -> System.out.print(matriz(projeto, opcoes));
                case "verificar" -> System.out.println("ok: " + projeto.nome + " é um projeto válido.");
                default -> {
                    System.err.println("Comando desconhecido: " + comando);
                    System.err.print(USO);
                    System.exit(2);
                }
            }
        } catch (IOException | IllegalArgumentException e) {
            System.err.println("erro: " + e.getMessage());
            System.exit(1);
        }
    }

    private static String exigir(String[] args, int i, String nome) {
        if (args.length <= i || args[i].startsWith("--")) {
            throw new IllegalArgumentException("Informe o " + nome + ".");
        }
        return args[i];
    }

    private static Map<String, String> opcoes(String[] args, int inicio) {
        Map<String, String> mapa = new HashMap<>();
        for (int i = inicio; i < args.length; i++) {
            if (!args[i].startsWith("--")) {
                throw new IllegalArgumentException("Argumento inesperado: " + args[i]);
            }
            if (i + 1 >= args.length) {
                throw new IllegalArgumentException("Falta o valor de " + args[i]);
            }
            mapa.put(args[i].substring(2), args[++i]);
        }
        return mapa;
    }

    private static int numero(Map<String, String> opcoes, String chave, int padrao, int min, int max) {
        String v = opcoes.get(chave);
        if (v == null) {
            return padrao;
        }
        int n = Integer.parseInt(v);
        if (n < min || n > max) {
            throw new IllegalArgumentException("--" + chave + " precisa ficar entre " + min + " e " + max);
        }
        return n;
    }

    private static void info(Projeto p) {
        System.out.printf(Locale.ROOT, "Nome:     %s%n", p.nome);
        System.out.printf(Locale.ROOT, "Matriz:   %d x %d pixels%n", p.largura, p.altura);
        System.out.printf(Locale.ROOT, "Quadros:  %d (%d fps)%n", p.quadros.size(), p.fps);
        System.out.printf(Locale.ROOT, "Camadas:  %d%n", p.camadas.size());
        for (int i = p.camadas.size() - 1; i >= 0; i--) {
            Projeto.Camada c = p.camadas.get(i);
            System.out.printf(Locale.ROOT, "  - %s%s%s%n", c.nome(), c.visivel() ? "" : " (oculta)", c.opacidade() < 100 ? " " + c.opacidade() + "%" : "");
        }
        System.out.printf(Locale.ROOT, "Cores:    %d%n", p.cores().size());
    }

    private static void paleta(Projeto p) {
        p.cores().entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .forEach(e -> System.out.printf(Locale.ROOT, "%s  %d px%n", Cor.hex(e.getKey()), e.getValue()));
    }

    private static BufferedImage imagem(int[] argb, int largura, int altura, int escala) {
        BufferedImage img = new BufferedImage(largura * escala, altura * escala, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < altura; y++) {
            for (int x = 0; x < largura; x++) {
                int c = argb[y * largura + x];
                for (int dy = 0; dy < escala; dy++) {
                    for (int dx = 0; dx < escala; dx++) {
                        img.setRGB(x * escala + dx, y * escala + dy, c);
                    }
                }
            }
        }
        return img;
    }

    private static void gravar(BufferedImage img, Path saida) throws IOException {
        Path pasta = saida.toAbsolutePath().getParent();
        if (pasta != null) {
            Files.createDirectories(pasta);
        }
        ImageIO.write(img, "png", saida.toFile());
        System.out.printf(Locale.ROOT, "%s (%d x %d)%n", saida, img.getWidth(), img.getHeight());
    }

    private static void png(Projeto p, Path saida, Map<String, String> o) throws IOException {
        int quadro = numero(o, "quadro", 1, 1, p.quadros.size()) - 1;
        int escala = numero(o, "escala", 1, 1, 64);
        gravar(imagem(p.compor(quadro), p.largura, p.altura, escala), saida);
    }

    private static void folha(Projeto p, Path saida, Map<String, String> o) throws IOException {
        int escala = numero(o, "escala", 1, 1, 32);
        int espaco = numero(o, "espaco", 0, 0, 64);
        String disposicao = o.getOrDefault("disposicao", "horizontal");
        int n = p.quadros.size();
        int colunas = switch (disposicao) {
            case "horizontal" -> n;
            case "vertical" -> 1;
            case "grade" -> Math.min(n, numero(o, "colunas", (int) Math.ceil(Math.sqrt(n)), 1, 256));
            default -> throw new IllegalArgumentException("Disposição inválida: " + disposicao);
        };
        int linhas = (n + colunas - 1) / colunas;
        int ql = p.largura * escala;
        int qa = p.altura * escala;
        BufferedImage folha = new BufferedImage(colunas * ql + (colunas - 1) * espaco, linhas * qa + (linhas - 1) * espaco, BufferedImage.TYPE_INT_ARGB);
        var g = folha.createGraphics();
        for (int i = 0; i < n; i++) {
            g.drawImage(imagem(p.compor(i), p.largura, p.altura, escala), (i % colunas) * (ql + espaco), (i / colunas) * (qa + espaco), null);
        }
        g.dispose();
        gravar(folha, saida);
    }

    static String identificador(String nome) {
        String base = Normalizer.normalize(nome, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        StringBuilder sb = new StringBuilder();
        for (String parte : base.split("[^A-Za-z0-9]+")) {
            if (!parte.isEmpty()) {
                sb.append(Character.toUpperCase(parte.charAt(0))).append(parte.substring(1).toLowerCase(Locale.ROOT));
            }
        }
        if (sb.isEmpty() || Character.isDigit(sb.charAt(0))) {
            sb.insert(0, "Sprite");
        }
        return sb.toString();
    }

    static String matriz(Projeto p, Map<String, String> o) {
        String classe = o.getOrDefault("classe", identificador(p.nome));
        String modo = o.getOrDefault("modo", "indices");
        if (!modo.equals("indices") && !modo.equals("argb")) {
            throw new IllegalArgumentException("--modo precisa ser indices ou argb");
        }
        List<Integer> indices = new ArrayList<>();
        String q = o.getOrDefault("quadro", "todos");
        if (q.equals("todos")) {
            for (int i = 0; i < p.quadros.size(); i++) {
                indices.add(i);
            }
        } else {
            indices.add(numero(o, "quadro", 1, 1, p.quadros.size()) - 1);
        }
        Map<Integer, Integer> ordem = new HashMap<>();
        List<Integer> paleta = new ArrayList<>();
        StringBuilder corpo = new StringBuilder();
        for (int k = 0; k < indices.size(); k++) {
            int[] px = p.compor(indices.get(k));
            corpo.append("        {\n");
            for (int y = 0; y < p.altura; y++) {
                corpo.append("            {");
                for (int x = 0; x < p.largura; x++) {
                    int c = px[y * p.largura + x];
                    String v;
                    if (modo.equals("argb")) {
                        v = String.format("0x%08X", c);
                    } else if ((c >>> 24) == 0) {
                        v = "-1";
                    } else {
                        Integer idx = ordem.get(c);
                        if (idx == null) {
                            idx = paleta.size();
                            ordem.put(c, idx);
                            paleta.add(c);
                        }
                        v = String.valueOf(idx);
                    }
                    corpo.append(x == 0 ? "" : ", ").append(v);
                }
                corpo.append(y == p.altura - 1 ? "}\n" : "},\n");
            }
            corpo.append(k == indices.size() - 1 ? "        }\n" : "        },\n");
        }
        StringBuilder sb = new StringBuilder();
        sb.append("public final class ").append(classe).append(" {\n\n");
        sb.append("    public static final int LARGURA = ").append(p.largura).append(";\n");
        sb.append("    public static final int ALTURA = ").append(p.altura).append(";\n");
        if (modo.equals("indices")) {
            sb.append("    public static final int TRANSPARENTE = -1;\n\n");
            sb.append("    public static final int[] PALETA = {");
            for (int i = 0; i < paleta.size(); i++) {
                sb.append(i == 0 ? "" : ", ").append(String.format("0x%08X", paleta.get(i)));
            }
            sb.append("};\n");
        }
        sb.append("\n    public static final int[][][] QUADROS = {\n").append(corpo).append("    };\n\n");
        sb.append("    private ").append(classe).append("() {\n    }\n}\n");
        return sb.toString();
    }
}
