from django.apps import AppConfig
from django.core import checks


def check_deprecated_env_vars(app_configs=None, **kwargs):
    """Warn about 1.x environment variable names that are still in use (they keep working as a fallback)."""
    from django.conf import settings

    return [
        checks.Warning(
            f"{old} is deprecated; use {new} instead.",
            hint=f"Rename {old} to {new} in your .env or deployment settings. The old name will be removed in a future release.",
            id="crivo.W001",
        )
        for old, new in getattr(settings, "DEPRECATED_ENV_VARS", ())
    ]


class EditorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "editor"
    verbose_name = "Crivo"

    def ready(self):
        checks.register(check_deprecated_env_vars, checks.Tags.compatibility)
