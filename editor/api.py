import json
import logging
from functools import wraps

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.db import connection
from django.db.models import Count
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from . import export as exporter
from . import services
from .models import Palette, Project
from .rle import RLEError

log = logging.getLogger("crivo.api")

# Error messages ({"error": "..."}) are shown to the user by the editor, so they stay in Portuguese.


def error(message, status=400, **extra):
    return JsonResponse({"error": message, **extra}, status=status, json_dumps_params={"ensure_ascii": False})


def ok(data, status=200):
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


class BodyTooLarge(Exception):
    pass


class InvalidJson(services.ValidationError):
    pass


def read_json(request):
    try:
        body = request.body
    except RequestDataTooBig as e:
        raise BodyTooLarge() from e
    if not body:
        return {}
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise InvalidJson("Corpo da requisição não é um JSON válido.") from e
    except RecursionError as e:
        raise InvalidJson("O JSON está aninhado demais.") from e
    if not isinstance(data, dict):
        raise services.ValidationError("O corpo da requisição precisa ser um objeto JSON.")
    return data


def handle_errors(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except BodyTooLarge:
            return error(f"O corpo da requisição passa do limite de {settings.DATA_UPLOAD_MAX_MEMORY_SIZE // (1024 * 1024)} MB.", 413)
        except services.ValidationError as e:
            return error(str(e), 422)
        except services.Conflict as e:
            return error("O projeto foi salvo em outro lugar depois que você o abriu.", 409, current_revision=e.current_revision)
        except (Project.DoesNotExist, Palette.DoesNotExist):
            return error("Não encontrado.", 404)
        except (ValueError, RLEError) as e:
            return error(str(e), 400)

    return wrapper


@require_http_methods(["GET"])
def index(request):
    return ok(
        {
            "name": "Crivo",
            "version": settings.CRIVO["VERSION"],
            "routes": {
                "health": "/api/v2/health",
                "projects": "/api/v2/projects",
                "project": "/api/v2/projects/{id}",
                "thumbnail": "/api/v2/projects/{id}/thumbnail",
                "export": "/api/v2/projects/{id}/export?format=json|csv|js|py|c|java&mode=indices|hex&frame=all|N",
                "png": "/api/v2/projects/{id}/png?frame=N&scale=1..32",
                "revisions": "/api/v2/projects/{id}/revisions",
                "restore": "/api/v2/projects/{id}/revisions/{number}/restore",
                "palettes": "/api/v2/palettes",
                "palette": "/api/v2/palettes/{id}",
            },
        }
    )


@require_http_methods(["GET"])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        log.exception("Database unavailable")
        return error("Banco de dados indisponível.", 503, status="error")
    return ok({"status": "ok", "version": settings.CRIVO["VERSION"], "database": connection.vendor})


@require_http_methods(["GET", "POST"])
@handle_errors
def projects(request):
    if request.method == "POST":
        body = read_json(request)
        project = services.create_project(body.get("data"), body.get("thumbnail"), body.get("name"))
        return ok(services.project_summary(project), 201)
    queryset = Project.objects.annotate(frame_count=Count("frames", distinct=True), layer_count=Count("layers", distinct=True)).defer("thumbnail")
    search = request.GET.get("q", "").strip()
    if search:
        queryset = queryset.filter(name__icontains=search)
    ids_with_thumbnail = set(Project.objects.filter(thumbnail__isnull=False).values_list("pk", flat=True))
    items = [services.project_summary(p, {"frames": p.frame_count, "layers": p.layer_count}, has_thumbnail=p.pk in ids_with_thumbnail) for p in queryset[:500]]
    return ok({"projects": items})


@require_http_methods(["GET", "PUT", "DELETE"])
@handle_errors
def project(request, project_id):
    if request.method == "DELETE":
        Project.objects.get(pk=project_id).delete()
        return HttpResponse(status=204)
    if request.method == "PUT":
        body = read_json(request)
        p = services.update_project(project_id, body.get("data"), body.get("thumbnail"), body.get("revision"), body.get("name"))
        return ok(services.project_summary(p))
    p = Project.objects.get(pk=project_id)
    return ok({**services.project_summary(p), "data": services.document_from_db(p)})


@require_http_methods(["GET"])
@handle_errors
def thumbnail(request, project_id):
    p = Project.objects.only("thumbnail").get(pk=project_id)
    if not p.thumbnail:
        return error("Este projeto não tem miniatura.", 404)
    response = HttpResponse(bytes(p.thumbnail), content_type="image/png")
    response["Cache-Control"] = "no-cache"
    return response


@require_http_methods(["GET"])
@handle_errors
def export(request, project_id):
    fmt = request.GET.get("format", "json")
    mode = request.GET.get("mode", "indices")
    if fmt not in exporter.FORMATS:
        return error(f"Formato não suportado. Use: {', '.join(exporter.FORMATS)}.")
    if mode not in ("indices", "hex"):
        return error("Modo não suportado. Use indices ou hex.")
    p = Project.objects.get(pk=project_id)
    frame = request.GET.get("frame", "all")
    indices = None
    if frame != "all":
        if not frame.isdigit():
            return error("O quadro precisa ser 'all' ou um número.")
        n = int(frame)
        total = p.frames.count()
        if n < 1 or n > total:
            return error(f"Quadro fora do intervalo 1 a {total}.")
        indices = [n - 1]
    doc, frames = services.composite_pixels(p, indices)
    data = exporter.build_matrices(frames, doc["width"], doc["height"], mode)
    content_type, extension = exporter.FORMATS[fmt]
    response = HttpResponse(exporter.generate(fmt, data, p.name), content_type=f"{content_type}; charset=utf-8")
    if request.GET.get("download"):
        # A Java file must be named after its public class (PascalCase), or javac refuses it.
        base = exporter.identifier(p.name, "pascal" if fmt == "java" else "camel")
        response["Content-Disposition"] = f'attachment; filename="{base}.{extension}"'
    return response


@require_http_methods(["GET"])
@handle_errors
def png(request, project_id):
    frame = request.GET.get("frame", "1")
    scale = request.GET.get("scale", "1")
    if not frame.isdigit() or not scale.isdigit():
        return error("quadro e escala precisam ser números inteiros.")
    scale = int(scale)
    if not 1 <= scale <= 32:
        return error("A escala precisa ficar entre 1 e 32.")
    p = Project.objects.get(pk=project_id)
    total = p.frames.count()
    n = int(frame)
    if n < 1 or n > total:
        return error(f"Quadro fora do intervalo 1 a {total}.")
    doc, (pixels,) = services.composite_pixels(p, [n - 1])
    image = exporter.generate_png(pixels, doc["width"], doc["height"], scale)
    response = HttpResponse(image, content_type="image/png")
    response["Cache-Control"] = "no-cache"
    if request.GET.get("download"):
        response["Content-Disposition"] = f'attachment; filename="{exporter.identifier(p.name)}-{n}.png"'
    return response


@require_http_methods(["GET"])
@handle_errors
def revisions(request, project_id):
    p = Project.objects.get(pk=project_id)
    return ok(
        {
            "current_revision": p.revision,
            "revisions": [
                {"number": r.number, "name": r.name, "size_bytes": r.size_bytes, "created_at": r.created_at.isoformat()}
                for r in p.revisions.defer("content").order_by("-number")
            ],
        }
    )


@require_http_methods(["POST"])
@handle_errors
def restore(request, project_id, number):
    p = services.restore_revision(project_id, number)
    return ok(services.project_summary(p))


@require_http_methods(["GET", "POST"])
@handle_errors
def palettes(request):
    if request.method == "POST":
        return ok(services.palette_to_dict(services.save_palette(read_json(request))), 201)
    queryset = Palette.objects.prefetch_related("colors")
    if request.GET.get("presets") == "0":
        queryset = queryset.filter(preset=False)
    return ok({"palettes": [services.palette_to_dict(p) for p in queryset]})


@require_http_methods(["GET", "PUT", "DELETE"])
@handle_errors
def palette(request, palette_id):
    p = Palette.objects.get(pk=palette_id)
    if request.method == "GET":
        return ok(services.palette_to_dict(p))
    if p.preset:
        return error("As paletas predefinidas não podem ser alteradas. Crie uma cópia.", 403)
    if request.method == "DELETE":
        p.delete()
        return HttpResponse(status=204)
    return ok(services.palette_to_dict(services.save_palette(read_json(request), p)))
