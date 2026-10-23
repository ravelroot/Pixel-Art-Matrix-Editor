import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(nome, padrao=None):
    valor = os.environ.get(nome)
    return padrao if valor is None or valor == "" else valor


def env_bool(nome, padrao=False):
    return str(env(nome, str(padrao))).strip().lower() in {"1", "true", "sim", "yes", "on"}


def env_lista(nome, padrao=""):
    return [item.strip() for item in str(env(nome, padrao)).split(",") if item.strip()]


VERSAO = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip() if (BASE_DIR / "VERSION").exists() else "1.2.0"

CHAVE_DE_DESENVOLVIMENTO = "crivo-chave-local-de-desenvolvimento-troque-em-producao"
CHAVES_DE_EXEMPLO = {CHAVE_DE_DESENVOLVIMENTO, "troque-esta-chave"}

DEBUG = env_bool("CRIVO_DEBUG", True)
SECRET_KEY = env("CRIVO_SECRET_KEY", CHAVE_DE_DESENVOLVIMENTO)

if not DEBUG and (SECRET_KEY in CHAVES_DE_EXEMPLO or len(SECRET_KEY) < 32):
    raise ImproperlyConfigured(
        "CRIVO_SECRET_KEY insegura: com CRIVO_DEBUG=false defina uma chave aleatória com pelo menos 32 caracteres "
        "(os scripts iniciar.sh e iniciar.cmd geram uma no .env)."
    )
ALLOWED_HOSTS = env_lista("CRIVO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_lista("CRIVO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "editor",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "editor.seguranca.CabecalhosDeSegurancaMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "editor.seguranca.TokenDaApiMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "editor.seguranca.LimiteDeEscritasMiddleware",
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
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

if env_bool("CRIVO_HTTPS", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(env("CRIVO_HSTS_SEGUNDOS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("CRIVO_HSTS_SUBDOMINIOS", False)
    SECURE_SSL_REDIRECT = env_bool("CRIVO_REDIRECIONAR_HTTPS", False)

CRIVO = {
    "VERSAO": VERSAO,
    "TOKEN_API": env("CRIVO_API_TOKEN", ""),
    "MAX_REVISOES": int(env("CRIVO_MAX_REVISOES", "20")),
    "LIMITE_ESCRITAS": int(env("CRIVO_LIMITE_ESCRITAS", "120")),
    "PROXY_CONFIAVEL": env_bool("CRIVO_PROXY_CONFIAVEL", False),
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
