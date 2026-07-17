from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path


SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def find_version_file(start: Path | None = None) -> Path:
    """Find VERSION in a source checkout or an extracted release package."""
    location = (start or Path(__file__)).resolve()
    directory = location if location.is_dir() else location.parent

    for candidate_dir in (directory, *directory.parents):
        candidate = candidate_dir / "VERSION"
        if candidate.is_file():
            return candidate

    raise RuntimeError(f"VERSION file not found from {directory}")


def read_version(version_file: Path) -> str:
    version = version_file.read_text(encoding="utf-8").strip()
    if not SEMVER_PATTERN.fullmatch(version):
        raise RuntimeError(f"Invalid SemVer in {version_file}: {version!r}")
    return version


@lru_cache
def get_app_version() -> str:
    return read_version(find_version_file())
