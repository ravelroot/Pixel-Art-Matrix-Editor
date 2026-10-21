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

public final class Projeto {

    public record Camada(String id, String nome, boolean visivel, int opacidade) {
    }

    public record Quadro(String id, Integer duracao) {
    }

    public final String nome;
    public final int largura;
    public final int altura;
    public final int fps;
    public final List<Camada> camadas = new ArrayList<>();
    public final List<Quadro> quadros = new ArrayList<>();
    private final Map<String, int[]> celulas = new HashMap<>();

    @SuppressWarnings("unchecked")
    private Projeto(Map<String, Object> dados) {
        if (!"crivo".equals(dados.get("formato"))) {
            throw new IllegalArgumentException("Este arquivo não é um projeto do Crivo.");
        }
        nome = String.valueOf(dados.getOrDefault("nome", "Sem título"));
        largura = inteiro(dados.get("largura"), 0);
        altura = inteiro(dados.get("altura"), 0);
        fps = inteiro(dados.get("fps"), 8);
        if (largura < 1 || altura < 1 || largura > 1024 || altura > 1024) {
            throw new IllegalArgumentException("Tamanho da matriz inválido: " + largura + "x" + altura);
        }
        for (Object o : (List<Object>) dados.getOrDefault("camadas", List.of())) {
            Map<String, Object> c = (Map<String, Object>) o;
            camadas.add(new Camada(String.valueOf(c.get("id")), String.valueOf(c.get("nome")), !Boolean.FALSE.equals(c.get("visivel")), inteiro(c.get("opacidade"), 100)));
        }
        for (Object o : (List<Object>) dados.getOrDefault("quadros", List.of())) {
            Map<String, Object> q = (Map<String, Object>) o;
            Object d = q.get("duracao");
            quadros.add(new Quadro(String.valueOf(q.get("id")), d == null ? null : inteiro(d, 0)));
        }
        for (Object o : (List<Object>) dados.getOrDefault("celulas", List.of())) {
            Map<String, Object> cel = (Map<String, Object>) o;
            byte[] bruto = Base64.getDecoder().decode(String.valueOf(cel.get("rle")));
            celulas.put(cel.get("quadro") + ":" + cel.get("camada"), Rle.decodificar(bruto, largura * altura));
        }
    }

    private static int inteiro(Object v, int padrao) {
        return v instanceof Number n ? n.intValue() : padrao;
    }

    @SuppressWarnings("unchecked")
    public static Projeto abrir(Path arquivo) throws IOException {
        Object dados = Json.ler(Files.readString(arquivo, StandardCharsets.UTF_8));
        if (!(dados instanceof Map)) {
            throw new IllegalArgumentException("Este arquivo não é um projeto do Crivo.");
        }
        return new Projeto((Map<String, Object>) dados);
    }

    public int[] compor(int indiceQuadro) {
        int[] destino = new int[largura * altura];
        Quadro q = quadros.get(indiceQuadro);
        for (Camada c : camadas) {
            int[] origem = celulas.get(q.id() + ":" + c.id());
            if (!c.visivel() || origem == null || c.opacidade() <= 0) {
                continue;
            }
            double opacidade = c.opacidade() / 100.0;
            for (int i = 0; i < origem.length; i++) {
                int cor = origem[i];
                int a = cor >>> 24;
                if (a == 0) {
                    continue;
                }
                destino[i] = (a == 255 && opacidade >= 1) ? cor : Cor.sobrepor(destino[i], cor, opacidade);
            }
        }
        return destino;
    }

    public Map<Integer, Integer> cores() {
        Map<Integer, Integer> uso = new LinkedHashMap<>();
        for (int q = 0; q < quadros.size(); q++) {
            for (int c : compor(q)) {
                if ((c >>> 24) != 0) {
                    uso.merge(c, 1, Integer::sum);
                }
            }
        }
        return uso;
    }
}
