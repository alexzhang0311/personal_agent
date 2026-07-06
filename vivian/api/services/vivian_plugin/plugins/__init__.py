from __future__ import annotations


def register_all() -> None:
    """Auto-register all built-in plugins. Called by get_plugin_manager()."""
    # Import here to avoid circular imports at module level.
    # Safe because _manager is already set before register_all is invoked.
    from ..manager import get_plugin_manager
    from .enterprise_user_info import EnterpriseUserInfoPlugin

    mgr = get_plugin_manager()
    mgr.register(EnterpriseUserInfoPlugin())
