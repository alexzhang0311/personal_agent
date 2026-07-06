from __future__ import annotations

import os
from pathlib import Path


def vivian_home() -> Path:
    """Per-deployment state dir: $VIVIAN_HOME/vivian/.

    VIVIAN_HOME is the parent dir (XDG_CONFIG_HOME-style); the app always
    appends 'vivian'. Default parent is ~/.config, so default state dir is
    ~/.config/vivian/ (matches pre-existing behavior).
    """
    raw = os.environ.get("VIVIAN_HOME")
    base = Path(raw).expanduser() if raw else Path.home() / ".config"
    return base / "vivian"


def resource_dir(resource_type: str) -> Path:
    """Runtime resource dir: $VIVIAN_HOME/vivian/resource/<type>/.

    The live source of truth for deployable resources (skills, etc.). On
    startup, resources are seeded here from the source code under
    ``vivian/api/bundled/``; thereafter the API reads/writes this location.
    ``resource_type`` is the fixed sub-namespace (e.g. ``"skills"``); add new
    types under the same ``resource/`` root for consistency.
    """
    return vivian_home() / "resource" / resource_type
