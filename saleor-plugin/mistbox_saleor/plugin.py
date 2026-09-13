from saleor.plugins.base_plugin import BasePlugin


class MistboxPlugin(BasePlugin):
    """A plugin that does nothing, and has to exist anyway.

    Saleor's discovery only looks at the `saleor.plugins` entry point group, so
    a package cannot reach INSTALLED_APPS without offering a plugin class. The
    real work is a Django signal — see `apps.py` — because the 3.23 plugin base
    class has no product hooks at all: only payment and configuration.
    """

    PLUGIN_ID = "mistbox.rules"
    PLUGIN_NAME = "Mistbox rules"
    PLUGIN_DESCRIPTION = (
        "Refuses a gift box whose contents break Mistbox's own rules, at the "
        "moment it is saved."
    )
    DEFAULT_ACTIVE = True
    CONFIGURATION_PER_CHANNEL = False
