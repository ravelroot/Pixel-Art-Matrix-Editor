import json
import logging
from functools import wraps

from django.conf import settings
from django.db import connection
from django.db.models import Count
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from . import exportacao, servico
from .models import Paleta, Projeto
from .rle import ErroRLE

log = logging.getLogger("crivo.api")


def erro(mensagem, status=400, **extra):
    return JsonResponse({"erro": mensagem, **extra}, status=status, json_dumps_params={"ensure_ascii": False})


def ok(dados, status=200):
    return JsonResponse(dados, status=status, json_dumps_params={"ensure_ascii": False})


def ler_json(request):
    if not request.body:
        return {}
    try:
        dados = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise servico.ErroValidacao("Corpo da requisição não é um JSON válido.") from e
    if not isinstance(dados, dict):
        raise servico.ErroValidacao("O corpo da requisição precisa ser um objeto JSON.")
    return dados


def tratar_erros(view):
    @wraps(view)
    def envoltorio(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except servico.ErroValidacao as e:
            return erro(str(e), 422)
        except servico.Conflito as e:
            return erro("O projeto foi salvo em outro lugar depois que você o abriu.", 409, revisao_atual=e.revisao_atual)
        except (Projeto.DoesNotExist, Paleta.DoesNotExist):
            return erro("Não encontrado.", 404)
        except (ValueError, ErroRLE) as e:
            return erro(str(e), 400)

    return envoltorio


@require_http_methods(["GET"])
def indice(request):
    return ok(
        {
            "nome": "Crivo",
            "versao": settings.CRIVO["VERSAO"],
            "rotas": {
                "saude": "/api/v1/saude",
                "projetos": "/api/v1/projetos",
                "projeto": "/api/v1/projetos/{id}",
                "miniatura": "/api/v1/projetos/{id}/miniatura",
                "exportar": "/api/v1/projetos/{id}/exportar?formato=json|csv|js|py&modo=indices|hex&quadro=todos|N",
                "revisoes": "/api/v1/projetos/{id}/revisoes",
                "restaurar": "/api/v1/projetos/{id}/revisoes/{numero}/restaurar",
                "paletas": "/api/v1/paletas",
                "paleta": "/api/v1/paletas/{id}",
            },
        }
    )


@require_http_methods(["GET"])
def saude(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        log.exception("Banco indisponível")
        return erro("Banco de dados indisponível.", 503, status="erro")
    return ok({"status": "ok", "versao": settings.CRIVO["VERSAO"], "banco": connection.vendor})


@require_http_methods(["GET", "POST"])
@tratar_erros
def projetos(request):
    if request.method == "POST":
        corpo = ler_json(request)
        projeto = servico.criar_projeto(corpo.get("dados"), corpo.get("miniatura"), corpo.get("nome"))
        return ok(servico.resumo_projeto(projeto), 201)
    lista = Projeto.objects.annotate(n_quadros=Count("quadros", distinct=True), n_camadas=Count("camadas", distinct=True)).defer("miniatura")
    busca = request.GET.get("q", "").strip()
    if busca:
        lista = lista.filter(nome__icontains=busca)
    ids_com_miniatura = set(Projeto.objects.filter(miniatura__isnull=False).values_list("pk", flat=True))
    itens = []
    for p in lista[:500]:
        resumo = servico.resumo_projeto(p, {"quadros": p.n_quadros, "camadas": p.n_camadas})
        resumo["miniatura_url"] = f"/api/v1/projetos/{p.pk}/miniatura" if p.pk in ids_com_miniatura else None
        itens.append(resumo)
    return ok({"projetos": itens})


@require_http_methods(["GET", "PUT", "DELETE"])
@tratar_erros
def projeto(request, projeto_id):
    if request.method == "DELETE":
        Projeto.objects.get(pk=projeto_id).delete()
        return HttpResponse(status=204)
    if request.method == "PUT":
        corpo = ler_json(request)
        p = servico.atualizar_projeto(projeto_id, corpo.get("dados"), corpo.get("miniatura"), corpo.get("revisao"), corpo.get("nome"))
        return ok(servico.resumo_projeto(p))
    p = Projeto.objects.get(pk=projeto_id)
    return ok({**servico.resumo_projeto(p), "dados": servico.documento_do_banco(p)})


@require_http_methods(["GET"])
@tratar_erros
def miniatura(request, projeto_id):
    p = Projeto.objects.only("miniatura").get(pk=projeto_id)
    if not p.miniatura:
        return erro("Este projeto não tem miniatura.", 404)
    resposta = HttpResponse(bytes(p.miniatura), content_type="image/png")
    resposta["Cache-Control"] = "no-cache"
    return resposta


@require_http_methods(["GET"])
@tratar_erros
def exportar(request, projeto_id):
    formato = request.GET.get("formato", "json")
    modo = request.GET.get("modo", "indices")
    if formato not in exportacao.FORMATOS:
        return erro(f"Formato não suportado. Use: {', '.join(exportacao.FORMATOS)}.")
    if modo not in ("indices", "hex"):
        return erro("Modo não suportado. Use indices ou hex.")
    p = Projeto.objects.get(pk=projeto_id)
    quadro = request.GET.get("quadro", "todos")
    indices = None
    if quadro != "todos":
        n = int(quadro)
        total = p.quadros.count()
        if n < 1 or n > total:
            return erro(f"Quadro fora do intervalo 1 a {total}.")
        indices = [n - 1]
    doc, quadros = servico.pixels_compostos(p, indices)
    dados = exportacao.montar_matrizes(quadros, doc["largura"], doc["altura"], modo)
    tipo, extensao = exportacao.FORMATOS[formato]
    resposta = HttpResponse(exportacao.gerar(formato, dados, p.nome), content_type=f"{tipo}; charset=utf-8")
    if request.GET.get("baixar"):
        resposta["Content-Disposition"] = f'attachment; filename="{exportacao.identificador(p.nome)}.{extensao}"'
    return resposta


@require_http_methods(["GET"])
@tratar_erros
def revisoes(request, projeto_id):
    p = Projeto.objects.get(pk=projeto_id)
    return ok(
        {
            "revisao_atual": p.revisao,
            "revisoes": [
                {"numero": r.numero, "nome": r.nome, "tamanho_bytes": r.tamanho_bytes, "criado_em": r.criado_em.isoformat()}
                for r in p.revisoes.defer("conteudo").order_by("-numero")
            ],
        }
    )


@require_http_methods(["POST"])
@tratar_erros
def restaurar(request, projeto_id, numero):
    p = servico.restaurar_revisao(projeto_id, numero)
    return ok(servico.resumo_projeto(p))


@require_http_methods(["GET", "POST"])
@tratar_erros
def paletas(request):
    if request.method == "POST":
        return ok(servico.paleta_para_dict(servico.salvar_paleta(ler_json(request))), 201)
    lista = Paleta.objects.prefetch_related("cores")
    if request.GET.get("predefinidas") == "0":
        lista = lista.filter(predefinida=False)
    return ok({"paletas": [servico.paleta_para_dict(p) for p in lista]})


@require_http_methods(["GET", "PUT", "DELETE"])
@tratar_erros
def paleta(request, paleta_id):
    p = Paleta.objects.get(pk=paleta_id)
    if request.method == "GET":
        return ok(servico.paleta_para_dict(p))
    if p.predefinida:
        return erro("As paletas predefinidas não podem ser alteradas. Crie uma cópia.", 403)
    if request.method == "DELETE":
        p.delete()
        return HttpResponse(status=204)
    return ok(servico.paleta_para_dict(servico.salvar_paleta(ler_json(request), p)))
