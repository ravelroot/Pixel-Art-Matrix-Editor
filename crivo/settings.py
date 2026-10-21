import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(nome, padrao=None):
    valor = os.environ.get(nome)
    return padrao if valor is None or valor == "" else valor


def env_bool(nome, padrao=False):
    return str(env(nome, str(padrao))).strip().lower() in {"1", "true", "sim", "yes", "on"}


def env_lista(nome, padrao=""):
    return [item.strip() for item in str(env(nome, padrao)).split(",") if item.strip()]


VERSAO = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip() if (BASE_DIR / "VERSION").exists() else "1.0.0"

DEBUG = env_bool("CRIVO_DEBUG", True)
SECRET_KEY = env("CRIVO_SECRET_KEY", "crivo-chave-local-de-desenvolvimento-troque-em-producao")
ALLOWED_HOSTS = env_lista("CRIVO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_lista("CRIVO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "editor",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "editor.seguranca.TokenDaApiMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
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

DATA_UPLOAD_MAX_MEMORY_SIZE = int(env("CRIVO_TAMANHO_MAXIMO_MB", "24")) * 1024 * 1024

CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Strict"
SESSION_COOKIE_SAMESITE = "Strict"
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

if env_bool("CRIVO_HTTPS", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True

CRIVO = {
    "VERSAO": VERSAO,
    "TOKEN_API": env("CRIVO_API_TOKEN", ""),
    "MAX_REVISOES": int(env("CRIVO_MAX_REVISOES", "20")),
    "LIMITE_LADO": 1024,
    "LIMITE_CAMADAS": 64,
    "LIMITE_QUADROS": 512,
    "LIMITE_MINIATURA": 512 * 1024,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("CRIVO_LOG_LEVEL", "INFO")},
}
