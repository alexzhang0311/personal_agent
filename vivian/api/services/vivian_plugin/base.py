from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PluginContext:
    username: str
    config: dict = field(default_factory=dict)


@dataclass
class PluginResult:
    system_prompt_append: str | None = None


class VivianPlugin(ABC):
    """Base class for all Vivian plugins."""

    @property
    @abstractmethod
    def id(self) -> str: ...

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def description(self) -> str: ...

    @property
    def default_config(self) -> dict:
        return {}

    @abstractmethod
    async def execute(self, context: PluginContext) -> PluginResult:
        """Run the plugin. Must not raise - return empty PluginResult on failure."""
        ...
