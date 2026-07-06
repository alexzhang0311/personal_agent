from __future__ import annotations


def format_user_info(info: dict[str, str]) -> str:
    lines = [f"{k}: {v}" for k, v in info.items()]
    body = "\n".join(lines)
    return f"<enterprise-user-info>\n{body}\n</enterprise-user-info>"


def format_fallback() -> str:
    return "<enterprise-user-info>\nEnterprise user information is currently unavailable.\n</enterprise-user-info>"
