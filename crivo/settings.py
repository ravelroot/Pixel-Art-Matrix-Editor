import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# Environment variables renamed in 2.0.0 (new name -> 1.x name). The old name is still read as a fallback,
# and editor.apps reports it as deprecated through a system check (crivo.W001).
LEGACY_ENV_NAMES = {
    "CRIVO_MAX_UPLOAD_MB": "CRIVO_TAMANHO_MAXIMO_MB",
    "CRIVO_HSTS_SECONDS": "CRIVO_HSTS_SEGUNDOS",
    "CRIVO_HSTS_SUBDOMAINS": "CRIVO_HSTS_SUBDOMINIOS",
    "CRIVO_HTTPS_REDIRECT": "CRIVO_REDIRECIONAR_HTTPS",
    "CRIVO_MAX_REVISIONS": "CRIVO_MAX_REVISOES",
    "CRIVO_WRITE_LIMIT": "CRIVO_LIMITE_ESCRITAS",
    "CRIVO_TRUSTED_PROXY": "CRIVO_PROXY_CONFIAVEL",
}

# (old name, new name) for every deprecated variable that was actually used to configure this process.
DEPRECATED_ENV_VARS = []


def env(name, default=None):
    value = os.environ.get(name)
    if (value is None or value == "") and name in LEGACY_ENV_NAMES:
        legacy_name = LEGACY_ENV_NAMES[name]
        value = os.environ.get(legacy_name)
        if value is not None and value != "":
            DEPRECATED_ENV_VARS.append((legacy_name, name))
    return default if value is None or value == "" else value


def env_bool(name, default=False):
    return str(env(name, str(default))).strip().lower() in {"1", "true", "sim", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in str(env(name, default)).split(",") if item.strip()]


VERSION = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip() if (BASE_DIR / "VERSION").exists() else "2.2.0"

DEVELOPMENT_KEY = "crivo-chave-local-de-desenvolvimento-troque-em-producao"
EXAMPLE_KEYS = {DEVELOPMENT_KEY, "troque-esta-chave"}

DEBUG = env_bool("CRIVO_DEBUG", True)
SECRET_KEY = env("CRIVO_SECRET_KEY", DEVELOPMENT_KEY)

if not DEBUG and (SECRET_KEY in EXAMPLE_KEYS or len(SECRET_KEY) < 32):
    raise ImproperlyConfigured(
        "CRIVO_SECRET_KEY insegura: com CRIVO_DEBUG=false defina uma chave aleatória com pelo menos 32 caracteres "
        "(os scripts start.sh e start.cmd geram uma no .env)."
    )
ALLOWED_HOSTS = env_list("CRIVO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_list("CRIVO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "editor",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "editor.security.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "editor.security.ApiTokenMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "editor.security.WriteLimitMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "crivo.urls"
WSGI_APPLICATION = "crivo.wsgi.application"
ASGI_APPLICATION = "crivo.asgi.application"

TEMPLATES = []

if env("CRIVO_DB_ENGINE", "sqlite") == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("CRIVO_DB_NAME", "crivo"),
            "USER": env("CRIVO_DB_USER", "crivo"),
            "PASSWORD": env("CRIVO_DB_PASSWORD", ""),
            "HOST": env("CRIVO_DB_HOST", "localhost"),
            "PORT": env("CRIVO_DB_PORT", "5432"),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": env("CRIVO_SQLITE_PATH", str(BASE_DIR / "crivo.sqlite3")),
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "pt-br"
TIME_ZONE = env("CRIVO_TIMEZONE", "America/Sao_Paulo")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = DEBUG

DATA_UPLOAD_MAX_MEMORY_SIZE = int(env("CRIVO_MAX_UPLOAD_MB", "24")) * 1024 * 1024

CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Strict"
SESSION_COOKIE_SAMESITE = "Strict"
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

if env_bool("CRIVO_HTTPS", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(env("CRIVO_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("CRIVO_HSTS_SUBDOMAINS", False)
    SECURE_SSL_REDIRECT = env_bool("CRIVO_HTTPS_REDIRECT", False)

CRIVO = {
    "VERSION": VERSION,
    "API_TOKEN": env("CRIVO_API_TOKEN", ""),
    "MAX_REVISIONS": int(env("CRIVO_MAX_REVISIONS", "20")),
    "WRITE_LIMIT": int(env("CRIVO_WRITE_LIMIT", "120")),
    "TRUSTED_PROXY": env_bool("CRIVO_TRUSTED_PROXY", False),
    "MAX_SIDE": 1024,
    "MAX_LAYERS": 64,
    "MAX_FRAMES": 512,
    "MAX_THUMBNAIL_BYTES": 512 * 1024,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("CRIVO_LOG_LEVEL", "INFO")},
}
