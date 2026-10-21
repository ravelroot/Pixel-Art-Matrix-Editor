import json
import re
import unicodedata

from .rle import para_hex

FORMATOS = {
    "json": ("application/json", "json"),
    "csv": ("text/csv", "csv"),
    "js": ("text/javascript", "js"),
    "py": ("text/x-python", "py"),
}


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


def gerar(formato, dados, nome):
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
