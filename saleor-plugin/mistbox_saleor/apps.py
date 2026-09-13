from django.apps import AppConfig


class MistboxConfig(AppConfig):
    """Where Mistbox's save-time rules get switched on.

    Saleor has no synchronous product webhook and no pre-save plugin hook, so
    an app cannot refuse a `productUpdate` from outside. Code running inside
    the mutation's own transaction can — and being in INSTALLED_APPS, which
    this class is, is the only way to get a foothold there without patching
    Saleor's source.
    """

    name = "mistbox_saleor"
    verbose_name = "Mistbox rules"

    def ready(self):
        from . import rules

        rules.install()
