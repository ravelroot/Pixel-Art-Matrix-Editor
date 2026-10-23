import json
import re
import struct
import unicodedata
import zlib

from .rle import para_hex

FORMATOS = {
    "json": ("application/json", "json"),
    "csv": ("text/csv", "csv"),
    "js": ("text/javascript", "js"),
    "py": ("text/x-python", "py"),
    "c": ("text/x-c", "h"),
    "java": ("text/x-java", "java"),
}

LADO_MAXIMO_PNG = 2048


def identificador(nome, estilo="camelo"):
    base = unicodedata.normalize("NFD", nome or "sprite")
    base = "".join(c for c in base if unicodedata.category(c) != "Mn")
    partes = [p.lower() for p in re.split(r"[^A-Za-z0-9]+", base) if p]
    if not partes:
        partes = ["sprite"]
    if partes[0][0].isdigit():
        partes.insert(0, "sprite")
    if estilo == "constante":
        return "_".join(partes).upper()
    if estilo == "cobra":
        return "_".join(partes)
    if estilo == "pascal":
        return "".join(p.capitalize() for p in partes)
    return partes[0] + "".join(p.capitalize() for p in partes[1:])


def montar_matrizes(quadros, largura, altura, modo="indices"):
    ordem = {}
    if modo == "indices":
        for px in quadros:
            for c in px:
                if c >> 24 and c not in ordem:
                    ordem[c] = len(ordem)
    matrizes = []
    for px in quadros:
        linhas = []
        for y in range(altura):
            linha = []
            for x in range(largura):
                c = px[y * largura + x]
                if modo == "indices":
                    linha.append(ordem[c] if c >> 24 else -1)
                else:
                    linha.append(para_hex(c) if c >> 24 else None)
            linhas.append(linha)
        matrizes.append(linhas)
    return {
        "largura": largura,
        "altura": altura,
        "modo": modo,
        "paleta": [para_hex(c) for c in ordem],
        "quadros": matrizes,
    }


def _valor(v, aspas, nulo):
    if v is None:
        return nulo
    if isinstance(v, str):
        return f"{aspas}{v}{aspas}"
    return str(v)


def _linhas(matriz, recuo, aspas, nulo):
    return ",\n".join(recuo + "[" + ", ".join(_valor(v, aspas, nulo) for v in linha) + "]" for linha in matriz)


def _hex_para_inteiro(hex_, ordem):
    h = hex_.replace("#", "")
    rgb = h[:6].upper()
    a = (h[6:8] if len(h) == 8 else "FF").upper()
    return "0x" + a + rgb if ordem == "argb" else "0x" + rgb + a


def _largura_valores(dados):
    maior = 1
    for q in dados["quadros"]:
        for linha in q:
            for v in linha:
                maior = max(maior, len(str(v)))
    return maior


def _gerar_c(dados, nome):
    id_ = identificador(nome, "cobra")
    ID = id_.upper()
    indices = dados["modo"] == "indices"
    tipo = ("int32_t" if len(dados["paleta"]) > 32767 else "int16_t") if indices else "uint32_t"
    w = _largura_valores(dados) if indices else 10

    def conv(v):
        if indices:
            return str(v)
        return "0x00000000" if v is None else _hex_para_inteiro(v, "rgba")

    quadros = ",\n".join(
        "    {\n" + ",\n".join("        {" + ", ".join(conv(v).rjust(w) for v in linha) + "}" for linha in q) + "\n    }" for q in dados["quadros"]
    )
    paleta = ", ".join(_hex_para_inteiro(c, "rgba") for c in dados["paleta"]) if dados["paleta"] else "0x00000000"
    return (
        f"#ifndef {ID}_H\n#define {ID}_H\n\n#include <stdint.h>\n\n"
        f"#define {ID}_LARGURA {dados['largura']}\n#define {ID}_ALTURA {dados['altura']}\n#define {ID}_QUADROS {len(dados['quadros'])}\n"
        f"#define {ID}_CORES {len(dados['paleta'])}\n\n"
        f"static const uint32_t {id_}_paleta[{max(1, len(dados['paleta']))}] = {{{paleta}}};\n\n"
        f"static const {tipo} {id_}_pixels[{ID}_QUADROS][{ID}_ALTURA][{ID}_LARGURA] = {{\n" + quadros + "\n};\n\n#endif\n"
    )


