from __future__ import annotations

import asyncio
import logging

from .base import PluginContext, PluginResult, VivianPlugin

logger = logging.getLogger(__name__)


class PluginManager:
    def __init__(self) -> None:
        self._plugins: dict[str, VivianPlugin] = {}

    def register(self, plugin: VivianPlugin) -> None:
        self._plugins[plugin.id] = plugin

    def get_plugin(self, plugin_id: str) -> VivianPlugin | None:
        return self._plugins.get(plugin_id)

    def list_plugins(self, runtime_config: dict) -> list[dict]:
        """Return all plugins with their enable/disable status and config."""
        result = []
        plugins_cfg = runtime_config.get("plugins", {})
        for plugin in self._plugins.values():
            pcfg = plugins_cfg.get(plugin.id, {})
            merged = {**plugin.default_config, **{k: v for k, v in pcfg.items() if k != "enable"}}
            result.append({
                "id": plugin.id,
                "name": plugin.name,
                "description": plugin.description,
                "enabled": pcfg.get("enable", False),
                "config": merged,
            })
        return result

    async def execute_all(self, username: str, runtime_config: dict) -> PluginResult:
        """Run all enabled plugins and aggregate results."""
        plugins_cfg = runtime_config.get("plugins", {}) if isinstance(runtime_config, dict) else {}
        aggregated = PluginResult()
        appends: list[str] = []

        for plugin in self._plugins.values():
            pcfg = plugins_cfg.get(plugin.id, {})
            if not pcfg.get("enable", False):
                continue

            merged = {**plugin.default_config, **{k: v for k, v in pcfg.items() if k != "enable"}}
            context = PluginContext(username=username, config=merged)

            try:
                timeout = merged.get("timeout", 10)
                result = await asyncio.wait_for(plugin.execute(context), timeout=timeout)
                if result.system_prompt_append:
                    appends.append(result.system_prompt_append)
            except asyncio.TimeoutError:
                logger.warning("Plugin '%s' timed out after %ss", plugin.id, merged.get("timeout", 10))
            except Exception:
                logger.warning("Plugin '%s' failed", plugin.id, exc_info=True)

        if appends:
            aggregated.system_prompt_append = "\n\n".join(appends)

        return aggregated


_manager: PluginManager | None = None


def get_plugin_manager() -> PluginManager:
    global _manager
    if _manager is None:
        _manager = PluginManager()
        from .plugins import register_all
        register_all()
    return _manager
