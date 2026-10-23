package io.github.ravelroot.crivo;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.function.Supplier;
import javax.imageio.ImageIO;

public final class Testes {

    private static int falhas;
    private static int total;

    private Testes() {
    }

    private static void verificar(String nome, Supplier<Boolean> teste) {
        total++;
        try {
            if (teste.get()) {
                System.out.println("ok      " + nome);
                return;
            }
            System.out.println("FALHOU  " + nome);
        } catch (RuntimeException e) {
            System.out.println("ERRO    " + nome + ": " + e);
        }
        falhas++;
    }

    public static void main(String[] args) throws Exception {
        Path exemplos = Path.of(args.length > 0 ? args[0] : "../../exemplos");
        int vermelho = Cor.argb(255, 0, 0, 255);
        verificar("RLE ida e volta", () -> {
            int[] px = new int[500];
            java.util.Arrays.fill(px, 100, 450, vermelho);
            return java.util.Arrays.equals(Rle.decodificar(Rle.codificar(px), 500), px);
        });
        verificar("RLE igual ao JavaScript", () -> java.util.Arrays.equals(Rle.codificar(new int[] {vermelho, vermelho, vermelho}), new byte[] {3, (byte) 255, 0, 0, (byte) 255}));
        verificar("RLE rejeita tamanho errado", () -> {
            try {
                Rle.decodificar(Rle.codificar(new int[] {vermelho}), 2);
                return false;
            } catch (IllegalArgumentException e) {
                return true;
            }
        });
        verificar("JSON com texto, números e listas", () -> {
            Object o = Json.ler("{\"a\": [1, 2.5, \"x\\u00e7\"], \"b\": null, \"c\": true}");
            return o instanceof Map<?, ?> m && m.get("c").equals(Boolean.TRUE) && m.get("b") == null;
        });
        verificar("Sobreposição com opacidade", () -> Cor.sobrepor(Cor.argb(0, 0, 255, 255), vermelho, 1) == vermelho);
        verificar("Identificador Java", () -> Crivo.identificador("Poção de vida!").equals("PocaoDeVida"));
        Projeto coracao = Projeto.abrir(exemplos.resolve("coracao.crivo"));
        verificar("Abre o exemplo do coração", () -> coracao.largura == 16 && coracao.quadros.size() == 4 && coracao.camadas.size() == 2);
        verificar("Compõe as camadas", () -> {
            int[] px = coracao.compor(0);
            return Cor.hex(px[3 * 16]).equals("#2b1d17") && (px[0] >>> 24) == 0;
        });
        verificar("Gera classe Java com a matriz", () -> {
            String fonte = Crivo.matriz(coracao, Map.of("quadro", "1"));
            return fonte.contains("public final class Coracao") && fonte.contains("TRANSPARENTE = -1") && fonte.contains("int[][][] QUADROS");
        });
        Path temp = Files.createTempDirectory("crivo");
        Crivo.main(new String[] {"png", exemplos.resolve("pocao.crivo").toString(), temp.resolve("pocao.png").toString(), "--escala", "4"});
        verificar("Exporta PNG ampliado", () -> {
            try {
                var img = ImageIO.read(temp.resolve("pocao.png").toFile());
                return img.getWidth() == 64 && img.getHeight() == 64;
            } catch (java.io.IOException e) {
                throw new RuntimeException(e);
            }
        });
        verificar("Matriz grande vira classe compacta que compila e guarda os valores", () -> {
            try {
                int largura = 120;
                int altura = 90;
                int[] valores = new int[2 * largura * altura];
                for (int i = 0; i < valores.length; i++) {
                    valores[i] = i % 7 == 0 ? -1 : i % 300;
                }
                int[] paleta = new int[300];
                for (int i = 0; i < paleta.length; i++) {
                    paleta[i] = 0xFF000000 | (i * 4099);
                }
                String fonte = Crivo.classeJava("SpriteGrande", largura, altura, 2, valores, paleta);
                Path pasta = Files.createTempDirectory("crivo-java");
                Files.writeString(pasta.resolve("SpriteGrande.java"), fonte);
                var compilador = javax.tools.ToolProvider.getSystemJavaCompiler();
                if (compilador.run(null, null, null, "-encoding", "UTF-8", "-d", pasta.toString(), pasta.resolve("SpriteGrande.java").toString()) != 0) {
                    return false;
                }
                try (var carregador = new java.net.URLClassLoader(new java.net.URL[] {pasta.toUri().toURL()})) {
                    Class<?> c = carregador.loadClass("SpriteGrande");
                    int[][][] q = (int[][][]) c.getField("QUADROS").get(null);
                    int[] p = (int[]) c.getField("PALETA").get(null);
                    return fonte.contains("DADOS") && q[1][89][119] == valores[valores.length - 1] && q[0][0][0] == -1 && q[0][0][1] == 1 && p[299] == paleta[299];
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        System.out.printf("%n%d de %d testes passaram.%n", total - falhas, total);
        System.exit(falhas == 0 ? 0 : 1);
    }
}
