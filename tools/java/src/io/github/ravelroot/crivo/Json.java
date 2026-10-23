package io.github.ravelroot.crivo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {

    private final String text;
    private int pos;

    private Json(String text) {
        this.text = text;
    }

    public static Object parse(String text) {
        Json parser = new Json(text);
        parser.whitespace();
        Object value = parser.value();
        parser.whitespace();
        if (parser.pos != text.length()) {
            throw parser.error("conteúdo depois do fim do JSON");
        }
        return value;
    }

    private IllegalArgumentException error(String message) {
        return new IllegalArgumentException("JSON inválido na posição " + pos + ": " + message);
    }

    private void whitespace() {
        while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) {
            pos++;
        }
    }

    private char current() {
        if (pos >= text.length()) {
            throw error("fim inesperado");
        }
        return text.charAt(pos);
    }

    private void expect(char c) {
        if (current() != c) {
            throw error("esperava '" + c + "'");
        }
        pos++;
    }

    private Object value() {
        char c = current();
        switch (c) {
            case '{':
                return object();
            case '[':
                return array();
            case '"':
                return string();
            case 't':
                literal("true");
                return Boolean.TRUE;
            case 'f':
                literal("false");
                return Boolean.FALSE;
            case 'n':
                literal("null");
                return null;
            default:
                return number();
        }
    }

    private void literal(String word) {
        if (!text.startsWith(word, pos)) {
            throw error("esperava " + word);
        }
        pos += word.length();
    }

    private Map<String, Object> object() {
        Map<String, Object> map = new LinkedHashMap<>();
        expect('{');
        whitespace();
        if (current() == '}') {
            pos++;
            return map;
        }
        while (true) {
            whitespace();
            String key = string();
            whitespace();
            expect(':');
            whitespace();
            map.put(key, value());
            whitespace();
            if (current() == ',') {
                pos++;
                continue;
            }
            expect('}');
            return map;
        }
    }

    private List<Object> array() {
        List<Object> items = new ArrayList<>();
        expect('[');
        whitespace();
        if (current() == ']') {
            pos++;
            return items;
        }
        while (true) {
            whitespace();
            items.add(value());
            whitespace();
            if (current() == ',') {
                pos++;
                continue;
            }
            expect(']');
            return items;
        }
    }

    private String string() {
        expect('"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = current();
            pos++;
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = current();
            pos++;
            switch (e) {
                case 'n' -> sb.append('\n');
                case 't' -> sb.append('\t');
                case 'r' -> sb.append('\r');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'u' -> {
                    if (pos + 4 > text.length()) {
                        throw error("escape unicode incompleto");
                    }
                    sb.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
                    pos += 4;
                }
                default -> sb.append(e);
            }
        }
    }

    private Number number() {
        int start = pos;
        while (pos < text.length() && "+-0123456789.eE".indexOf(text.charAt(pos)) >= 0) {
            pos++;
        }
        String n = text.substring(start, pos);
        if (n.isEmpty()) {
            throw error("valor inesperado");
        }
        if (n.contains(".") || n.contains("e") || n.contains("E")) {
            return Double.parseDouble(n);
        }
        return Long.parseLong(n);
    }
}
