# Session list discovery API

The WebUI history sidebar uses `GET /api/agent/sessions` to discover sessions.
The endpoint remains backward compatible: callers that omit the new parameters
receive all project sessions as before.

## Request

```http
GET /api/agent/sessions?limit=20&offset=0&kind=chat&q=database
```

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `limit` | `1..200` | `20` | Page size |
| `offset` | `0+` | `0` | Offset after filtering |
| `kind` | `chat`, `scheduler`, `all` | `all` | Session origin |
| `q` | up to 200 characters | empty | Case-insensitive metadata search |
| `source` | legacy values | `all` | Accepted and ignored for compatibility |

Search covers the session ID, custom title, first prompt, summary, tag, and
scheduler job name. Message bodies are not searched. Search and origin filters
are applied before pagination.

## Response additions

```json
{
  "sessions": [
    {
      "session_id": "abc",
      "session_kind": "scheduler",
      "scheduler_context": {
        "job_id": "job-1",
        "job_name": "Nightly metrics",
        "run_id": "run-1"
      }
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "counts": {
    "chat": 0,
    "scheduler": 1,
    "all": 1
  }
}
```

`counts` is calculated after metadata search but before the `kind` filter, so
clients can render origin tabs for the current query. Existing clients may
ignore all added fields.

Scheduler origin data is stored separately from Claude session JSONL files.
Removing this feature or its sidecar does not alter or invalidate conversations.
