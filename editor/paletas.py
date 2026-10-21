def _cores(texto):
    return ["#" + h.lower() for h in texto.split()]


PALETAS_PREDEFINIDAS = [
    {
        "slug": "crivo",
        "nome": "Crivo",
        "descricao": "A paleta do projeto: vinho, ardósia, café, linho, oliva, rosé e palha.",
        "cores": _cores("5d1c16 a3b4be 5c4034 e6ddce 7a6e46 d6bdb8 f6e4a6 000000 ffffff"),
    },
    {
        "slug": "game-boy",
        "nome": "Game Boy",
        "descricao": "Os quatro verdes da tela do Game Boy original (DMG-01).",
        "cores": _cores("0f380f 306230 8bac0f 9bbc0f"),
    },
    {
        "slug": "nes",
        "nome": "NES",
        "descricao": "As cores únicas da paleta do NES (PPU 2C02), sem as repetições de preto.",
        "cores": _cores(
            "7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000 "
            "bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888 "
            "f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878 "
            "fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8"
        ),
    },
    {
        "slug": "pico-8",
        "nome": "Pico-8",
        "descricao": "As 16 cores do console de fantasia Pico-8.",
        "cores": _cores("000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa"),
    },
    {
        "slug": "cga",
        "nome": "CGA",
        "descricao": "As 16 cores do adaptador gráfico CGA da IBM.",
        "cores": _cores("000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff"),
    },
    {
        "slug": "cga-modo-4",
        "nome": "CGA (modo 4, alta intensidade)",
        "descricao": "A paleta de quatro cores mais famosa dos jogos CGA: preto, ciano, magenta e branco.",
        "cores": _cores("000000 55ffff ff55ff ffffff"),
    },
    {
        "slug": "commodore-64",
        "nome": "Commodore 64",
        "descricao": "As 16 cores do VIC-II do Commodore 64.",
        "cores": _cores("000000 ffffff 880000 aaffee cc44cc 00cc55 0000aa eeee77 dd8855 664400 ff7777 333333 777777 aaff66 0088ff bbbbbb"),
    },
    {
        "slug": "1-bit",
        "nome": "1 bit",
        "descricao": "Preto e branco puros, para ícones e telas monocromáticas.",
        "cores": _cores("000000 ffffff"),
    },
]


def sincronizar_predefinidas(Paleta, CorPaleta):
    for p in PALETAS_PREDEFINIDAS:
        paleta, _ = Paleta.objects.update_or_create(
            slug=p["slug"],
            defaults={"nome": p["nome"], "descricao": p["descricao"], "predefinida": True},
        )
        CorPaleta.objects.filter(paleta=paleta).delete()
        CorPaleta.objects.bulk_create([CorPaleta(paleta=paleta, posicao=i, hex=c) for i, c in enumerate(p["cores"])])
