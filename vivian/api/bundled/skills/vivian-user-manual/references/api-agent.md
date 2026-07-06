# Agent 对话 API 使用指南

所有 Agent 相关端点的前缀为 `/api/agent`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/agent/run | 同步执行 Agent（等待完成后返回） |
| POST | /api/agent/run/stream | 流式执行 Agent（SSE 实时推送） |
| WS | /api/agent/ws/run | WebSocket 实时对话（推荐） |
| GET | /api/agent/sessions | 获取会话列表 |
| GET | /api/agent/sessions/{session_id}/messages | 获取会话历史消息 |
| DELETE | /api/agent/sessions/{session_id} | 删除会话 |
| POST | /api/agent/permission/respond | 回复权限请求 |

---

## 发送消息（同步）

```bash
curl -X POST /api/agent/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "帮我写一个 Python Hello World",
    "session_id": null,
    "permission_mode": "default",
    "model": null,
    "attachments": [],
    "mcp_servers": "auto"
  }'
```

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 发送给 Agent 的消息 |
| session_id | string | 否 | 会话 ID（传入则继续已有会话，不传则新建） |
| permission_mode | string | 否 | 权限模式：`default`/`acceptEdits`/`plan`/`bypassPermissions` |
| model | string | 否 | 指定模型（不传则使用默认） |
| attachments | array | 否 | 附件列表（已上传文件的路径） |
| mcp_servers | string/array | 否 | MCP 服务器：`"auto"`/`"disable"`/`["server1","server2"]` |

### 响应

```json
{
  "messages": [
    {
      "type": "text",
      "content": "好的，这是一个 Python Hello World 程序：..."
    },
    {
      "type": "tool_use",
      "tool_name": "Write",
      "tool_input": {"file_path": "hello.py", "content": "print('Hello World')"},
      "tool_result": "File written successfully"
    }
  ],
  "session_id": "abc123",
  "is_error": false,
  "num_turns": 2,
  "duration_ms": 3500,
  "total_cost_usd": 0.015,
  "stop_reason": "end_turn"
}
```

---

## 发送消息（流式 SSE）

```bash
curl -X POST /api/agent/run/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我分析这段代码"}' \
  --no-buffer
```

请求参数与同步模式相同。

### SSE 事件格式

```
event: message
data: {"type": "text", "content": "让我"}

event: message
data: {"type": "text", "content": "分析一下"}

event: tool_use
data: {"tool_name": "Read", "tool_input": {"file_path": "main.py"}}

event: tool_result
data: {"tool_name": "Read", "content": "...文件内容..."}

event: done
data: {"session_id": "abc123", "num_turns": 3, "duration_ms": 5000}
```

---

## WebSocket 实时对话（推荐）

WebSocket 端点支持双向通信，适合需要权限交互的场景。

### 连接

```
ws://<host>/api/agent/ws/run?token=<jwt_token>
```

### 发送消息

连接后发送 JSON 帧：

```json
{
  "type": "init",
  "message": "帮我创建一个文件",
  "session_id": null,
  "permission_mode": "default",
  "model": null,
  "attachments": [],
  "mcp_servers": "auto"
}
```

### 接收事件

服务端推送多种事件类型：

```json
{"type": "text", "content": "好的，我来创建文件"}
{"type": "tool_use", "tool_name": "Write", "tool_input": {...}}
{"type": "tool_result", "tool_name": "Write", "content": "Success"}
{"type": "permission_request", "request_id": "req123", "tool_name": "Bash", "tool_input": {...}}
{"type": "ask_user", "question": "你想要什么数据库？", "options": ["PostgreSQL", "MySQL"]}
{"type": "done", "session_id": "abc123"}
```

### 回复权限请求

当收到 `permission_request` 事件时，发送：

```json
{
  "type": "permission_response",
  "request_id": "req123",
  "decision": "allow"
}
```

`decision` 可以是 `"allow"` 或 `"deny"`。

### 回复用户提问

当收到 `ask_user` 事件时，发送：

```json
{
  "type": "user_response",
  "answer": "PostgreSQL"
}
```

---

## 会话管理

### 获取会话列表

```bash
curl GET "/api/agent/sessions?scope=project&limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

**查询参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| scope | string | `project`（项目）或 `global`（全局） |
| limit | int | 每页数量（默认 20） |
| offset | int | 偏移量 |

**响应**：
```json
{
  "sessions": [
    {
      "session_id": "abc123",
      "created_at": "2024-03-25T10:00:00Z",
      "message_count": 15,
      "last_message": "好的，文件已创建"
    }
  ],
  "total": 42
}
```

### 获取会话消息

```bash
curl GET /api/agent/sessions/abc123/messages \
  -H "Authorization: Bearer <token>"
```

**响应**：返回该会话的完整消息列表。

### 删除会话

```bash
curl -X DELETE /api/agent/sessions/abc123 \
  -H "Authorization: Bearer <token>"
```

---

## 回复权限请求（REST 方式）

如果使用 SSE 模式，可通过此端点回复权限请求：

```bash
curl -X POST /api/agent/permission/respond \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req123", "decision": "allow"}'
```

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | 消息为空或参数无效 | 检查请求参数 |
| 401 | 未认证 | 检查 Token |
| 404 | 会话不存在 | 检查 session_id |
| 503 | Agent 正在忙 | 等待当前任务完成或新建会话 |
