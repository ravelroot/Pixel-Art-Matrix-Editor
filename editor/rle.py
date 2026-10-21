import base64
import struct
from array import array


class ErroRLE(ValueError):
    pass


def codificar(pixels):
    saida = bytearray()
    n = len(pixels)
    i = 0
    while i < n:
        cor = pixels[i]
        j = i + 1
        while j < n and pixels[j] == cor:
            j += 1
        corrida = j - i
        while corrida >= 128:
            saida.append((corrida & 127) | 128)
            corrida >>= 7
        saida.append(corrida)
        saida += struct.pack("<I", cor)
        i = j
    return bytes(saida)


def decodificar(dados, total):
    pixels = array("I", bytes(4 * total)) if total else array("I")
    p = 0
    i = 0
    n = len(dados)
    while p < n:
        corrida = 0
        deslocamento = 0
        while True:
            if p >= n:
                raise ErroRLE("RLE truncado")
            b = dados[p]
            p += 1
            corrida |= (b & 127) << deslocamento
            if b < 128:
                break
            deslocamento += 7
            if deslocamento > 35:
                raise ErroRLE("Corrida inválida")
        if p + 4 > n:
            raise ErroRLE("RLE truncado")
        cor = struct.unpack_from("<I", dados, p)[0]
        p += 4
        if i + corrida > total:
            raise ErroRLE("RLE maior que a matriz")
        if cor:
            pixels[i : i + corrida] = array("I", [cor]) * corrida
        i += corrida
    if i != total:
        raise ErroRLE("RLE menor que a matriz")
    return pixels


def de_base64(texto):
    try:
        return base64.b64decode(texto, validate=True)
    except (ValueError, TypeError) as erro:
        raise ErroRLE("Base64 inválido") from erro


def para_base64(dados):
    return base64.b64encode(dados).decode("ascii")


def canais(cor):
    return cor & 255, (cor >> 8) & 255, (cor >> 16) & 255, (cor >> 24) & 255


def empacotar(r, g, b, a=255):
    return (a << 24) | (b << 16) | (g << 8) | r


def sobrepor(fundo, frente, opacidade=1.0):
    fr, fg, fb, fa = canais(frente)
    sa = fa / 255 * opacidade
    if sa <= 0:
        return fundo
    br, bg, bb, ba = canais(fundo)
    da = ba / 255
    if sa >= 1:
        return frente
    if da == 0:
        return empacotar(fr, fg, fb, round(sa * 255))
    oa = sa + da * (1 - sa)

    def mistura(s, d):
        return round((s * sa + d * da * (1 - sa)) / oa)

    return empacotar(mistura(fr, br), mistura(fg, bg), mistura(fb, bb), round(oa * 255))


def compor(largura, altura, camadas):
    total = largura * altura
    destino = array("I", bytes(4 * total))
    for pixels, opacidade in camadas:
        if opacidade <= 0:
            continue
        for i, c in enumerate(pixels):
            if not c >> 24:
                continue
            if c >> 24 == 255 and opacidade >= 1:
                destino[i] = c
            else:
                destino[i] = sobrepor(destino[i], c, opacidade)
    return destino


def para_hex(cor):
    r, g, b, a = canais(cor)
    texto = f"#{r:02x}{g:02x}{b:02x}"
    return texto if a == 255 else texto + f"{a:02x}"
