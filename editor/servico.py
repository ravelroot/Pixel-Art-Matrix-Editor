import base64
import json
import re
import zlib

from django.conf import settings
from django.db import transaction

from .models import Camada, Celula, CorPaleta, Paleta, Projeto, Quadro, Revisao
from .rle import ErroRLE, compor, de_base64, decodificar, para_base64

HEX = re.compile(r"^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$")
PNG = b"\x89PNG\r\n\x1a\n"


class ErroValidacao(ValueError):
    pass


class Conflito(Exception):
    def __init__(self, revisao_atual):
        super().__init__("Revisão desatualizada")
        self.revisao_atual = revisao_atual


def _limites():
    return settings.CRIVO


def normalizar_hex(valor):
    m = HEX.match(str(valor or "").strip())
    if not m:
        raise ErroValidacao(f"Cor inválida: {valor!r}")
    texto = "#" + m.group(1).lower()
    if m.group(2) and m.group(2).lower() != "ff":
        texto += m.group(2).lower()
    return texto


def _inteiro(valor, nome, minimo, maximo):
    try:
        n = int(valor)
    except (TypeError, ValueError) as erro:
        raise ErroValidacao(f"{nome} precisa ser um número inteiro.") from erro
    if n < minimo or n > maximo:
        raise ErroValidacao(f"{nome} precisa ficar entre {minimo} e {maximo}.")
    return n


def _chave(valor, nome):
    texto = str(valor or "")
    if not texto or len(texto) > 40:
        raise ErroValidacao(f"Identificador inválido em {nome}.")
    return texto


def validar_documento(dados):
    if not isinstance(dados, dict) or dados.get("formato") != "crivo":
        raise ErroValidacao("O campo 'dados' precisa ser um projeto no formato do Crivo.")
    lim = _limites()
    largura = _inteiro(dados.get("largura"), "largura", 1, lim["LIMITE_LADO"])
    altura = _inteiro(dados.get("altura"), "altura", 1, lim["LIMITE_LADO"])
    fps = _inteiro(dados.get("fps", 8), "fps", 1, 60)
    camadas = dados.get("camadas") or []
    quadros = dados.get("quadros") or []
    if not isinstance(camadas, list) or not 1 <= len(camadas) <= lim["LIMITE_CAMADAS"]:
        raise ErroValidacao(f"O projeto precisa de 1 a {lim['LIMITE_CAMADAS']} camadas.")
    if not isinstance(quadros, list) or not 1 <= len(quadros) <= lim["LIMITE_QUADROS"]:
        raise ErroValidacao(f"O projeto precisa de 1 a {lim['LIMITE_QUADROS']} quadros.")
    chaves = set()
    camadas_ok = []
    for c in camadas:
        chave = _chave(c.get("id"), "camadas")
        if chave in chaves:
            raise ErroValidacao("Identificadores repetidos entre camadas e quadros.")
        chaves.add(chave)
        camadas_ok.append(
            {
                "id": chave,
                "nome": str(c.get("nome") or "Camada")[:80],
                "visivel": c.get("visivel") is not False,
                "opacidade": _inteiro(c.get("opacidade", 100), "opacidade", 0, 100),
                "bloqueada": bool(c.get("bloqueada")),
            }
        )
    quadros_ok = []
    for q in quadros:
        chave = _chave(q.get("id"), "quadros")
        if chave in chaves:
            raise ErroValidacao("Identificadores repetidos entre camadas e quadros.")
        chaves.add(chave)
        duracao = q.get("duracao")
        quadros_ok.append({"id": chave, "duracao": _inteiro(duracao, "duração", 1, 60000) if duracao else None})
    ids_camadas = {c["id"] for c in camadas_ok}
    ids_quadros = {q["id"] for q in quadros_ok}
    celulas_ok = []
    vistas = set()
    for cel in dados.get("celulas") or []:
        q, c = cel.get("quadro"), cel.get("camada")
        if q not in ids_quadros or c not in ids_camadas or (q, c) in vistas:
            raise ErroValidacao("Célula aponta para um quadro ou camada que não existe.")
        vistas.add((q, c))
        try:
            bruto = de_base64(cel.get("rle") or "")
            decodificar(bruto, largura * altura)
        except ErroRLE as erro:
            raise ErroValidacao(f"Pixels inválidos: {erro}") from erro
        celulas_ok.append({"quadro": q, "camada": c, "pixels": bruto})
    paleta = [normalizar_hex(c) for c in (dados.get("paleta") or [])[:256]]
    return {
        "nome": str(dados.get("nome") or "Sem título").strip()[:120] or "Sem título",
        "largura": largura,
        "altura": altura,
        "fps": fps,
        "paleta": paleta,
        "camadas": camadas_ok,
        "quadros": quadros_ok,
        "celulas": celulas_ok,
    }


