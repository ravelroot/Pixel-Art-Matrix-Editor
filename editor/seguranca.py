import hmac
import threading
import time
from collections import deque

from django.conf import settings
from django.http import JsonResponse

METODOS_DE_ESCRITA = {"POST", "PUT", "PATCH", "DELETE"}

POLITICA_DE_CONTEUDO = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

POLITICA_DE_PERMISSOES = ", ".join(
    f"{recurso}=()"
    for recurso in ("camera", "microphone", "geolocation", "payment", "usb", "serial", "bluetooth", "midi", "magnetometer", "gyroscope", "accelerometer")
)


class TokenDaApiMiddleware:
    """Scripts podem alterar dados pela API com `Authorization: Bearer <CRIVO_API_TOKEN>` em vez do cookie CSRF."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = settings.CRIVO.get("TOKEN_API")
        cabecalho = request.headers.get("Authorization", "")
        if (
            token
            and request.path.startswith("/api/")
            and cabecalho.startswith("Bearer ")
            and hmac.compare_digest(cabecalho[7:].strip().encode(), token.encode())
        ):
            request._dont_enforce_csrf_checks = True
        return self.get_response(request)


class CabecalhosDeSegurancaMiddleware:
    """Cabeçalhos de defesa em todas as respostas: CSP, Permissions-Policy e isolamento de origem."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resposta = self.get_response(request)
        resposta.setdefault("Content-Security-Policy", POLITICA_DE_CONTEUDO)
        resposta.setdefault("Permissions-Policy", POLITICA_DE_PERMISSOES)
        resposta.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        resposta.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        resposta.setdefault("X-Content-Type-Options", "nosniff")
        if request.path.startswith("/api/") and resposta.get("Content-Type", "").startswith("application/json"):
            resposta["Cache-Control"] = "no-store"
        return resposta


def ip_do_cliente(request):
    """IP de quem fez o pedido. Atrás de um proxy confiável (CRIVO_PROXY_CONFIAVEL=true), usa o último endereço
    de X-Forwarded-For, que é o que o próprio proxy acrescentou e o cliente não consegue forjar."""
    if settings.CRIVO.get("PROXY_CONFIAVEL"):
        encaminhado = [parte.strip() for parte in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if parte.strip()]
        if encaminhado:
            return encaminhado[-1]
    return request.META.get("REMOTE_ADDR", "") or "desconhecido"


class LimiteDeEscritasMiddleware:
    """Limita POST/PUT/PATCH/DELETE na API por IP numa janela deslizante de 60 segundos (CRIVO_LIMITE_ESCRITAS; 0 desliga).

    Fica depois do CsrfViewMiddleware e age em process_view: pedidos já recusados pelo CSRF (por exemplo, forjados
    por outro site) não gastam a cota de ninguém. A contagem é feita em cada processo do servidor."""

    JANELA = 60.0
    # Compartilhados por todas as instâncias do processo (o Django cria uma por handler).
    historico = {}
    trava = threading.Lock()

    def __init__(self, get_response):
        self.get_response = get_response

    @classmethod
    def reiniciar(cls):
        with cls.trava:
            cls.historico.clear()

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        limite = int(settings.CRIVO.get("LIMITE_ESCRITAS", 0) or 0)
        if limite > 0 and request.method in METODOS_DE_ESCRITA and request.path.startswith("/api/"):
            agora = time.monotonic()
            ip = ip_do_cliente(request)
            with self.trava:
                fila = self.historico.setdefault(ip, deque())
                while fila and agora - fila[0] > self.JANELA:
                    fila.popleft()
                if len(fila) >= limite:
                    espera = max(1, int(self.JANELA - (agora - fila[0])) + 1)
                    resposta = JsonResponse(
                        {"erro": "Muitas alterações seguidas. Tente de novo em instantes.", "tentar_em_segundos": espera},
                        status=429,
                        json_dumps_params={"ensure_ascii": False},
                    )
                    resposta["Retry-After"] = str(espera)
                    return resposta
                fila.append(agora)
                if len(self.historico) > 10000:
                    for chave in [k for k, v in self.historico.items() if not v or agora - v[-1] > self.JANELA]:
                        del self.historico[chave]
        return None
