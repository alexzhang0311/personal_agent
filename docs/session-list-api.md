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
      "folder_id": null,
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

## Chat folders

Folders are single-level and apply only to ordinary `chat` sessions. A session
returned by `GET /api/agent/sessions` now includes nullable `folder_id`.
Scheduler sessions always return `null`. This is an additive response field, so
existing clients remain compatible.

Folder names are trimmed, contain 1–64 characters, cannot contain `/` or control
characters, and are unique case-insensitively within one user workspace. Folder
IDs are UUIDs.

### List folders

```http
GET /api/agent/session-folders
```

```json
{
  "folders": [
    {
      "folder_id": "40bc2f66-6690-4a50-91aa-7f5b65e6a11f",
      "name": "Project A",
      "created_at": "2026-07-30T12:00:00+00:00",
      "session_count": 12
    }
  ],
  "unfiled_count": 30
}
```

### Create, rename, and delete

```http
POST /api/agent/session-folders
Content-Type: application/json

{"name":"Project A"}
```

```http
PATCH /api/agent/session-folders/{folder_id}
Content-Type: application/json

{"name":"Incidents"}
```

```http
DELETE /api/agent/session-folders/{folder_id}
```

Deleting a folder only removes its classification. Its sessions return to
Unfiled and their conversation files are not deleted. Duplicate names return
`409`; invalid names return `400`; unknown folder IDs return `404`.

### Page sessions in one folder

```http
GET /api/agent/session-folders/{folder_id}/sessions?limit=20&offset=0
```

Use the reserved folder identifier `unfiled` to page chat sessions without a
folder:

```http
GET /api/agent/session-folders/unfiled/sessions?limit=20&offset=0
```

The response uses the same `SessionListResponse` envelope as
`GET /api/agent/sessions`. Scheduler sessions are excluded.

### Move or unfile a session

```http
PUT /api/agent/sessions/{session_id}/folder
Content-Type: application/json

{"folder_id":"40bc2f66-6690-4a50-91aa-7f5b65e6a11f"}
```

Send `{"folder_id":null}` to return the session to Unfiled. Unknown sessions or
folders return `404`; scheduler sessions return `400` and cannot be classified.

## Storage and compatibility

Folder definitions and assignments are append-only events in the locked
`.vivian.session-folders.jsonl` sidecar under the user's workspace. Corrupt
lines are ignored. Existing sessions require no migration and default to
Unfiled. Deleting a session appends an event that clears its assignment.

Folder support does not change `/api/agent/run/stream`, SSE events, WebSocket
frames, or the existing session rename endpoint. Rolling back the UI and
ignoring the folder sidecar leaves all conversation data usable.
