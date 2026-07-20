from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from vivian.api.services.config import Settings
from vivian.api.services.version import find_version_file, get_app_version, read_version


def test_app_version_comes_from_root_version_file() -> None:
    version_file = find_version_file()

    assert version_file.name == "VERSION"
    assert get_app_version() == version_file.read_text(encoding="utf-8").strip()


def test_find_version_file_supports_extracted_release_layout(tmp_path: Path) -> None:
    version_file = tmp_path / "VERSION"
    version_file.write_text("1.2.3-rc.1\n", encoding="utf-8")
    nested_module = tmp_path / "api" / "services" / "version.py"
    nested_module.parent.mkdir(parents=True)
    nested_module.touch()

    assert find_version_file(nested_module) == version_file.resolve()
    assert read_version(version_file) == "1.2.3-rc.1"


def test_read_version_rejects_invalid_semver(tmp_path: Path) -> None:
    version_file = tmp_path / "VERSION"
    version_file.write_text("release-final\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="Invalid SemVer"):
        read_version(version_file)


def test_legacy_config_version_is_accepted_but_not_exposed_as_runtime_version(
    tmp_path: Path,
) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "app_name: Legacy Vivian\napp_version: 0.9.0\nserver:\n  port: 9999\n",
        encoding="utf-8",
    )

    class LegacyConfigSettings(Settings):
        yaml_file: ClassVar[Path] = config_file

    settings = LegacyConfigSettings()

    assert settings.legacy_app_version == "0.9.0"
    assert not hasattr(settings, "app_version")
    assert settings.server.port == 9999
