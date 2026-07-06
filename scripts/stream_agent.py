from __future__ import annotations

import json
from typing import Any

import httpx


def stream_agent(
    message: str,
    base_url: str = "http://localhost:8000",
) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    url = f"{base_url.rstrip('/')}/api/agent/run/stream"

    with httpx.Client(timeout=None) as client:
        with client.stream("POST", url, json={"message": message},
                           headers={"Accept": "text/event-stream"}) as resp:
            resp.raise_for_status()
            current_event: str | None = None
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    current_event = line[6:].strip()
                elif line.startswith("data:"):
                    raw = line[5:].strip()
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        data = raw
                    events.append({"event": current_event or "message", "data": data})
                    current_event = None

    return {"result": events[-1]}


def main() -> None:
    import sys
    message = sys.argv[1] if len(sys.argv) > 1 else "hello"
    result = stream_agent(message)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
