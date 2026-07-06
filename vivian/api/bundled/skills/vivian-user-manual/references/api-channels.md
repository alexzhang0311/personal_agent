# WeCom 渠道 API 使用指南

> **⚠️ 注意：Channels（渠道）功能目前尚未在生产环境中启用。以下文档仅供参考，实际使用请等待正式发布。**

所有渠道端点的前缀为 `/api/channels`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/channels/wecom/config | 获取 WeCom 配置 |
| PUT | /api/channels/wecom/config | 更新 WeCom 配置 |
| POST | /api/channels/wecom/connect | 连接 WeCom |
| POST | /api/channels/wecom/disconnect | 断开 WeCom |
| POST | /api/channels/wecom/reconnect | 重新连接 WeCom |
| GET | /api/channels/wecom/status | 获取连接状态 |
| GET | /api/channels/health | 获取渠道守护进程健康状态 |

---

## 获取 WeCom 配置

```bash
curl GET /api/channels/wecom/config \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "bot_id": "bot_xxx",
  "secret": "***",
  "proxy_url": "",
  "allowed_users": ["user001", "user002"],
  "welcome_message": "你好！我是 AI 助手。",
  "reject_message": "抱歉，你不在白名单中。",
  "model": "",
  "max_queue": 10,
  "session_timeout_min": 30
}
```

---

## 更新 WeCom 配置

```bash
curl -X PUT /api/channels/wecom/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bot_id": "bot_xxx",
    "secret": "your_secret",
    "proxy_url": "",
    "allowed_users": ["user001", "user002"],
    "welcome_message": "你好！我是 AI 助手，有什么可以帮你的？",
    "reject_message": "抱歉，你没有使用权限。",
    "model": "claude-sonnet-4",
    "max_queue": 10,
    "session_timeout_min": 30
  }'
```

### 配置字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| bot_id | string | 是 | 企业微信机器人 Bot ID |
| secret | string | 是 | 机器人 Secret |
| proxy_url | string | 否 | WebSocket 代理地址（直连不可用时使用） |
| allowed_users | array | 否 | 允许使用的企业微信用户 ID 列表（空=允许所有人） |
| welcome_message | string | 否 | 用户首次发消息时的欢迎语 |
| reject_message | string | 否 | 不在白名单内用户收到的提示 |
| model | string | 否 | 指定对话使用的模型（留空使用默认） |
| max_queue | int | 否 | 最大消息队列长度 |
| session_timeout_min | int | 否 | 会话超时时间（分钟） |

---

## 连接控制

### 连接

```bash
curl -X POST /api/channels/wecom/connect \
  -H "Authorization: Bearer <token>"
```

启动 WeCom 连接。需要先配置好 bot_id 和 secret。

### 断开

```bash
curl -X POST /api/channels/wecom/disconnect \
  -H "Authorization: Bearer <token>"
```

**注意**：断开会中断所有活跃的企业微信对话。

### 重新连接

```bash
curl -X POST /api/channels/wecom/reconnect \
  -H "Authorization: Bearer <token>"
```

先断开再重新连接。

---

## 获取状态

```bash
curl GET /api/channels/wecom/status \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "status": "connected",
  "active_sessions": 3,
  "active_session_ids": ["session1", "session2", "session3"],
  "messages_handled": 156
}
```

**状态值**：
| 状态 | 说明 |
|------|------|
| connected | 已连接 |
| connecting | 正在连接 |
| disconnected | 已断开 |
| auth_failed | 认证失败 |
| error | 错误 |

---

## 渠道守护进程健康

```bash
curl GET /api/channels/health \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "healthy": true,
  "daemon_running": true
}
```

如果 `daemon_running` 为 `false`，说明渠道守护进程未启动，需要联系管理员。

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | 配置不完整 | 检查 bot_id 和 secret |
| 401 | 认证失败 | 检查 Token |
| 503 | 守护进程离线 | 联系管理员启动渠道服务 |
