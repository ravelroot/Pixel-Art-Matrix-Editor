from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET

PAGINA = Path(__file__).resolve().parent / "static" / "editor" / "index.html"


def _montar_pagina():
    html = PAGINA.read_text(encoding="utf-8")
    return html.replace('<base href="./">', f'<base href="{settings.STATIC_URL}editor/">', 1)


@lru_cache(maxsize=1)
def _pagina_em_cache():
    return _montar_pagina()


@require_GET
@ensure_csrf_cookie
def inicio(request):
    html = _montar_pagina() if settings.DEBUG else _pagina_em_cache()
    resposta = HttpResponse(html, content_type="text/html; charset=utf-8")
    resposta["Cache-Control"] = "no-cache"
    return resposta