def ler_miniatura(valor):
    if not valor:
        return None
    texto = str(valor)
    if texto.startswith("data:"):
        if not texto.startswith("data:image/png;base64,"):
            raise ErroValidacao("A miniatura precisa ser PNG.")
        texto = texto.split(",", 1)[1]
    try:
        bruto = base64.b64decode(texto, validate=True)
    except ValueError as erro:
        raise ErroValidacao("Miniatura inválida.") from erro
    if not bruto.startswith(PNG):
        raise ErroValidacao("A miniatura precisa ser PNG.")
    if len(bruto) > _limites()["LIMITE_MINIATURA"]:
        raise ErroValidacao("Miniatura grande demais.")
    return bruto


def documento_do_banco(projeto):
    camadas = list(projeto.camadas.all())
    quadros = list(projeto.quadros.all())
    mapa_c = {c.pk: c.chave for c in camadas}
    mapa_q = {q.pk: q.chave for q in quadros}
    celulas = sorted(
        Celula.objects.filter(quadro__projeto=projeto).values_list("quadro_id", "camada_id", "pixels"),
        key=lambda t: (t[0], t[1]),
    )
    return {
        "formato": "crivo",
        "versao": projeto.versao_formato,
        "nome": projeto.nome,
        "largura": projeto.largura,
        "altura": projeto.altura,
        "fps": projeto.fps,
        "paleta": projeto.paleta,
        "camadas": [
            {"id": c.chave, "nome": c.nome, "visivel": c.visivel, "opacidade": c.opacidade, "bloqueada": c.bloqueada} for c in camadas
        ],
        "quadros": [{"id": q.chave, "duracao": q.duracao_ms} for q in quadros],
        "celulas": [{"quadro": mapa_q[q], "camada": mapa_c[c], "rle": para_base64(bytes(px))} for q, c, px in celulas],
    }


def _gravar_conteudo(projeto, doc):
    projeto.quadros.all().delete()
    projeto.camadas.all().delete()
    camadas = Camada.objects.bulk_create(
        [
            Camada(projeto=projeto, chave=c["id"], posicao=i, nome=c["nome"], visivel=c["visivel"], opacidade=c["opacidade"], bloqueada=c["bloqueada"])
            for i, c in enumerate(doc["camadas"])
        ]
    )
    quadros = Quadro.objects.bulk_create(
        [Quadro(projeto=projeto, chave=q["id"], posicao=i, duracao_ms=q["duracao"]) for i, q in enumerate(doc["quadros"])]
    )
    por_c = {c.chave: c for c in camadas}
    por_q = {q.chave: q for q in quadros}
    Celula.objects.bulk_create(
        [
            Celula(quadro=por_q[cel["quadro"]], camada=por_c[cel["camada"]], pixels=cel["pixels"], tamanho_bytes=len(cel["pixels"]))
            for cel in doc["celulas"]
        ],
        batch_size=200,
    )


def _guardar_revisao(projeto):
    conteudo = zlib.compress(json.dumps(documento_do_banco(projeto), separators=(",", ":")).encode("utf-8"), 6)
    Revisao.objects.create(projeto=projeto, numero=projeto.revisao, nome=projeto.nome, conteudo=conteudo, tamanho_bytes=len(conteudo))
    excedentes = list(projeto.revisoes.order_by("-numero").values_list("pk", flat=True)[_limites()["MAX_REVISOES"] :])
    if excedentes:
        Revisao.objects.filter(pk__in=excedentes).delete()


