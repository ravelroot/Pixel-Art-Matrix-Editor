def _colors(text):
    return ["#" + h.lower() for h in text.split()]


# Names and descriptions are shown in the editor, so they stay in Portuguese.
PRESET_PALETTES = [
    {
        "slug": "crivo",
        "name": "Crivo",
        "description": "A paleta do projeto: vinho, ardósia, café, linho, oliva, rosé e palha.",
        "colors": _colors("5d1c16 a3b4be 5c4034 e6ddce 7a6e46 d6bdb8 f6e4a6 000000 ffffff"),
    },
    {
        "slug": "game-boy",
        "name": "Game Boy",
        "description": "Os quatro verdes da tela do Game Boy original (DMG-01).",
        "colors": _colors("0f380f 306230 8bac0f 9bbc0f"),
    },
    {
        "slug": "nes",
        "name": "NES",
        "description": "As cores únicas da paleta do NES (PPU 2C02), sem as repetições de preto.",
        "colors": _colors(
            "7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000 "
            "bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888 "
            "f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878 "
            "fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8"
        ),
    },
    {
        "slug": "pico-8",
        "name": "Pico-8",
        "description": "As 16 cores do console de fantasia Pico-8.",
        "colors": _colors("000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa"),
    },
    {
        "slug": "cga",
        "name": "CGA",
        "description": "As 16 cores do adaptador gráfico CGA da IBM.",
        "colors": _colors("000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff"),
    },
    {
        "slug": "cga-modo-4",
        "name": "CGA (modo 4, alta intensidade)",
        "description": "A paleta de quatro cores mais famosa dos jogos CGA: preto, ciano, magenta e branco.",
        "colors": _colors("000000 55ffff ff55ff ffffff"),
    },
    {
        "slug": "commodore-64",
        "name": "Commodore 64",
        "description": "As 16 cores do VIC-II do Commodore 64.",
        "colors": _colors("000000 ffffff 880000 aaffee cc44cc 00cc55 0000aa eeee77 dd8855 664400 ff7777 333333 777777 aaff66 0088ff bbbbbb"),
    },
    {
        "slug": "1-bit",
        "name": "1 bit",
        "description": "Preto e branco puros, para ícones e telas monocromáticas.",
        "colors": _colors("000000 ffffff"),
    },
]


def sync_presets(Palette, PaletteColor):
    """Create or update the preset palettes.

    Takes the model classes so a data migration can pass its historical models. It uses the English schema
    (migration 0003 onwards); migration 0002 keeps its own frozen copy for the 1.x field names. Nothing calls
    this at startup: when the presets change, add a data migration that calls it.
    """
    for preset in PRESET_PALETTES:
        palette, _ = Palette.objects.update_or_create(
            slug=preset["slug"],
            defaults={"name": preset["name"], "description": preset["description"], "preset": True},
        )
        PaletteColor.objects.filter(palette=palette).delete()
        PaletteColor.objects.bulk_create([PaletteColor(palette=palette, position=i, hex=c) for i, c in enumerate(preset["colors"])])
