# Session list discovery API

The WebUI history sidebar uses `GET /api/agent/sessions` to discover sessions.
Existing response fields remain compatible. Callers that omit pagination parameters now
receive the newest 50 project sessions; older records are available through `offset`.

## Request

```http
GET /api/agent/sessions?limit=50&offset=0&kind=chat&q=database
```

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `limit` | `1..200` | `50` | Page size |
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
  "limit": 50,
  "offset": 0,
  "counts": {
    "chat": 0,
    "scheduler": 1,
    "all": 1
  },
  "catalog_status": {
    "state": "ready",
    "discovered": 1,
    "processed": 1,
    "total_exact": true,
    "last_error": null
  }
}
```

The process-local catalog inventories filenames and timestamps first, parses at
most the requested candidate page, then hydrates older metadata in one throttled
background task. While `catalog_status.total_exact` is false, `total` and
`counts` are provisional candidate-file counts; clients should hide exact
counts, disable search, and wait for `ready` before requesting later pages. The
first page is refreshed as each throttled batch completes. Search requests return `503` until the catalog is
ready. Existing clients may ignore the additive `catalog_status` field.

When the catalog is ready, `counts` is calculated after metadata search but
before the `kind` filter. No persistent database or index is used. Restarting
the API discards only the in-memory catalog and does not alter session JSONL.
The WebUI calls `GET /api/auth/me?lazy_session_stats=true` during login. This
opt-in mode consumes only filename, size, and timestamp metadata, so it never
traverses complete session bodies on the login path; its message count remains
zero until an exact statistics request is made. The endpoint default remains the
legacy exact-statistics behavior for existing API callers.

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
GET /api/agent/session-folders/{folder_id}/sessions?limit=50&offset=0
```

Use the reserved folder identifier `unfiled` to page chat sessions without a
folder:

```http
GET /api/agent/session-folders/unfiled/sessions?limit=50&offset=0
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

Lazy discovery and folder support do not change `/api/agent/run/stream`, SSE event
envelopes, WebSocket frames, or the existing session rename endpoint. Rolling back the UI and
ignoring the folder sidecar leaves all conversation data usable.
