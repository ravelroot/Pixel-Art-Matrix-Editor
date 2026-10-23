from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET

PAGE = Path(__file__).resolve().parent / "static" / "editor" / "index.html"


def _build_page():
    html = PAGE.read_text(encoding="utf-8")
    return html.replace('<base href="./">', f'<base href="{settings.STATIC_URL}editor/">', 1)


@lru_cache(maxsize=1)
def _cached_page():
    return _build_page()


@require_GET
@ensure_csrf_cookie
def home(request):
    html = _build_page() if settings.DEBUG else _cached_page()
    response = HttpResponse(html, content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    return response
