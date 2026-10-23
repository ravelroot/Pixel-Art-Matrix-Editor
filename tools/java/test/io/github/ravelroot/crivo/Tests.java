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

    /** An ARGB pixel as '#rrggbbaa'. */
    private static String rgbaHex(int argb) {
        return String.format("#%02x%02x%02x%02x", (argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff, argb >>> 24);
    }

    /** '#rrggbbaa' as an ARGB pixel. */
    private static int argbOf(String text) {
        int v = (int) Long.parseLong(text.substring(1), 16);
        return (v >>> 8) | (v << 24);
    }

    /** The 2.0 rendering (normal layers only), to check that the 2.1 rendering keeps it bit for bit. */
    private static int[] compose20(Project p, int frame, Map<String, int[]> cells) {
        int[] target = new int[p.width * p.height];
        for (Project.Layer l : p.layers) {
            int[] source = cells.get(p.frames.get(frame).id() + ":" + l.id());
            if (!l.visible() || source == null || l.opacity() <= 0) {
                continue;
            }
            double opacity = l.opacity() / 100.0;
            for (int i = 0; i < source.length; i++) {
                int a = source[i] >>> 24;
                if (a != 0) {
                    target[i] = (a == 255 && opacity >= 1) ? source[i] : Color.blend(target[i], source[i], opacity);
                }
            }
        }
        return target;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, int[]> cellsOf(Path file) throws IOException {
        Map<String, Object> data = (Map<String, Object>) Json.parse(Files.readString(file, StandardCharsets.UTF_8));
        int total = ((Number) data.get("width")).intValue() * ((Number) data.get("height")).intValue();
        Map<String, int[]> cells = new java.util.HashMap<>();
        for (Object o : (List<Object>) data.get("cells")) {
            Map<String, Object> c = (Map<String, Object>) o;
            cells.put(c.get("frame") + ":" + c.get("layer"), Rle.decode(Base64.getDecoder().decode((String) c.get("rle")), total));
        }
        return cells;
    }

    // Same expected values as editor/tests/test_features_2_1.py (cross-language parity of the blend modes).
    private static final String[][] EXAMPLE_PIXELS = {
        {"0", "15", "0", "#1d2b53ff"}, {"0", "0", "0", "#113056ff"}, {"0", "8", "8", "#ffe8b4ff"}, {"0", "8", "4", "#ac5653ff"},
        {"0", "4", "13", "#00522fff"}, {"0", "13", "10", "#00af6aff"}, {"0", "8", "10", "#eff289ff"}, {"1", "8", "10", "#7cc16aff"},
        {"1", "8", "5", "#f2db6bff"},
    };
    private static final String[][] BLEND_TABLE = {
        {"#2878c8b4", "#dc3c8cc8", "0.7",
            "#9a52a2dd #474495dd #9c7bcadd #5650bfdd #4a52a2dd #9a6dbddd #aa7dd5dd #3a37a9dd #8f50bfdd #5d5ebedd "
            + "#88527edd #8d6e99dd #954d9ddd #4a6dbddd #954d9ddd #4f72c2dd #aa88d5dd #38527edd #4ca9d5dd"},
        {"#00ff80ff", "#ff0040ff", "1.0",
            "#ff0040ff #000020ff #ffffa0ff #00ff41ff #000040ff #ffff80ff #00ffabff #00ff00ff #ff0040ff #00ff60ff "
            + "#ffff40ff #ffff80ff #ff789aff #00ff80ff #ff789aff #008141ff #ffffc0ff #00ff40ff #00ffffff"},
    };

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

        // Crivo 2.1: blend modes, groups, reference layers, linked cels, tags, slices and tilesets.
        check("Every blend mode matches the server table", () -> {
            for (String[] row : BLEND_TABLE) {
                String[] expected = row[3].split(" ");
                for (int i = 0; i < Blend.MODES.size(); i++) {
                    String got = rgbaHex(Blend.blend(argbOf(row[0]), argbOf(row[1]), Double.parseDouble(row[2]), Blend.MODES.get(i)));
                    if (!got.equals(expected[i])) {
                        System.out.println("  " + Blend.MODES.get(i) + ": " + got + " != " + expected[i]);
                        return false;
                    }
                }
            }
            return Blend.MODES.size() == 19 && argbOf("#11223344") == 0x44112233;
        });
        check("Blending over nothing and with a transparent source", () -> Blend.blend(0, 0, 1, "multiply") == 0
                && Blend.blend(argbOf("#336699ff"), argbOf("#ffffff00"), 1, "screen") == argbOf("#336699ff")
                && Blend.blend(0, argbOf("#336699ff"), 0.5, "difference") == argbOf("#33669980"));
        Path blendFile = examples.resolve("blend-modes.crivo");
        Project blend = Project.open(blendFile);
        check("Renders the blend-modes example like the server", () -> {
            for (String[] px : EXAMPLE_PIXELS) {
                int[] frame = blend.compose(Integer.parseInt(px[0]));
                String got = rgbaHex(frame[Integer.parseInt(px[2]) * 16 + Integer.parseInt(px[1])]);
                if (!got.equals(px[3])) {
                    System.out.println("  frame " + px[0] + " (" + px[1] + ", " + px[2] + "): " + got + " != " + px[3]);
                    return false;
                }
            }
            return true;
        });
        String blendText = Files.readString(blendFile, StandardCharsets.UTF_8);
        String groupKey = "\"opacity\":90,\"locked\":false,\"blendMode\":\"screen\",\"kind\":\"group\"";
        check("Group opacity, visibility and blend mode apply to the composited children", () -> {
            Project halfGroup = open(write(temp, "half.crivo", blendText.replace(groupKey, groupKey.replace("90", "50"))));
            Project normal = open(write(temp, "normal.crivo", blendText.replace(groupKey, groupKey.replace("90", "100").replace("screen", "normal"))));
            Project hidden = open(write(temp, "hidden.crivo", blendText.replace("\"visible\":true,\"opacity\":90", "\"visible\":false,\"opacity\":90")));
            return blendText.contains(groupKey) && rgbaHex(halfGroup.compose(0)[8 * 16 + 8]).equals("#ffb6afff")
                    && rgbaHex(normal.compose(0)[8 * 16 + 8]).equals("#ffec27ff")
                    && rgbaHex(hidden.compose(0)[8 * 16 + 8]).equals("#ff77a8ff") && rgbaHex(hidden.compose(0)[4 * 16 + 8]).equals("#7e2553ff");
        });
        check("Reference layers are shown only on request", () -> rgbaHex(blend.compose(0)[15]).equals("#1d2b53ff")
                && rgbaHex(blend.compose(0, true)[15]).equals("#ff004dff") && !blend.colors().containsKey(argbOf("#ff004dff")));
        check("Normal layers render bit for bit like 2.0", () -> {
            try {
                for (String name : List.of("heart.crivo", "game-boy-slime.crivo", "potion.crivo")) {
                    Project p = open(examples.resolve(name));
                    Map<String, int[]> cells = cellsOf(examples.resolve(name));
                    for (int f = 0; f < p.frames.size(); f++) {
                        if (!Arrays.equals(p.compose(f), compose20(p, f, cells))) {
                            return false;
                        }
                    }
                }
                return true;
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        });
        String full = """
                {"format":"crivo","version":2,"name":"Recursos","width":2,"height":2,"colorMode":"indexed",
                 "layers":[{"id":"l1","name":"Base"},{"id":"g1","name":"Grupo","kind":"group","collapsed":true,"blendMode":"multiply"},
                           {"id":"tm","name":"Mapa","kind":"tilemap","tileset":"ts1","parent":"g1"}],
                 "frames":[{"id":"f1"},{"id":"f2"},{"id":"f3"}],
                 "cells":[{"frame":"f1","layer":"l1","rle":"%1$s"},{"frame":"f2","layer":"l1","rle":"%1$s","link":"f1"}],
                 "tags":[{"id":"t1","name":"Andar","from":"f1","to":"f3","direction":"reverse","repeat":2,"color":"#ff0000"},
                         {"id":"t2","name":"Pulo","from":"f2","to":"f2"}],
                 "slices":[{"id":"s1","name":"Botão","color":"#0000ff","x":0,"y":0,"width":2,"height":1,"center":null,"pivot":{"x":1,"y":0}}],
                 "tilesets":[{"id":"ts1","name":"Chão","tileWidth":1,"tileHeight":1,"tiles":["%2$s","%2$s"]}]}
                """.formatted(rle, Base64.getEncoder().encodeToString(Rle.encode(new int[1])));
        Path fullFile = write(temp, "full.crivo", full);
        check("Reads the optional 2.1 keys", () -> {
            Project p = open(fullFile);
            Project.Layer map = p.layers.get(2);
            return p.colorMode.equals("indexed") && p.tags.size() == 2 && p.slices.size() == 1 && p.tilesets.size() == 1
                    && p.tilesets.get(0).tileCount() == 2 && p.tags.get(0).repeat() == 2 && p.tags.get(1).direction().equals("forward")
                    && p.links.equals(Map.of("f2:l1", "f1")) && map.parent().equals("g1") && map.kind().equals("tilemap")
                    && p.layers.get(1).group() && p.layers.get(1).blendMode().equals("multiply") && p.depth(map) == 1
                    && heart.colorMode == null && heart.tags.isEmpty() && heart.layers.get(0).blendMode().equals("normal");
        });
        check("tags lists the frame ranges and directions", () -> {
            String nl = System.lineSeparator();
            return run("tags", fullFile.toString()).equals("Tags: 2" + nl + "  - Andar: quadros 1 a 3, ao contrário, 2 vezes (#ff0000)" + nl
                    + "  - Pulo: quadro 2, para frente (#000000)" + nl)
                    && run("tags", blendFile.toString()).equals("Tags: 1" + nl + "  - Nascer do sol: quadros 1 a 2, pingue-pongue (#ffa300)" + nl)
                    && run("tags", heartFile).equals("Este projeto não tem tags." + nl);
        });
        check("info shows the 2.1 additions only when present", () -> {
            String nl = System.lineSeparator();
            String info = run("info", fullFile.toString());
            String example = run("info", blendFile.toString());
            return info.contains("Modo de cor: indexado" + nl) && info.contains("Tags:     2" + nl) && info.contains("Fatias:   1" + nl)
                    && info.contains("Conjuntos de tiles: 1" + nl) && info.contains("  - Grupo (grupo) [multiply]" + nl)
                    && info.contains("    - Mapa (tiles)" + nl) && example.contains("  - Esboço (referência)" + nl)
                    && example.contains("    - Halo 50% [addition]" + nl) && !example.contains("Modo de cor")
                    && !run("info", heartFile).contains("Tags") && run("info", heartFile).endsWith("Cores:    5" + nl);
        });
        check("Rejects unknown blend modes and tags pointing nowhere", () -> {
            Path badMode = write(temp, "bad-mode.crivo", full.replace("\"multiply\"", "\"glow\""));
            Path badTag = write(temp, "bad-tag.crivo", full.replace("\"to\":\"f3\"", "\"to\":\"f9\""));
            return "Modo de mesclagem inválido na camada 'Grupo': glow".equals(errorMessage(() -> open(badMode)))
                    && "A tag 'Andar' aponta para um quadro que não existe.".equals(errorMessage(() -> open(badTag)));
        });

        // tests/fixtures/blend-parity.json: documents written by the editor with its composite (the reference) as the
        // expected pixels; the server checks the same file (editor/tests/test_features_2_1.py).
        Path parityFile = examples.resolve("../tests/fixtures/blend-parity.json");
        check("Every pixel of the blend parity fixture matches the editor", () -> {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> fixture = (Map<String, Object>) Json.parse(Files.readString(parityFile, StandardCharsets.UTF_8));
                @SuppressWarnings("unchecked")
                List<Object> documents = (List<Object>) fixture.get("documents");
                for (int n = 0; n < documents.size(); n++) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> item = (Map<String, Object>) documents.get(n);
                    @SuppressWarnings("unchecked")
                    Project p = Project.of((Map<String, Object>) item.get("data"));
                    int[] px = p.compose(0);
                    List<?> expected = (List<?>) item.get("expected");
                    for (int i = 0; i < px.length; i++) {
                        if (!rgbaHex(px[i]).equals(expected.get(i))) {
                            System.out.println("  document " + (n + 1) + ", pixel " + i + ": " + rgbaHex(px[i]) + " != " + expected.get(i));
                            return false;
                        }
                    }
                }
                return documents.size() >= 30;
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        });

        System.out.printf("%n%d of %d tests passed.%n", total - failures, total);
        System.exit(failures == 0 ? 0 : 1);
    }
}
