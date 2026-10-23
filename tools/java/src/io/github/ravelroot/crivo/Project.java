package io.github.ravelroot.crivo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Project {

    /** Newest version of the .crivo format this tool reads. Version 1 files (Crivo 1.x) are converted on load. */
    public static final int FORMAT_VERSION = 2;

    public record Layer(String id, String name, boolean visible, int opacity) {
    }

    public record Frame(String id, Integer duration) {
    }

    public final String name;
    public final int width;
    public final int height;
    public final int fps;
    public final List<Layer> layers = new ArrayList<>();
    public final List<Frame> frames = new ArrayList<>();
    private final Map<String, int[]> cells = new HashMap<>();

    @SuppressWarnings("unchecked")
    private Project(Map<String, Object> data) {
        if (!"crivo".equals(data.get("format"))) {
            throw new IllegalArgumentException("Este arquivo não é um projeto do Crivo.");
        }
        if (data.get("version") instanceof Number v && v.doubleValue() > FORMAT_VERSION) {
            throw new IllegalArgumentException("Este projeto foi salvo por uma versão mais nova do Crivo.");
        }
        name = String.valueOf(data.getOrDefault("name", "Sem título"));
        width = toInt(data.get("width"), 0);
        height = toInt(data.get("height"), 0);
        fps = toInt(data.get("fps"), 8);
        if (width < 1 || height < 1 || width > 1024 || height > 1024) {
            throw new IllegalArgumentException("Tamanho da matriz inválido: " + width + "x" + height);
        }
        for (Object o : (List<Object>) data.getOrDefault("layers", List.of())) {
            Map<String, Object> l = (Map<String, Object>) o;
            layers.add(new Layer(String.valueOf(l.get("id")), String.valueOf(l.get("name")), !Boolean.FALSE.equals(l.get("visible")), toInt(l.get("opacity"), 100)));
        }
        for (Object o : (List<Object>) data.getOrDefault("frames", List.of())) {
            Map<String, Object> f = (Map<String, Object>) o;
            Object d = f.get("duration");
            frames.add(new Frame(String.valueOf(f.get("id")), d == null ? null : toInt(d, 0)));
        }
        for (Object o : (List<Object>) data.getOrDefault("cells", List.of())) {
            Map<String, Object> cell = (Map<String, Object>) o;
            byte[] raw = Base64.getDecoder().decode(String.valueOf(cell.get("rle")));
            cells.put(cell.get("frame") + ":" + cell.get("layer"), Rle.decode(raw, width * height));
        }
    }

    private static int toInt(Object v, int fallback) {
        return v instanceof Number n ? n.intValue() : fallback;
    }

    @SuppressWarnings("unchecked")
    public static Project open(Path file) throws IOException {
        Object data = Json.parse(Files.readString(file, StandardCharsets.UTF_8));
        if (!(data instanceof Map)) {
            throw new IllegalArgumentException("Este arquivo não é um projeto do Crivo.");
        }
        Map<String, Object> document = (Map<String, Object>) data;
        if (document.containsKey("formato")) {
            document = upgrade(document);
        }
        return new Project(document);
    }

    /**
     * Converts a format v1 document (Portuguese keys, written by Crivo 1.x) to format v2 (English keys).
     * Only keys that are present are copied, so missing values keep their usual defaults.
     */
    static Map<String, Object> upgrade(Map<String, Object> v1) {
        Map<String, Object> v2 = new LinkedHashMap<>();
        v2.put("format", v1.get("formato"));
        v2.put("version", (long) FORMAT_VERSION);
        rename(v1, "nome", v2, "name");
        rename(v1, "largura", v2, "width");
        rename(v1, "altura", v2, "height");
        rename(v1, "fps", v2, "fps");
        rename(v1, "paleta", v2, "palette");
        if (v1.containsKey("camadas")) {
            v2.put("layers", upgradeList(v1.get("camadas"), "id", "id", "nome", "name", "visivel", "visible", "opacidade", "opacity", "bloqueada", "locked"));
        }
        if (v1.containsKey("quadros")) {
            v2.put("frames", upgradeList(v1.get("quadros"), "id", "id", "duracao", "duration"));
        }
        if (v1.containsKey("celulas")) {
            v2.put("cells", upgradeList(v1.get("celulas"), "quadro", "frame", "camada", "layer", "rle", "rle"));
        }
        return v2;
    }

    private static void rename(Map<String, Object> from, String oldKey, Map<String, Object> to, String newKey) {
        if (from.containsKey(oldKey)) {
            to.put(newKey, from.get(oldKey));
        }
    }

    /** Renames the keys of each object in a v1 list; {@code keys} holds pairs of old and new names. */
    @SuppressWarnings("unchecked")
    private static Object upgradeList(Object list, String... keys) {
        if (!(list instanceof List<?> items)) {
            return list;
        }
        List<Object> result = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map)) {
                result.add(item);
                continue;
            }
            Map<String, Object> old = (Map<String, Object>) item;
            Map<String, Object> renamed = new LinkedHashMap<>();
            for (int i = 0; i < keys.length; i += 2) {
                rename(old, keys[i], renamed, keys[i + 1]);
            }
            result.add(renamed);
        }
        return result;
    }

    public int[] compose(int frameIndex) {
        int[] target = new int[width * height];
        Frame f = frames.get(frameIndex);
        for (Layer l : layers) {
            int[] source = cells.get(f.id() + ":" + l.id());
            if (!l.visible() || source == null || l.opacity() <= 0) {
                continue;
            }
            double opacity = l.opacity() / 100.0;
            for (int i = 0; i < source.length; i++) {
                int color = source[i];
                int a = color >>> 24;
                if (a == 0) {
                    continue;
                }
                target[i] = (a == 255 && opacity >= 1) ? color : Color.blend(target[i], color, opacity);
            }
        }
        return target;
    }

    public Map<Integer, Integer> colors() {
        Map<Integer, Integer> usage = new LinkedHashMap<>();
        for (int f = 0; f < frames.size(); f++) {
            for (int c : compose(f)) {
                if ((c >>> 24) != 0) {
                    usage.merge(c, 1, Integer::sum);
                }
            }
        }
        return usage;
    }
}
