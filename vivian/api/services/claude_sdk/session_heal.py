from __future__ import annotations

import json
from pathlib import Path

from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir


def heal_orphan_tool_uses(session_id: str | None, cwd: str) -> int:
    """If the resumed session JSONL has tool_use blocks without matching
    tool_result, append a synthetic user message carrying interrupted-tool
    tool_result blocks. Returns the number of orphans healed (0 if none or
    if the session file does not exist).
    """
    if not session_id:
        return 0
    try:
        project_dir = _get_project_dir(_canonicalize_path(cwd))
        path: Path = project_dir / f"{session_id}.jsonl"
    except Exception:
        return 0
    if not path.exists():
        return 0

    tool_uses: dict[str, str] = {}
    tool_results: set[str] = set()
    with path.open() as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            msg = rec.get("message") or {}
            content = msg.get("content") or []
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    tool_uses[b.get("id")] = b.get("name", "unknown")
                elif b.get("type") == "tool_result":
                    tool_results.add(b.get("tool_use_id"))

    orphans = [(tid, name) for tid, name in tool_uses.items() if tid not in tool_results]
    if not orphans:
        return 0

    synthetic = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tid,
                    "content": f"[Tool interrupted] {name} did not complete before the session ended.",
                    "is_error": True,
                }
                for tid, name in orphans
            ],
        },
        "session_id": session_id,
    }
    with path.open("a") as f:
        f.write(json.dumps(synthetic) + "\n")
    return len(orphans)
