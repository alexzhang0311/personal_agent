from __future__ import annotations

import asyncio
import json
import re
import tempfile
from pathlib import Path

# Only true syntax errors prevent a script from running. Ruff reports those as
# "E999" in older versions and "invalid-syntax" in newer ones. Everything else
# from `ruff check` (F-prefix pyflakes lints, E-prefix style, W-prefix warnings)
# is a non-blocking lint issue — the script still runs.
_ERROR_CODES = {"E999", "invalid-syntax"}


async def lint_script(code: str, language: str) -> list[dict]:
    """Lint a Python or Shell script and return a list of diagnostics.

    Each diagnostic is a dict with keys: line, severity ('error'|'warning'), message.
    """
    if language == "python":
        return await _lint_python(code)
    if language == "shell":
        return await _lint_shell(code)
    return []


async def _lint_python(code: str) -> list[dict]:
    proc = await asyncio.create_subprocess_exec(
        "ruff", "check", "--output-format", "json",
        "--stdin-filename", "script.py", "-",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(
        proc.communicate(input=code.encode()), timeout=10
    )
    diagnostics = []
    if stdout.strip():
        try:
            items = json.loads(stdout)
            for item in items:
                rule = item.get("code", "")
                is_error = rule in _ERROR_CODES
                diagnostics.append({
                    "line": item.get("location", {}).get("row", 1),
                    "severity": "error" if is_error else "warning",
                    "message": f"[{rule}] {item.get('message', '')}",
                })
        except json.JSONDecodeError:
            pass
    return diagnostics


async def _lint_shell(code: str) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".sh", mode="w", delete=False) as f:
        f.write(code)
        tmp = f.name
    diagnostics = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", "-n", tmp,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        if proc.returncode != 0:
            for raw_line in stderr.decode(errors="replace").splitlines():
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                line = 1
                m = re.search(r"line (\d+)", raw_line)
                if m:
                    line = int(m.group(1))
                msg = raw_line.replace(tmp, "<script>").strip()
                diagnostics.append({"line": line, "severity": "error", "message": msg})
    finally:
        Path(tmp).unlink(missing_ok=True)
    return diagnostics
