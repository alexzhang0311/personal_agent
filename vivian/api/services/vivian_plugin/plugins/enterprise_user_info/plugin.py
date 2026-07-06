from __future__ import annotations

import logging

from ...base import PluginContext, PluginResult, VivianPlugin
from .formatter import format_fallback, format_user_info
from .mcp_provider import get_user_info_via_mcp

logger = logging.getLogger(__name__)


class EnterpriseUserInfoPlugin(VivianPlugin):
    @property
    def id(self) -> str:
        return "enterprise_user_info"

    @property
    def name(self) -> str:
        return "Enterprise User Info"

    @property
    def description(self) -> str:
        return "Retrieves enterprise user information from MCP server and injects into system prompt"

    @property
    def default_config(self) -> dict:
        return {
            "provider_type": "mcp",
            "url": "",
            "headers": {},
            "tool_name": "get_user_info",
            "timeout": 10,
        }

    async def execute(self, context: PluginContext) -> PluginResult:
        config = context.config
        url = config.get("url", "")
        if not url:
            logger.warning("enterprise_user_info: no MCP URL configured")
            return PluginResult(system_prompt_append=format_fallback())

        try:
            info = await get_user_info_via_mcp(
                url=url,
                username=context.username,
                tool_name=config.get("tool_name", "get_user_info"),
                headers=config.get("headers") or {},
                timeout=config.get("timeout", 10),
            )
            return PluginResult(system_prompt_append=format_user_info(info))
        except Exception:
            logger.warning("enterprise_user_info: failed to fetch user info", exc_info=True)
            return PluginResult(system_prompt_append=format_fallback())
