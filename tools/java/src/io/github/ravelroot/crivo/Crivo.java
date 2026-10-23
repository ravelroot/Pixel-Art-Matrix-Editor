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

    // Shown to the user, so it stays in Portuguese.
    private static final String USAGE = """
            Crivo · ferramenta de linha de comando em Java

            Uso:
              crivo info    <projeto.crivo>
              crivo palette <projeto.crivo>
              crivo png     <projeto.crivo> <saida.png> [--frame N] [--scale N]
              crivo sheet   <projeto.crivo> <saida.png> [--layout horizontal|vertical|grid] [--columns N] [--spacing N] [--scale N]
              crivo matrix  <projeto.crivo> [--frame N|all] [--mode indices|argb] [--class Nome]
              crivo check   <projeto.crivo>

            Os comandos e opções em português continuam aceitos: paleta, folha, matriz, verificar, --quadro,
            --escala, --disposicao (horizontal|vertical|grade), --colunas, --espaco, --modo, --classe e todos.
            """;

    /** Portuguese command names from Crivo 1.x, still accepted. */
    private static final Map<String, String> COMMAND_ALIASES = Map.of(
            "paleta", "palette",
            "folha", "sheet",
            "matriz", "matrix",
            "verificar", "check");

    /** Portuguese option names from Crivo 1.x, still accepted. */
    private static final Map<String, String> OPTION_ALIASES = Map.of(
            "quadro", "frame",
            "escala", "scale",
            "disposicao", "layout",
            "colunas", "columns",
            "espaco", "spacing",
            "modo", "mode",
            "classe", "class");

    private Crivo() {
    }

    public static void main(String[] args) {
        if (args.length < 2) {
            System.out.print(USAGE);
            System.exit(args.length == 0 ? 0 : 2);
        }
        try {
            String command = COMMAND_ALIASES.getOrDefault(args[0], args[0]);
            Project project = Project.open(Path.of(args[1]));
            Options options = Options.parse(args, command.equals("png") || command.equals("sheet") ? 3 : 2);
            switch (command) {
                case "info" -> info(project);
                case "palette" -> palette(project);
                case "png" -> png(project, Path.of(requireArg(args, 2, "arquivo de saída")), options);
                case "sheet" -> sheet(project, Path.of(requireArg(args, 2, "arquivo de saída")), options);
                case "matrix" -> System.out.print(matrix(project, options));
                case "check" -> System.out.println("ok: " + project.name + " é um projeto válido.");
                default -> {
                    System.err.println("Comando desconhecido: " + args[0]);
                    System.err.print(USAGE);
                    System.exit(2);
                }
            }
        } catch (IOException | IllegalArgumentException e) {
            System.err.println("erro: " + e.getMessage());
            System.exit(1);
        }
    }

    private static String requireArg(String[] args, int i, String name) {
        if (args.length <= i || args[i].startsWith("--")) {
            throw new IllegalArgumentException("Informe o " + name + ".");
        }
        return args[i];
    }

    /** Command-line options ({@code --name value}), stored under their English names. */
    static final class Options {

        private final Map<String, String> values = new HashMap<>();
        private final Map<String, String> typed = new HashMap<>();

        private Options() {
        }

        static Options parse(String[] args, int start) {
            Options options = new Options();
            for (int i = start; i < args.length; i++) {
                if (!args[i].startsWith("--")) {
                    throw new IllegalArgumentException("Argumento inesperado: " + args[i]);
                }
                if (i + 1 >= args.length) {
                    throw new IllegalArgumentException("Falta o valor de " + args[i]);
                }
                String name = args[i].substring(2);
                String key = OPTION_ALIASES.getOrDefault(name, name);
                options.typed.put(key, args[i]);
                options.values.put(key, args[++i]);
            }
            return options;
        }

        /** Builds options from name/value pairs, as if typed as {@code --name value}. */
        static Options of(String... pairs) {
            String[] args = new String[pairs.length];
            for (int i = 0; i < pairs.length; i++) {
                args[i] = i % 2 == 0 ? "--" + pairs[i] : pairs[i];
            }
            return parse(args, 0);
        }

        String get(String key, String fallback) {
            return values.getOrDefault(key, fallback);
        }

        /** The option as the user typed it (English or Portuguese), for error messages. */
        String flag(String key) {
            return typed.getOrDefault(key, "--" + key);
        }
    }

    private static int number(Options options, String key, int fallback, int min, int max) {
        String v = options.get(key, null);
        if (v == null) {
            return fallback;
        }
        int n = Integer.parseInt(v);
        if (n < min || n > max) {
            throw new IllegalArgumentException(options.flag(key) + " precisa ficar entre " + min + " e " + max);
        }
        return n;
    }

    private static void info(Project p) {
        System.out.printf(Locale.ROOT, "Nome:     %s%n", p.name);
        System.out.printf(Locale.ROOT, "Matriz:   %d x %d pixels%n", p.width, p.height);
        System.out.printf(Locale.ROOT, "Quadros:  %d (%d fps)%n", p.frames.size(), p.fps);
        System.out.printf(Locale.ROOT, "Camadas:  %d%n", p.layers.size());
        for (int i = p.layers.size() - 1; i >= 0; i--) {
            Project.Layer l = p.layers.get(i);
            System.out.printf(Locale.ROOT, "  - %s%s%s%n", l.name(), l.visible() ? "" : " (oculta)", l.opacity() < 100 ? " " + l.opacity() + "%" : "");
        }
        System.out.printf(Locale.ROOT, "Cores:    %d%n", p.colors().size());
    }

    private static void palette(Project p) {
        p.colors().entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .forEach(e -> System.out.printf(Locale.ROOT, "%s  %d px%n", Color.hex(e.getKey()), e.getValue()));
    }

    private static BufferedImage image(int[] argb, int width, int height, int scale) {
        BufferedImage img = new BufferedImage(width * scale, height * scale, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int c = argb[y * width + x];
                for (int dy = 0; dy < scale; dy++) {
                    for (int dx = 0; dx < scale; dx++) {
                        img.setRGB(x * scale + dx, y * scale + dy, c);
                    }
                }
            }
        }
        return img;
    }

    private static void write(BufferedImage img, Path out) throws IOException {
        Path dir = out.toAbsolutePath().getParent();
        if (dir != null) {
            Files.createDirectories(dir);
        }
        ImageIO.write(img, "png", out.toFile());
        System.out.printf(Locale.ROOT, "%s (%d x %d)%n", out, img.getWidth(), img.getHeight());
    }

    private static void png(Project p, Path out, Options o) throws IOException {
        int frame = number(o, "frame", 1, 1, p.frames.size()) - 1;
        int scale = number(o, "scale", 1, 1, 64);
        write(image(p.compose(frame), p.width, p.height, scale), out);
    }

    private static void sheet(Project p, Path out, Options o) throws IOException {
        int scale = number(o, "scale", 1, 1, 32);
        int spacing = number(o, "spacing", 0, 0, 64);
        String layout = o.get("layout", "horizontal");
        int n = p.frames.size();
        int columns = switch (layout) {
            case "horizontal" -> n;
            case "vertical" -> 1;
            case "grid", "grade" -> Math.min(n, number(o, "columns", (int) Math.ceil(Math.sqrt(n)), 1, 256));
            default -> throw new IllegalArgumentException("Disposição inválida: " + layout);
        };
        int rows = (n + columns - 1) / columns;
        int fw = p.width * scale;
        int fh = p.height * scale;
        BufferedImage sheet = new BufferedImage(columns * fw + (columns - 1) * spacing, rows * fh + (rows - 1) * spacing, BufferedImage.TYPE_INT_ARGB);
        var g = sheet.createGraphics();
        for (int i = 0; i < n; i++) {
            g.drawImage(image(p.compose(i), p.width, p.height, scale), (i % columns) * (fw + spacing), (i / columns) * (fh + spacing), null);
        }
        g.dispose();
        write(sheet, out);
    }

    static String identifier(String name) {
        String base = Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        StringBuilder sb = new StringBuilder();
        for (String part : base.split("[^A-Za-z0-9]+")) {
            if (!part.isEmpty()) {
                sb.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1).toLowerCase(Locale.ROOT));
            }
        }
        if (sb.isEmpty() || Character.isDigit(sb.charAt(0))) {
            sb.insert(0, "Sprite");
        }
        return sb.toString();
    }

    static String matrix(Project p, Options o) {
        String className = o.get("class", identifier(p.name));
        String mode = o.get("mode", "indices");
        if (!mode.equals("indices") && !mode.equals("argb")) {
            throw new IllegalArgumentException(o.flag("mode") + " precisa ser indices ou argb");
        }
        List<Integer> frameIndexes = new ArrayList<>();
        String f = o.get("frame", "all");
        if (f.equals("all") || f.equals("todos")) {
            for (int i = 0; i < p.frames.size(); i++) {
                frameIndexes.add(i);
            }
        } else {
            frameIndexes.add(number(o, "frame", 1, 1, p.frames.size()) - 1);
        }
        Map<Integer, Integer> order = new HashMap<>();
        List<Integer> palette = new ArrayList<>();
        boolean argb = mode.equals("argb");
        int[] values = new int[frameIndexes.size() * p.width * p.height];
        int n = 0;
        for (int k : frameIndexes) {
            int[] px = p.compose(k);
            for (int c : px) {
                if (argb) {
                    values[n++] = c;
                } else if ((c >>> 24) == 0) {
                    values[n++] = -1;
                } else {
                    Integer idx = order.get(c);
                    if (idx == null) {
                        idx = palette.size();
                        order.put(c, idx);
                        palette.add(c);
                    }
                    values[n++] = idx;
                }
            }
        }
        int[] colors = palette.stream().mapToInt(Integer::intValue).toArray();
        return javaClass(className, p.width, p.height, frameIndexes.size(), values, argb ? null : colors);
    }

    /** Above this many values, a Java literal would exceed the 64 KB per-method limit and would not compile. */
    static final int LITERAL_LIMIT = 4096;
    private static final int CHUNK = 20000;

    static String javaClass(String className, int width, int height, int frames, int[] values, int[] palette) {
        boolean indices = palette != null;
        StringBuilder sb = new StringBuilder();
        sb.append("public final class ").append(className).append(" {\n\n");
        sb.append("    public static final int WIDTH = ").append(width).append(";\n");
        sb.append("    public static final int HEIGHT = ").append(height).append(";\n");
        if (values.length > LITERAL_LIMIT || (indices && palette.length > 2048)) {
            return compact(sb, className, frames, values, palette);
        }
        if (indices) {
            sb.append("    public static final int TRANSPARENT = -1;\n\n");
            sb.append("    public static final int[] PALETTE = {");
            for (int i = 0; i < palette.length; i++) {
                sb.append(i == 0 ? "" : ", ").append(String.format("0x%08X", palette[i]));
            }
            sb.append("};\n");
        }
        sb.append("\n    public static final int[][][] FRAMES = {\n");
        int i = 0;
        for (int k = 0; k < frames; k++) {
            sb.append("        {\n");
            for (int y = 0; y < height; y++) {
                sb.append("            {");
                for (int x = 0; x < width; x++) {
                    int v = values[i++];
                    sb.append(x == 0 ? "" : ", ").append(indices ? String.valueOf(v) : String.format("0x%08X", v));
                }
                sb.append(y == height - 1 ? "}\n" : "},\n");
            }
            sb.append(k == frames - 1 ? "        }\n" : "        },\n");
        }
        sb.append("    };\n\n");
        sb.append("    private ").append(className).append("() {\n    }\n}\n");
        return sb.toString();
    }

    private static String compact(StringBuilder sb, String className, int frames, int[] values, int[] palette) {
        boolean indices = palette != null;
        boolean oneChar = indices && palette.length + 33 <= 0xFFFF;
        int base = indices ? (oneChar ? 33 : 1) : 0;
        StringBuilder codes = new StringBuilder();
        for (int v : values) {
            if (oneChar) {
                codes.append((char) (v + 33));
            } else {
                int u = indices ? v + 1 : v;
                codes.append((char) (u >>> 16)).append((char) (u & 0xFFFF));
            }
        }
        if (indices) {
            sb.append("    public static final int TRANSPARENT = -1;\n");
            sb.append("\n    public static final int[] PALETTE;\n");
        }
        sb.append(indices ? "" : "\n").append("    public static final int[][][] FRAMES;\n\n");
        sb.append("    // Matrix too large for a Java literal (64 KB limit per method): the values are packed\n");
        sb.append("    // as text, ").append(oneChar ? "one character per pixel (value + 33)" : "two characters per value (high and low 16 bits)");
        sb.append(", and are read when the class loads.\n");
        if (indices) {
            StringBuilder colors = new StringBuilder();
            for (int c : palette) {
                colors.append((char) (c >>> 16)).append((char) (c & 0xFFFF));
            }
            sb.append("    private static final String[] PALETTE_DATA = {\n").append(chunks(colors)).append(colors.length() > 0 ? ",\n" : "\n").append("    };\n\n");
        }
        sb.append("    private static final String[] DATA = {\n").append(chunks(codes)).append(",\n    };\n\n");
        sb.append("    static {\n");
        if (indices) {
            sb.append("        PALETTE = read(PALETTE_DATA, 2, 0, ").append(palette.length).append(");\n");
        }
        sb.append("        int[] v = read(DATA, ").append(oneChar ? 1 : 2).append(", ").append(base).append(", ").append(values.length).append(");\n");
        sb.append("        FRAMES = new int[").append(frames).append("][HEIGHT][WIDTH];\n");
        sb.append("        for (int f = 0, i = 0; f < ").append(frames).append("; f++)\n");
        sb.append("            for (int y = 0; y < HEIGHT; y++)\n");
        sb.append("                for (int x = 0; x < WIDTH; x++) FRAMES[f][y][x] = v[i++];\n");
        sb.append("    }\n\n");
        sb.append("    private static int[] read(String[] parts, int width, int base, int total) {\n");
        sb.append("        StringBuilder text = new StringBuilder();\n");
        sb.append("        for (String part : parts) text.append(part);\n");
        sb.append("        int[] values = new int[total];\n");
        sb.append("        for (int i = 0, k = 0; i < total; i++) {\n");
        sb.append("            if (width == 1) values[i] = text.charAt(k++) - base;\n");
        sb.append("            else values[i] = ((text.charAt(k++) << 16) | text.charAt(k++)) - base;\n");
        sb.append("        }\n");
        sb.append("        return values;\n");
        sb.append("    }\n\n");
        sb.append("    private ").append(className).append("() {\n    }\n}\n");
        return sb.toString();
    }

    private static String chunks(CharSequence codes) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < codes.length(); i += CHUNK) {
            if (i > 0) {
                sb.append(",\n");
            }
            sb.append("        \"");
            for (int k = i; k < Math.min(codes.length(), i + CHUNK); k++) {
                char c = codes.charAt(k);
                if (c == '"') {
                    sb.append("\\\"");
                } else if (c == '\\') {
                    sb.append("\\\\");
                } else if (c >= 32 && c < 127) {
                    sb.append(c);
                } else if (c < 128) {
                    sb.append(String.format("\\%03o", (int) c));
                } else {
                    sb.append(String.format("\\u%04X", (int) c));
                }
            }
            sb.append('"');
        }
        return sb.toString();
    }
}
