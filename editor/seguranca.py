import hmac

from django.conf import settings


class TokenDaApiMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = settings.CRIVO.get("TOKEN_API")
        cabecalho = request.headers.get("Authorization", "")
        if token and request.path.startswith("/api/") and cabecalho.startswith("Bearer "):
            if hmac.compare_digest(cabecalho[7:].strip(), token):
                request._dont_enforce_csrf_checks = True
        return self.get_response(request)
