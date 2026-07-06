"""Parse and match Claude Code native permission grammar for risky tool enforcement.

Public surface:
- parse_rule(raw): returns RiskyRule or None on malformed input (LRU cached).
- parse_rule_strict(raw): same as parse_rule but raises ValueError on malformed input.
- match(rule, tool_name, tool_input): returns bool.
- matches_any(rules, tool_name, tool_input): returns (matched, matched_rule_raw).

Grammar supported:
    Bash                           -- any Bash invocation
    Bash(rm:*)                     -- Bash command whose first token is 'rm'
    Bash(git push:*)               -- Bash command whose first tokens are 'git push'
    Write(/etc/**)                 -- Write to a path matching the glob
    Edit(**/.env)                  -- Edit to a path matching the glob
    Read(~/.ssh/**)                -- Read from a path matching the glob
    NotebookEdit(...), MultiEdit(...)
    WebFetch(domain:github.com)    -- WebFetch to a URL whose host is (or ends with) the domain
    mcp__<glob>__<glob>            -- MCP tool name match via fnmatch
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Iterable
from urllib.parse import urlparse

from ...middleware.logging import get_app_logger

logger = get_app_logger(__name__)


_PATH_TOOLS = {"Write", "Edit", "Read", "NotebookEdit", "MultiEdit"}
_RULE_RE = re.compile(r"^(?P<tool>[A-Za-z_]\w*|mcp__\S+)(?:\((?P<arg>.*)\))?$")


@dataclass(frozen=True)
class RiskyRule:
    raw: str
    tool: str
    kind: str  # "any" | "bash_prefix" | "path_glob" | "webfetch_domain" | "mcp_glob" | "exact"
    arg: str | None = None


def _glob_to_regex(glob: str) -> re.Pattern[str]:
    """Convert a Claude-style glob (** for any path segments, * for any
    non-slash chars) into a compiled, anchored regex."""
    out: list[str] = []
    i = 0
    n = len(glob)
    while i < n:
        c = glob[i]
        if c == "*":
            if i + 1 < n and glob[i + 1] == "*":
                out.append(".*")
                i += 2
            else:
                out.append("[^/]*")
                i += 1
        elif c == "?":
            out.append(".")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("^" + "".join(out) + "$")


@lru_cache(maxsize=256)
def parse_rule(raw: str) -> RiskyRule | None:
    """Parse a raw permission-grammar string into a RiskyRule.

    Returns None (and logs a warning) for malformed input. Results are
    LRU-cached so repeated lookups are cheap.
    """
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None

    # mcp__<glob> -- entire string is the tool-name pattern, no wrapping parens
    if s.startswith("mcp__"):
        return RiskyRule(raw=raw, tool=s, kind="mcp_glob", arg=None)

    m = _RULE_RE.match(s)
    if not m:
        logger.warning("risky_matcher: could not parse rule {!r}", raw)
        return None

    tool = m.group("tool")
    arg = m.group("arg")

    if arg is None:
        # Bare tool name -- means "any invocation of this tool"
        return RiskyRule(raw=raw, tool=tool, kind="any", arg=None)

    if tool == "Bash":
        # "rm:*", "git push:*" -- strip the trailing :* wildcard if present
        prefix = arg
        if prefix.endswith(":*"):
            prefix = prefix[:-2]
        prefix = prefix.strip()
        if not prefix:
            return RiskyRule(raw=raw, tool=tool, kind="any", arg=None)
        return RiskyRule(raw=raw, tool=tool, kind="bash_prefix", arg=prefix)

    if tool in _PATH_TOOLS:
        return RiskyRule(raw=raw, tool=tool, kind="path_glob", arg=arg)

    if tool == "WebFetch":
        if arg.startswith("domain:"):
            return RiskyRule(raw=raw, tool=tool, kind="webfetch_domain", arg=arg[len("domain:"):].strip())
        logger.warning("risky_matcher: WebFetch rule {!r} missing 'domain:' prefix", raw)
        return None

    # Fallback: exact-match on the first string value in tool_input
    return RiskyRule(raw=raw, tool=tool, kind="exact", arg=arg)


def parse_rule_strict(raw: str) -> RiskyRule:
    """Strict variant -- raises ValueError if the rule is malformed.

    Used by the admin API to reject bad input at save time.
    """
    rule = parse_rule(raw)
    if rule is None:
        raise ValueError(f"Invalid risky-tool rule: {raw!r}")
    return rule


def _matches_bash_prefix(command: str, prefix: str) -> bool:
    cmd = command.lstrip()
    if not cmd.startswith(prefix):
        return False
    # Require that the prefix ends at a word / command boundary so that
    # "rm" does not match "rmdir" and "git push" does not match "git pushd".
    tail_idx = len(prefix)
    if tail_idx == len(cmd):
        return True
    next_ch = cmd[tail_idx]
    if next_ch.isspace():
        return True
    if next_ch in (";", "&", "|"):
        return True
    return False


def _matches_webfetch_domain(url: str, host: str) -> bool:
    try:
        parsed_host = urlparse(url).hostname
    except Exception:
        return False
    if not parsed_host:
        return False
    return parsed_host == host or parsed_host.endswith("." + host)


def match(rule: RiskyRule, tool_name: str, tool_input: dict[str, Any]) -> bool:
    """Return True if the rule matches this specific tool invocation."""
    if not isinstance(tool_input, dict):
        tool_input = {}

    if rule.kind == "mcp_glob":
        return fnmatch.fnmatchcase(tool_name, rule.tool)

    if rule.tool != tool_name:
        return False

    if rule.kind == "any":
        return True

    if rule.kind == "bash_prefix":
        command = tool_input.get("command") or ""
        if not isinstance(command, str):
            return False
        return _matches_bash_prefix(command, rule.arg or "")

    if rule.kind == "path_glob":
        file_path = tool_input.get("file_path") or ""
        if not isinstance(file_path, str) or not file_path:
            return False
        try:
            regex = _glob_to_regex(rule.arg or "")
        except re.error:
            return False
        return bool(regex.match(file_path))

    if rule.kind == "webfetch_domain":
        url = tool_input.get("url") or ""
        if not isinstance(url, str) or not url:
            return False
        return _matches_webfetch_domain(url, rule.arg or "")

    if rule.kind == "exact":
        for v in tool_input.values():
            if isinstance(v, str) and v == rule.arg:
                return True
        return False

    return False


def matches_any(
    rules: Iterable[str | RiskyRule],
    tool_name: str,
    tool_input: dict[str, Any],
) -> tuple[bool, str | None]:
    """Return (matched, matched_rule_raw) -- the first rule that matches."""
    for item in rules:
        if isinstance(item, RiskyRule):
            rule: RiskyRule | None = item
        else:
            rule = parse_rule(item)
        if rule is None:
            continue
        if match(rule, tool_name, tool_input):
            return True, rule.raw
    return False, None
