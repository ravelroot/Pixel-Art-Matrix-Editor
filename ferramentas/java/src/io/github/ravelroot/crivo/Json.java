package io.github.ravelroot.crivo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {

    private final String texto;
    private int pos;

    private Json(String texto) {
        this.texto = texto;
    }

    public static Object ler(String texto) {
        Json leitor = new Json(texto);
        leitor.espacos();
        Object valor = leitor.valor();
        leitor.espacos();
        if (leitor.pos != texto.length()) {
            throw leitor.erro("conteúdo depois do fim do JSON");
        }
        return valor;
    }

    private IllegalArgumentException erro(String mensagem) {
        return new IllegalArgumentException("JSON inválido na posição " + pos + ": " + mensagem);
    }

    private void espacos() {
        while (pos < texto.length() && Character.isWhitespace(texto.charAt(pos))) {
            pos++;
        }
    }

    private char atual() {
        if (pos >= texto.length()) {
            throw erro("fim inesperado");
        }
        return texto.charAt(pos);
    }

    private void esperar(char c) {
        if (atual() != c) {
            throw erro("esperava '" + c + "'");
        }
        pos++;
    }

    private Object valor() {
        char c = atual();
        switch (c) {
            case '{':
                return objeto();
            case '[':
                return lista();
            case '"':
                return texto();
            case 't':
                palavra("true");
                return Boolean.TRUE;
            case 'f':
                palavra("false");
                return Boolean.FALSE;
            case 'n':
                palavra("null");
                return null;
            default:
                return numero();
        }
    }

    private void palavra(String p) {
        if (!texto.startsWith(p, pos)) {
            throw erro("esperava " + p);
        }
        pos += p.length();
    }

    private Map<String, Object> objeto() {
        Map<String, Object> mapa = new LinkedHashMap<>();
        esperar('{');
        espacos();
        if (atual() == '}') {
            pos++;
            return mapa;
        }
        while (true) {
            espacos();
            String chave = texto();
            espacos();
            esperar(':');
            espacos();
            mapa.put(chave, valor());
            espacos();
            if (atual() == ',') {
                pos++;
                continue;
            }
            esperar('}');
            return mapa;
        }
    }

    private List<Object> lista() {
        List<Object> itens = new ArrayList<>();
        esperar('[');
        espacos();
        if (atual() == ']') {
            pos++;
            return itens;
        }
        while (true) {
            espacos();
            itens.add(valor());
            espacos();
            if (atual() == ',') {
                pos++;
                continue;
            }
            esperar(']');
            return itens;
        }
    }

    private String texto() {
        esperar('"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = atual();
            pos++;
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = atual();
            pos++;
            switch (e) {
                case 'n' -> sb.append('\n');
                case 't' -> sb.append('\t');
                case 'r' -> sb.append('\r');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'u' -> {
                    if (pos + 4 > texto.length()) {
                        throw erro("escape unicode incompleto");
                    }
                    sb.append((char) Integer.parseInt(texto.substring(pos, pos + 4), 16));
                    pos += 4;
                }
                default -> sb.append(e);
            }
        }
    }

    private Number numero() {
        int inicio = pos;
        while (pos < texto.length() && "+-0123456789.eE".indexOf(texto.charAt(pos)) >= 0) {
            pos++;
        }
        String n = texto.substring(inicio, pos);
        if (n.isEmpty()) {
            throw erro("valor inesperado");
        }
        if (n.contains(".") || n.contains("e") || n.contains("E")) {
            return Double.parseDouble(n);
        }
        return Long.parseLong(n);
    }
}