# Um inicializador Java passa de 64 KB de bytecode com alguns milhares de números, e a classe não compila.
# Acima deste limite, a matriz e a paleta vão compactadas em texto e são lidas quando a classe carrega
# (mesmo formato gerado pelo editor em JavaScript).
LIMITE_JAVA_LITERAL = 4096
PEDACO_JAVA = 20000


def _texto_java(codigos):
    partes = []
    for c in codigos:
        if c == 34:
            partes.append('\\"')
        elif c == 92:
            partes.append("\\\\")
        elif 32 <= c < 127:
            partes.append(chr(c))
        elif c < 128:
            partes.append("\\" + format(c, "03o"))
        else:
            partes.append("\\u" + format(c, "04X"))
    return "".join(partes)


def _pedacos_java(codigos, recuo):
    return ",\n".join(f'{recuo}"{_texto_java(codigos[i : i + PEDACO_JAVA])}"' for i in range(0, len(codigos), PEDACO_JAVA))


def _argb(hex_):
    h = hex_.replace("#", "")
    return (int(h[6:8] if len(h) == 8 else "ff", 16) << 24) | int(h[:6], 16)


def _gerar_java_compacto(dados, classe):
    indices = dados["modo"] == "indices"
    n_quadros = len(dados["quadros"])
    total = n_quadros * dados["altura"] * dados["largura"]
    um_caractere = indices and len(dados["paleta"]) + 33 <= 0xFFFF
    base = (33 if um_caractere else 1) if indices else 0
    codigos = []
    for q in dados["quadros"]:
        for linha in q:
            for v in linha:
                if um_caractere:
                    codigos.append(v + 33)
                else:
                    u = v + 1 if indices else (0 if v is None else _argb(v))
                    codigos.extend((u >> 16, u & 0xFFFF))
    cores = []
    for c in dados["paleta"]:
        u = _argb(c)
        cores.extend((u >> 16, u & 0xFFFF))
    explicacao = "um caractere por pixel (valor + 33)" if um_caractere else "dois caracteres por valor (16 bits altos e baixos)"
    transparente = "    public static final int TRANSPARENTE = -1;\n" if indices else ""
    return (
        f"public final class {classe} {{\n\n"
        f"    public static final int LARGURA = {dados['largura']};\n"
        f"    public static final int ALTURA = {dados['altura']};\n{transparente}"
        "\n    public static final int[] PALETA;\n"
        "    public static final int[][][] QUADROS;\n\n"
        "    // Matriz grande demais para um literal Java (limite de 64 KB por método): os valores vêm compactados\n"
        f"    // em texto, {explicacao}, e são lidos quando a classe carrega.\n"
        f"    private static final String[] DADOS_PALETA = {{\n{_pedacos_java(cores, '        ')}{',' if cores else ''}\n    }};\n\n"
        f"    private static final String[] DADOS = {{\n{_pedacos_java(codigos, '        ')},\n    }};\n\n"
        "    static {\n"
        f"        PALETA = ler(DADOS_PALETA, 2, 0, {len(dados['paleta'])});\n"
        f"        int[] v = ler(DADOS, {1 if um_caractere else 2}, {base}, {total});\n"
        f"        QUADROS = new int[{n_quadros}][ALTURA][LARGURA];\n"
        f"        for (int q = 0, i = 0; q < {n_quadros}; q++)\n"
        "            for (int y = 0; y < ALTURA; y++)\n"
        "                for (int x = 0; x < LARGURA; x++) QUADROS[q][y][x] = v[i++];\n"
        "    }\n\n"
        "    private static int[] ler(String[] partes, int largura, int base, int total) {\n"
        "        StringBuilder texto = new StringBuilder();\n"
        "        for (String parte : partes) texto.append(parte);\n"
        "        int[] valores = new int[total];\n"
        "        for (int i = 0, k = 0; i < total; i++) {\n"
        "            if (largura == 1) valores[i] = texto.charAt(k++) - base;\n"
        "            else valores[i] = ((texto.charAt(k++) << 16) | texto.charAt(k++)) - base;\n"
        "        }\n"
        "        return valores;\n"
        "    }\n\n"
        f"    private {classe}() {{\n    }}\n}}\n"
    )