@transaction.atomic
def criar_projeto(dados, miniatura=None, nome=None):
    doc = validar_documento(dados)
    projeto = Projeto.objects.create(
        nome=(nome or doc["nome"])[:120],
        largura=doc["largura"],
        altura=doc["altura"],
        fps=doc["fps"],
        paleta=doc["paleta"],
        miniatura=ler_miniatura(miniatura),
    )
    _gravar_conteudo(projeto, doc)
    return projeto


@transaction.atomic
def atualizar_projeto(projeto_id, dados, miniatura=None, revisao=None, nome=None):
    doc = validar_documento(dados)
    projeto = Projeto.objects.select_for_update().get(pk=projeto_id)
    if revisao is not None and int(revisao) != projeto.revisao:
        raise Conflito(projeto.revisao)
    _guardar_revisao(projeto)
    projeto.nome = (nome or doc["nome"])[:120]
    projeto.largura = doc["largura"]
    projeto.altura = doc["altura"]
    projeto.fps = doc["fps"]
    projeto.paleta = doc["paleta"]
    projeto.revisao += 1
    nova = ler_miniatura(miniatura)
    if nova:
        projeto.miniatura = nova
    projeto.save()
    _gravar_conteudo(projeto, doc)
    return projeto


@transaction.atomic
def restaurar_revisao(projeto_id, numero):
    projeto = Projeto.objects.select_for_update().get(pk=projeto_id)
    revisao = projeto.revisoes.get(numero=numero)
    dados = json.loads(zlib.decompress(bytes(revisao.conteudo)).decode("utf-8"))
    return atualizar_projeto(projeto.pk, dados, revisao=projeto.revisao)


def pixels_compostos(projeto, indices=None):
    doc = documento_do_banco(projeto)
    total = doc["largura"] * doc["altura"]
    celulas = {(c["quadro"], c["camada"]): decodificar(de_base64(c["rle"]), total) for c in doc["celulas"]}
    quadros = doc["quadros"] if indices is None else [doc["quadros"][i] for i in indices]
    saida = []
    for q in quadros:
        camadas = [
            (celulas[(q["id"], c["id"])], c["opacidade"] / 100)
            for c in doc["camadas"]
            if c["visivel"] and (q["id"], c["id"]) in celulas
        ]
        saida.append(compor(doc["largura"], doc["altura"], camadas))
    return doc, saida


def resumo_projeto(projeto, contagens=None):
    return {
        "id": str(projeto.pk),
        "nome": projeto.nome,
        "largura": projeto.largura,
        "altura": projeto.altura,
        "fps": projeto.fps,
        "revisao": projeto.revisao,
        "quadros": contagens["quadros"] if contagens else projeto.quadros.count(),
        "camadas": contagens["camadas"] if contagens else projeto.camadas.count(),
        "miniatura_url": f"/api/v1/projetos/{projeto.pk}/miniatura" if projeto.miniatura else None,
        "criado_em": projeto.criado_em.isoformat(),
        "atualizado_em": projeto.atualizado_em.isoformat(),
    }


def paleta_para_dict(p):
    return {
        "id": str(p.pk),
        "slug": p.slug,
        "nome": p.nome,
        "descricao": p.descricao,
        "predefinida": p.predefinida,
        "cores": [c.hex for c in p.cores.all()],
        "atualizado_em": p.atualizado_em.isoformat(),
    }


@transaction.atomic
def salvar_paleta(dados, paleta=None):
    nome = str(dados.get("nome") or "").strip()[:80]
    if not nome:
        raise ErroValidacao("Dê um nome para a paleta.")
    cores = dados.get("cores")
    if not isinstance(cores, list) or not 1 <= len(cores) <= 256:
        raise ErroValidacao("A paleta precisa de 1 a 256 cores.")
    cores = [normalizar_hex(c) for c in cores]
    if paleta is None:
        paleta = Paleta.objects.create(nome=nome)
    else:
        paleta.nome = nome
        paleta.save()
        paleta.cores.all().delete()
    CorPaleta.objects.bulk_create([CorPaleta(paleta=paleta, posicao=i, hex=c) for i, c in enumerate(cores)])
    return paleta
