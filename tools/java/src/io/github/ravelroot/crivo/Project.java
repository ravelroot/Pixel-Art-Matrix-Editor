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

    /**
     * A layer. The fields after {@code opacity} are the optional 2.1 keys: blend mode, kind ("image", "group" or
     * "tilemap"), id of the containing group (null at the top level) and whether it is a reference layer.
     */
    public record Layer(String id, String name, boolean visible, int opacity, String blendMode, String kind, String parent, boolean reference) {

        public Layer(String id, String name, boolean visible, int opacity) {
            this(id, name, visible, opacity, "normal", "image", null, false);
        }

        public boolean group() {
            return kind.equals("group");
        }
    }

    public record Frame(String id, Integer duration) {
    }

    /** A frame tag (2.1): frames {@code from} to {@code to} (ids), played forward, reverse or pingpong. */
    public record Tag(String id, String name, String from, String to, String direction, int repeat, String color) {
    }

    /** A slice (2.1): a named rectangle of the canvas. */
    public record Slice(String id, String name, int x, int y, int width, int height) {
    }

    /** A tileset (2.1): tile size and number of tiles (tile 0 is the empty tile). */
    public record Tileset(String id, String name, int tileWidth, int tileHeight, int tileCount) {
    }

    private static final List<String> KINDS = List.of("image", "group", "tilemap");
    private static final List<String> COLOR_MODES = List.of("rgba", "indexed", "grayscale");
    private static final List<String> DIRECTIONS = List.of("forward", "reverse", "pingpong");

    public final String name;
    public final int width;
    public final int height;
    public final int fps;
    public final List<Layer> layers = new ArrayList<>();
    public final List<Frame> frames = new ArrayList<>();
    /** Color mode (2.1), or null when the file does not say (an RGBA project). */
    public final String colorMode;
    public final List<Tag> tags = new ArrayList<>();
    public final List<Slice> slices = new ArrayList<>();
    public final List<Tileset> tilesets = new ArrayList<>();
    /** Linked cels (2.1): "frame:layer" of a cel to the id of the frame whose cel it shares. */
    public final Map<String, String> links = new HashMap<>();
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
        Object mode = data.get("colorMode");
        if (mode != null && !COLOR_MODES.contains(mode)) {
            throw new IllegalArgumentException("Modo de cor inválido: " + mode);
        }
        colorMode = mode == null ? null : (String) mode;
        for (Object o : (List<Object>) data.getOrDefault("layers", List.of())) {
            Map<String, Object> l = (Map<String, Object>) o;
            String name = String.valueOf(l.get("name"));
            String blendMode = text(l.get("blendMode"), "normal");
            if (!Blend.MODES.contains(blendMode)) {
                throw new IllegalArgumentException("Modo de mesclagem inválido na camada '" + name + "': " + blendMode);
            }
            String kind = text(l.get("kind"), "image");
            if (!KINDS.contains(kind)) {
                throw new IllegalArgumentException("Tipo de camada inválido na camada '" + name + "': " + kind);
            }
            layers.add(new Layer(String.valueOf(l.get("id")), name, !Boolean.FALSE.equals(l.get("visible")), toInt(l.get("opacity"), 100),
                    blendMode, kind, text(l.get("parent"), null), Boolean.TRUE.equals(l.get("reference"))));
        }
        for (Object o : (List<Object>) data.getOrDefault("frames", List.of())) {
            Map<String, Object> f = (Map<String, Object>) o;
            Object d = f.get("duration");
            frames.add(new Frame(String.valueOf(f.get("id")), d == null ? null : toInt(d, 0)));
        }
        for (Object o : (List<Object>) data.getOrDefault("cells", List.of())) {
            Map<String, Object> cell = (Map<String, Object>) o;
            byte[] raw = Base64.getDecoder().decode(String.valueOf(cell.get("rle")));
            String key = cell.get("frame") + ":" + cell.get("layer");
            cells.put(key, Rle.decode(raw, width * height));
            String link = text(cell.get("link"), null);
            if (link != null) {
                links.put(key, link);
            }
        }
        Map<String, Integer> framePositions = new HashMap<>();
        for (int i = 0; i < frames.size(); i++) {
            framePositions.put(frames.get(i).id(), i);
        }
        for (Object o : (List<Object>) data.getOrDefault("tags", List.of())) {
            Map<String, Object> t = (Map<String, Object>) o;
            String name = text(t.get("name"), "Tag");
            String from = text(t.get("from"), null);
            String to = text(t.get("to"), null);
            if (!framePositions.containsKey(from) || !framePositions.containsKey(to)) {
                throw new IllegalArgumentException("A tag '" + name + "' aponta para um quadro que não existe.");
            }
            String direction = text(t.get("direction"), "forward");
            if (!DIRECTIONS.contains(direction)) {
                throw new IllegalArgumentException("Direção inválida na tag '" + name + "': " + direction);
            }
            tags.add(new Tag(text(t.get("id"), null), name, from, to, direction, toInt(t.get("repeat"), 0), text(t.get("color"), "#000000")));
        }
        for (Object o : (List<Object>) data.getOrDefault("slices", List.of())) {
            Map<String, Object> sl = (Map<String, Object>) o;
            slices.add(new Slice(text(sl.get("id"), null), text(sl.get("name"), "Fatia"), toInt(sl.get("x"), 0), toInt(sl.get("y"), 0),
                    toInt(sl.get("width"), 1), toInt(sl.get("height"), 1)));
        }
        for (Object o : (List<Object>) data.getOrDefault("tilesets", List.of())) {
            Map<String, Object> ts = (Map<String, Object>) o;
            Object tiles = ts.get("tiles");
            tilesets.add(new Tileset(text(ts.get("id"), null), text(ts.get("name"), "Tiles"), toInt(ts.get("tileWidth"), 0), toInt(ts.get("tileHeight"), 0),
                    tiles instanceof List<?> list ? list.size() : 0));
        }
    }

    private static int toInt(Object v, int fallback) {
        return v instanceof Number n ? n.intValue() : fallback;
    }

    private static String text(Object v, String fallback) {
        return v == null || "".equals(v) ? fallback : String.valueOf(v);
    }

    /** Position (0-based) of the frame with this id, or -1. */
    public int frameIndex(String id) {
        for (int i = 0; i < frames.size(); i++) {
            if (frames.get(i).id().equals(id)) {
                return i;
            }
        }
        return -1;
    }

    /** Nesting depth of a layer: 0 at the top level, 1 inside a group, and so on. */
    public int depth(Layer layer) {
        Map<String, Layer> byId = new HashMap<>();
        for (Layer l : layers) {
            byId.put(l.id(), l);
        }
        int depth = 0;
        for (Layer l = byId.get(layer.parent()); l != null && depth < layers.size(); l = byId.get(l.parent())) {
            depth++;
        }
        return depth;
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

    /** A project from an already parsed .crivo document (format v1 or v2). */
    @SuppressWarnings("unchecked")
    static Project of(Map<String, Object> document) {
        return new Project(document.containsKey("formato") ? upgrade(document) : document);
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

    /** The rendered frame: groups, blend modes and opacity applied; hidden and reference layers left out. */
    public int[] compose(int frameIndex) {
        return compose(frameIndex, false);
    }

    /** Groups nested deeper than this are skipped, as in the editor. */
    private static final int MAX_GROUP_DEPTH = 32;

    /**
     * Renders a frame exactly like the editor (PixelDocument.composite in core/document.js). A layer whose parent
     * does not exist is drawn at the top level. A group in normal mode at 100% passes its children straight through
     * onto the layers below it; any other group is isolated: its children are composited into a transparent buffer,
     * which is then blended with the group's mode and opacity. A hidden group hides its children. Without groups,
     * blend modes or reference layers this is exactly the 2.0 rendering.
     */
    public int[] compose(int frameIndex, boolean includeReference) {
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (Layer l : layers) {
            ids.add(l.id());
        }
        Map<String, List<Layer>> children = new HashMap<>();
        for (Layer l : layers) {
            String parent = l.parent() != null && ids.contains(l.parent()) ? l.parent() : null;
            children.computeIfAbsent(parent, k -> new ArrayList<>()).add(l);
        }
        return draw(null, new int[width * height], children, frames.get(frameIndex), includeReference, 0);
    }

    private int[] draw(String parent, int[] target, Map<String, List<Layer>> children, Frame f, boolean includeReference, int depth) {
        for (Layer l : children.getOrDefault(parent, List.of())) {
            if (!l.visible() || l.opacity() <= 0 || (l.reference() && !includeReference)) {
                continue;
            }
            double opacity = l.opacity() / 100.0;
            if (l.group()) {
                if (depth > MAX_GROUP_DEPTH) {
                    continue;
                }
                if (l.blendMode().equals("normal") && l.opacity() >= 100) {
                    draw(l.id(), target, children, f, includeReference, depth + 1);
                } else {
                    Blend.composite(target, draw(l.id(), new int[width * height], children, f, includeReference, depth + 1), opacity, l.blendMode());
                }
                continue;
            }
            int[] source = cells.get(f.id() + ":" + l.id());
            if (source != null) {
                Blend.composite(target, source, opacity, l.blendMode());
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
