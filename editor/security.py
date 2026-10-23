import hmac
import threading
import time
from collections import deque

from django.conf import settings
from django.http import JsonResponse

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

CONTENT_SECURITY_POLICY = "; ".join(
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

PERMISSIONS_POLICY = ", ".join(
    f"{feature}=()"
    for feature in ("camera", "microphone", "geolocation", "payment", "usb", "serial", "bluetooth", "midi", "magnetometer", "gyroscope", "accelerometer")
)


class ApiTokenMiddleware:
    """Scripts can change data through the API with `Authorization: Bearer <CRIVO_API_TOKEN>` instead of the CSRF cookie."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = settings.CRIVO.get("API_TOKEN")
        header = request.headers.get("Authorization", "")
        if token and request.path.startswith("/api/") and header.startswith("Bearer ") and hmac.compare_digest(header[7:].strip().encode(), token.encode()):
            request._dont_enforce_csrf_checks = True
        return self.get_response(request)


class SecurityHeadersMiddleware:
    """Defensive headers on every response: CSP, Permissions-Policy and origin isolation."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        response.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        response.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.setdefault("X-Content-Type-Options", "nosniff")
        if request.path.startswith("/api/") and response.get("Content-Type", "").startswith("application/json"):
            response["Cache-Control"] = "no-store"
        return response


def client_ip(request):
    """IP address of the client. Behind a trusted proxy (CRIVO_TRUSTED_PROXY=true) it uses the last X-Forwarded-For
    address, the one the proxy itself appended, which the client cannot forge."""
    if settings.CRIVO.get("TRUSTED_PROXY"):
        forwarded = [part.strip() for part in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if part.strip()]
        if forwarded:
            return forwarded[-1]
    return request.META.get("REMOTE_ADDR", "") or "unknown"


class WriteLimitMiddleware:
    """Limits POST/PUT/PATCH/DELETE on the API per IP in a 60-second sliding window (CRIVO_WRITE_LIMIT; 0 turns it off).

    It sits after CsrfViewMiddleware and acts in process_view: requests already refused by the CSRF check (for example,
    forged by another site) do not use up anyone's quota. Counting is done separately in each server process."""

    WINDOW = 60.0
    # Shared by every instance in the process (Django creates one per handler).
    history = {}
    lock = threading.Lock()

    def __init__(self, get_response):
        self.get_response = get_response

    @classmethod
    def reset(cls):
        with cls.lock:
            cls.history.clear()

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        limit = int(settings.CRIVO.get("WRITE_LIMIT", 0) or 0)
        if limit > 0 and request.method in WRITE_METHODS and request.path.startswith("/api/"):
            now = time.monotonic()
            ip = client_ip(request)
            with self.lock:
                queue = self.history.setdefault(ip, deque())
                while queue and now - queue[0] > self.WINDOW:
                    queue.popleft()
                if len(queue) >= limit:
                    wait = max(1, int(self.WINDOW - (now - queue[0])) + 1)
                    response = JsonResponse(
                        {"error": "Muitas alterações seguidas. Tente de novo em instantes.", "retry_after_seconds": wait},
                        status=429,
                        json_dumps_params={"ensure_ascii": False},
                    )
                    response["Retry-After"] = str(wait)
                    return response
                queue.append(now)
                if len(self.history) > 10000:
                    for key in [k for k, v in self.history.items() if not v or now - v[-1] > self.WINDOW]:
                        del self.history[key]
        return None
