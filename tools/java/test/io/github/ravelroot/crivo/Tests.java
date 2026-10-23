package io.github.ravelroot.crivo;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import javax.imageio.ImageIO;

public final class Tests {

    private static int failures;
    private static int total;

    private Tests() {
    }

    private static void check(String name, Supplier<Boolean> test) {
        total++;
        try {
            if (test.get()) {
                System.out.println("ok      " + name);
                return;
            }
            System.out.println("FAILED  " + name);
        } catch (RuntimeException e) {
            System.out.println("ERROR   " + name + ": " + e);
        }
        failures++;
    }

    /** Runs the command line and returns what it printed. Only for calls that succeed (errors call System.exit). */
    private static String run(String... args) {
        PrintStream original = System.out;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        System.setOut(new PrintStream(buffer, true, StandardCharsets.UTF_8));
        try {
            Crivo.main(args);
        } finally {
            System.setOut(original);
        }
        return buffer.toString(StandardCharsets.UTF_8);
    }

    private static BufferedImage readPng(Path file) {
        try {
            return ImageIO.read(file.toFile());
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static boolean samePixels(BufferedImage a, BufferedImage b) {
        if (a.getWidth() != b.getWidth() || a.getHeight() != b.getHeight()) {
            return false;
        }
        int w = a.getWidth();
        int h = a.getHeight();
        return Arrays.equals(a.getRGB(0, 0, w, h, null, 0, w), b.getRGB(0, 0, w, h, null, 0, w));
    }

    private static String errorMessage(Runnable action) {
        try {
            action.run();
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    private static Path write(Path dir, String fileName, String content) {
        try {
            return Files.writeString(dir.resolve(fileName), content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static Project open(Path file) {
        try {
            return Project.open(file);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public static void main(String[] args) throws Exception {
        Path examples = Path.of(args.length > 0 ? args[0] : "../../examples");
        int red = Color.argb(255, 0, 0, 255);
        check("RLE round trip", () -> {
            int[] px = new int[500];
            Arrays.fill(px, 100, 450, red);
            return Arrays.equals(Rle.decode(Rle.encode(px), 500), px);
        });
        check("RLE matches the JavaScript encoder", () -> Arrays.equals(Rle.encode(new int[] {red, red, red}), new byte[] {3, (byte) 255, 0, 0, (byte) 255}));
        check("RLE rejects the wrong size", () -> {
            try {
                Rle.decode(Rle.encode(new int[] {red}), 2);
                return false;
            } catch (IllegalArgumentException e) {
                return true;
            }
        });
        check("JSON with strings, numbers and lists", () -> {
            Object o = Json.parse("{\"a\": [1, 2.5, \"x\\u00e7\"], \"b\": null, \"c\": true}");
            return o instanceof Map<?, ?> m && m.get("c").equals(Boolean.TRUE) && m.get("b") == null;
        });
        check("Blending with opacity", () -> Color.blend(Color.argb(0, 0, 255, 255), red, 1) == red);
        check("Java identifier", () -> Crivo.identifier("Poção de vida!").equals("PocaoDeVida"));
        Project heart = Project.open(examples.resolve("heart.crivo"));
        check("Opens the heart example", () -> heart.width == 16 && heart.frames.size() == 4 && heart.layers.size() == 2);
        check("Composes the layers", () -> {
            int[] px = heart.compose(0);
            return Color.hex(px[3 * 16]).equals("#2b1d17") && (px[0] >>> 24) == 0;
        });
        check("Generates a Java class with the matrix", () -> {
            String source = Crivo.matrix(heart, Crivo.Options.of("frame", "1"));
            return source.contains("public final class Coracao") && source.contains("WIDTH = 16") && source.contains("TRANSPARENT = -1")
                    && source.contains("int[] PALETTE = {") && source.contains("int[][][] FRAMES");
        });
        Path temp = Files.createTempDirectory("crivo");
        Crivo.main(new String[] {"png", examples.resolve("potion.crivo").toString(), temp.resolve("potion.png").toString(), "--scale", "4"});
        check("Exports an enlarged PNG", () -> {
            var img = readPng(temp.resolve("potion.png"));
            return img.getWidth() == 64 && img.getHeight() == 64;
        });
        check("Large matrix becomes a compact class that compiles and keeps the values", () -> {
            try {
                int width = 120;
                int height = 90;
                int[] values = new int[2 * width * height];
                for (int i = 0; i < values.length; i++) {
                    values[i] = i % 7 == 0 ? -1 : i % 300;
                }
                int[] palette = new int[300];
                for (int i = 0; i < palette.length; i++) {
                    palette[i] = 0xFF000000 | (i * 4099);
                }
                String source = Crivo.javaClass("LargeSprite", width, height, 2, values, palette);
                Path dir = Files.createTempDirectory("crivo-java");
                Files.writeString(dir.resolve("LargeSprite.java"), source);
                var compiler = javax.tools.ToolProvider.getSystemJavaCompiler();
                if (compiler.run(null, null, null, "-encoding", "UTF-8", "-d", dir.toString(), dir.resolve("LargeSprite.java").toString()) != 0) {
                    return false;
                }
                try (var loader = new java.net.URLClassLoader(new java.net.URL[] {dir.toUri().toURL()})) {
                    Class<?> c = loader.loadClass("LargeSprite");
                    int[][][] f = (int[][][]) c.getField("FRAMES").get(null);
                    int[] p = (int[]) c.getField("PALETTE").get(null);
                    return source.contains("String[] DATA") && source.contains("String[] PALETTE_DATA")
                            && f[1][89][119] == values[values.length - 1] && f[0][0][0] == -1 && f[0][0][1] == 1 && p[299] == palette[299];
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        // Format v2 and files from Crivo 1.x (format v1, Portuguese keys).
        check("Every example is in format v2 and opens", () -> {
            for (String name : List.of("heart.crivo", "game-boy-slime.crivo", "potion.crivo")) {
                try {
                    String text = Files.readString(examples.resolve(name), StandardCharsets.UTF_8);
                    if (!text.contains("\"version\":2") || text.contains("\"formato\"") || open(examples.resolve(name)).frames.isEmpty()) {
                        return false;
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
            return true;
        });
        String rle = Base64.getEncoder().encodeToString(Rle.encode(new int[] {red, 0, 0, red}));
        String half = Base64.getEncoder().encodeToString(Rle.encode(new int[] {0, 0xFF0000FF, 0xFF0000FF, 0}));
        String v1 = """
                {"formato":"crivo","versao":1,"nome":"Teste v1","largura":2,"altura":2,"fps":5,"paleta":["#ff0000","#0000ff"],
                 "camadas":[{"id":"c1","nome":"Camada 1","visivel":true,"opacidade":100,"bloqueada":false},
                            {"id":"c2","nome":"Azul","visivel":true,"opacidade":50,"bloqueada":true},
                            {"id":"c3","nome":"Oculta","visivel":false,"opacidade":100,"bloqueada":false}],
                 "quadros":[{"id":"q1","duracao":120},{"id":"q2","duracao":null}],
                 "celulas":[{"quadro":"q1","camada":"c1","rle":"%1$s"},{"quadro":"q1","camada":"c2","rle":"%2$s"},
                            {"quadro":"q2","camada":"c3","rle":"%1$s"}]}
                """.formatted(rle, half);
        String v2 = """
                {"format":"crivo","version":2,"name":"Teste v1","width":2,"height":2,"fps":5,"palette":["#ff0000","#0000ff"],
                 "layers":[{"id":"c1","name":"Camada 1","visible":true,"opacity":100,"locked":false},
                           {"id":"c2","name":"Azul","visible":true,"opacity":50,"locked":true},
                           {"id":"c3","name":"Oculta","visible":false,"opacity":100,"locked":false}],
                 "frames":[{"id":"q1","duration":120},{"id":"q2","duration":null}],
                 "cells":[{"frame":"q1","layer":"c1","rle":"%1$s"},{"frame":"q1","layer":"c2","rle":"%2$s"},
                          {"frame":"q2","layer":"c3","rle":"%1$s"}]}
                """.formatted(rle, half);
        Path v1File = write(temp, "v1.crivo", v1);
        Path v2File = write(temp, "v2.crivo", v2);
        check("Still opens a format v1 file", () -> {
            Project p = open(v1File);
            int[] first = p.compose(0);
            return p.name.equals("Teste v1") && p.width == 2 && p.height == 2 && p.fps == 5
                    && p.layers.size() == 3 && p.layers.get(1).opacity() == 50 && !p.layers.get(2).visible()
                    && p.frames.get(0).duration() == 120 && p.frames.get(1).duration() == null
                    && first[0] == red && (first[1] >>> 24) == 128 && Arrays.stream(p.compose(1)).allMatch(c -> c == 0);
        });
        check("A v1 file and its v2 conversion give the same pixels", () -> {
            Project a = open(v1File);
            Project b = open(v2File);
            for (int f = 0; f < a.frames.size(); f++) {
                if (!Arrays.equals(a.compose(f), b.compose(f))) {
                    return false;
                }
            }
            return a.frames.equals(b.frames) && a.layers.equals(b.layers) && a.colors().equals(b.colors())
                    && run("info", v1File.toString()).equals(run("info", v2File.toString()));
        });
        check("Converts v1 keys to v2", () -> {
            @SuppressWarnings("unchecked")
            Map<String, Object> converted = Project.upgrade((Map<String, Object>) Json.parse(v1));
            @SuppressWarnings("unchecked")
            Map<String, Object> layer = (Map<String, Object>) ((List<Object>) converted.get("layers")).get(1);
            @SuppressWarnings("unchecked")
            Map<String, Object> cell = (Map<String, Object>) ((List<Object>) converted.get("cells")).get(0);
            return converted.get("format").equals("crivo") && converted.get("version").equals(2L) && converted.get("name").equals("Teste v1")
                    && converted.containsKey("palette") && !converted.containsKey("nome")
                    && layer.equals(Map.of("id", "c2", "name", "Azul", "visible", true, "opacity", 50L, "locked", true))
                    && cell.keySet().equals(java.util.Set.of("frame", "layer", "rle"));
        });
        check("Rejects a file saved by a newer Crivo", () -> {
            Path newer = write(temp, "newer.crivo", v2.replace("\"version\":2", "\"version\":3"));
            String message = errorMessage(() -> open(newer));
            return message != null && message.contains("versão mais nova");
        });
        check("Rejects a file that is not a Crivo project", () -> {
            Path other = write(temp, "other.crivo", "{\"format\":\"outro\",\"version\":2}");
            return "Este arquivo não é um projeto do Crivo.".equals(errorMessage(() -> open(other)));
        });

        // Command line: English commands and options, and the Portuguese ones from 1.x as aliases.
        String potion = examples.resolve("potion.crivo").toString();
        String heartFile = examples.resolve("heart.crivo").toString();
        check("English sheet options", () -> {
            run("sheet", potion, temp.resolve("sheet.png").toString(), "--layout", "grid", "--columns", "2", "--spacing", "1", "--scale", "2");
            var img = readPng(temp.resolve("sheet.png"));
            return img.getWidth() == 65 && img.getHeight() == 65;
        });
        check("Portuguese sheet command and options still work", () -> {
            run("folha", potion, temp.resolve("folha.png").toString(), "--disposicao", "grade", "--colunas", "2", "--espaco", "1", "--escala", "2");
            return samePixels(readPng(temp.resolve("folha.png")), readPng(temp.resolve("sheet.png")));
        });
        check("Horizontal sheet with --scale and --spacing", () -> {
            run("sheet", potion, temp.resolve("row.png").toString(), "--scale", "4", "--spacing", "2");
            run("folha", potion, temp.resolve("linha.png").toString(), "--escala", "4", "--espaco", "2");
            var img = readPng(temp.resolve("row.png"));
            return img.getWidth() == 4 * 64 + 3 * 2 && img.getHeight() == 64 && samePixels(img, readPng(temp.resolve("linha.png")));
        });
        check("png with --frame and --quadro", () -> {
            run("png", potion, temp.resolve("frame.png").toString(), "--frame", "2", "--scale", "3");
            run("png", potion, temp.resolve("quadro.png").toString(), "--quadro", "2", "--escala", "3");
            var img = readPng(temp.resolve("frame.png"));
            return img.getWidth() == 48 && samePixels(img, readPng(temp.resolve("quadro.png")))
                    && !samePixels(img, readPng(temp.resolve("potion.png")));
        });
        check("matrix and matriz print the same class", () -> {
            String english = run("matrix", heartFile, "--frame", "all", "--mode", "argb", "--class", "HeartSprite");
            String portuguese = run("matriz", heartFile, "--quadro", "todos", "--modo", "argb", "--classe", "HeartSprite");
            return english.equals(portuguese) && english.contains("public final class HeartSprite") && !english.contains("PALETTE")
                    && run("matrix", heartFile, "--frame", "3").equals(run("matriz", heartFile, "--quadro", "3"));
        });
        check("palette, check and their Portuguese aliases", () -> {
            String palette = run("palette", heartFile);
            String valid = run("check", heartFile);
            return !palette.isEmpty() && palette.equals(run("paleta", heartFile))
                    && valid.equals("ok: Coração é um projeto válido." + System.lineSeparator()) && valid.equals(run("verificar", heartFile));
        });
        check("Error messages name the option the way it was typed", () -> {
            String mode = errorMessage(() -> Crivo.matrix(heart, Crivo.Options.of("mode", "rgb")));
            String modo = errorMessage(() -> Crivo.matrix(heart, Crivo.Options.of("modo", "rgb")));
            String frame = errorMessage(() -> Crivo.matrix(heart, Crivo.Options.of("frame", "9")));
            String quadro = errorMessage(() -> Crivo.matrix(heart, Crivo.Options.of("quadro", "9")));
            return "--mode precisa ser indices ou argb".equals(mode) && "--modo precisa ser indices ou argb".equals(modo)
                    && "--frame precisa ficar entre 1 e 4".equals(frame) && "--quadro precisa ficar entre 1 e 4".equals(quadro);
        });
        check("The command line opens a v1 file", () -> run("info", v1File.toString()).startsWith("Nome:     Teste v1"));

        System.out.printf("%n%d of %d tests passed.%n", total - failures, total);
        System.exit(failures == 0 ? 0 : 1);
    }
}