def _gerar_java(dados, nome):
    classe = identificador(nome, "pascal")
    if len(dados["quadros"]) * dados["altura"] * dados["largura"] > LIMITE_JAVA_LITERAL or len(dados["paleta"]) > 2048:
        return _gerar_java_compacto(dados, classe)
    indices = dados["modo"] == "indices"
    w = _largura_valores(dados) if indices else 10

    def conv(v):
        if indices:
            return str(v)
        return "0x00000000" if v is None else _hex_para_inteiro(v, "argb")

    quadros = ",\n".join(
        "        {\n" + ",\n".join("            {" + ", ".join(conv(v).rjust(w) for v in linha) + "}" for linha in q) + "\n        }" for q in dados["quadros"]
    )
    transparente = "    public static final int TRANSPARENTE = -1;\n" if indices else ""
    paleta = ", ".join(_hex_para_inteiro(c, "argb") for c in dados["paleta"])
    return (
        f"public final class {classe} {{\n\n"
        f"    public static final int LARGURA = {dados['largura']};\n"
        f"    public static final int ALTURA = {dados['altura']};\n{transparente}"
        f"\n    public static final int[] PALETA = {{{paleta}}};\n\n"
        f"    public static final int[][][] QUADROS = {{\n" + quadros + f"\n    }};\n\n    private {classe}() {{\n    }}\n}}\n"
    )


def _bloco_png(tipo, dados):
    return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)


def gerar_png(pixels, largura, altura, escala=1):
    """Codifica pixels RGBA empacotados (R no byte baixo) num PNG de 8 bits por canal, ampliado por vizinho mais próximo."""
    escala = int(escala)
    if escala < 1 or largura * escala > LADO_MAXIMO_PNG or altura * escala > LADO_MAXIMO_PNG:
        raise ValueError(f"A imagem final precisa ter no máximo {LADO_MAXIMO_PNG} px de lado.")
    linhas = bytearray()
    for y in range(altura):
        linha = bytearray()
        for c in pixels[y * largura : (y + 1) * largura]:
            linha += struct.pack("<I", c & 0xFFFFFFFF) * escala
        linhas += (b"\x00" + bytes(linha)) * escala
    cabecalho = struct.pack(">IIBBBBB", largura * escala, altura * escala, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _bloco_png(b"IHDR", cabecalho) + _bloco_png(b"IDAT", zlib.compress(bytes(linhas), 9)) + _bloco_png(b"IEND", b"")


def gerar(formato, dados, nome):
    if formato == "c":
        return _gerar_c(dados, nome)
    if formato == "java":
        return _gerar_java(dados, nome)
    if formato == "json":
        return json.dumps({"nome": nome, **dados, **({"transparente": -1} if dados["modo"] == "indices" else {})}, ensure_ascii=False) + "\n"
    if formato == "csv":
        blocos = []
        for q in dados["quadros"]:
            blocos.append("\n".join(",".join("" if v is None else str(v) for v in linha) for linha in q))
        return "\n\n".join(blocos) + "\n"
    if formato == "js":
        quadros = ",\n".join("    [\n" + _linhas(q, "      ", "'", "null") + ",\n    ]" for q in dados["quadros"])
        paleta = ", ".join(f"'{c}'" for c in dados["paleta"])
        transparente = "  transparente: -1,\n" if dados["modo"] == "indices" else ""
        return (
            f"export const {identificador(nome)} = {{\n"
            f"  largura: {dados['largura']},\n  altura: {dados['altura']},\n{transparente}"
            f"  paleta: [{paleta}],\n  quadros: [\n{quadros},\n  ],\n}};\n"
        )
    if formato == "py":
        quadros = ",\n".join("        [\n" + _linhas(q, "            ", '"', "None") + ",\n        ]" for q in dados["quadros"])
        paleta = ", ".join(f'"{c}"' for c in dados["paleta"])
        transparente = '    "transparente": -1,\n' if dados["modo"] == "indices" else ""
        return (
            f"{identificador(nome, 'constante')} = {{\n"
            f'    "largura": {dados["largura"]},\n    "altura": {dados["altura"]},\n{transparente}'
            f'    "paleta": [{paleta}],\n    "quadros": [\n{quadros},\n    ],\n}}\n'
        )
    raise ValueError(f"Formato desconhecido: {formato}")
