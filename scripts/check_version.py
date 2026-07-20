#!/usr/bin/env python3
"""Validate that all project version mirrors match the root VERSION file."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def fail(message: str) -> None:
    print(f"[version] ERROR: {message}", file=sys.stderr)


def main() -> int:
    version_file = ROOT / "VERSION"
    if not version_file.is_file():
        fail("missing root VERSION file")
        return 1

    version = version_file.read_text(encoding="utf-8").strip()
    errors: list[str] = []

    if not SEMVER_PATTERN.fullmatch(version):
        errors.append(f"VERSION is not valid SemVer: {version!r}")

    config_text = (ROOT / "vivian/api/config.yaml").read_text(encoding="utf-8")
    if re.search(r"^app_version\s*:", config_text, re.MULTILINE):
        errors.append(
            "vivian/api/config.yaml must not define app_version; "
            "the root VERSION file is the only source of truth"
        )

    package = json.loads((ROOT / "vivian/web/package.json").read_text(encoding="utf-8"))
    if package.get("version") != version:
        errors.append(
            "vivian/web/package.json version "
            f"is {package.get('version')!r}, expected {version!r}"
        )

    package_lock = json.loads(
        (ROOT / "vivian/web/package-lock.json").read_text(encoding="utf-8")
    )
    lock_versions = {
        "top-level": package_lock.get("version"),
        "root package": package_lock.get("packages", {}).get("", {}).get("version"),
    }
    for location, lock_version in lock_versions.items():
        if lock_version != version:
            errors.append(
                f"vivian/web/package-lock.json {location} version "
                f"is {lock_version!r}, expected {version!r}"
            )

    if errors:
        for error in errors:
            fail(error)
        return 1

    print(f"[version] OK: all project version fields match {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
