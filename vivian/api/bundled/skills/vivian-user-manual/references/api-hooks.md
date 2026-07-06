# Hooks API 使用指南

所有 Hooks 端点的前缀为 `/api/hooks`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/hooks/catalog | 获取所有内置 Hook 列表 |
| POST | /api/hooks/catalog/{hook_id}/enable | 启用内置 Hook |
| POST | /api/hooks/catalog/{hook_id}/disable | 禁用内置 Hook |
| GET | /api/hooks/config | 获取 Hook 配置 |
| PUT | /api/hooks/config | 更新 Hook 配置 |
| POST | /api/hooks/test | 测试自定义 Hook |
| POST | /api/hooks/test/builtin | 测试内置 Hook |
| GET | /api/hooks/script/content | 获取 Hook 脚本内容 |
| GET | /api/hooks/logs | 获取执行日志 |
| GET | /api/hooks/admin | 获取管理员强制 Hook（管理员） |
| POST | /api/hooks/admin | 添加管理员强制 Hook（管理员） |
| DELETE | /api/hooks/admin/{event_type}/{index} | 删除强制 Hook（管理员） |

---

## 获取 Hook 目录

```bash
curl GET /api/hooks/catalog \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "hooks": [
    {
      "id": "pre-tool-use-security",
      "event": "pre-tool-use",
      "name": "安全检查",
      "description": "检查工具调用是否安全",
      "can_block": true,
      "enabled": true,
      "enforced": false,
      "group": "TOOL USE",
      "matcher_target": "tool_name"
    }
  ]
}
```

---

## 启用 / 禁用内置 Hook

```bash
# 启用
curl -X POST /api/hooks/catalog/pre-tool-use-security/enable \
  -H "Authorization: Bearer <token>"

# 禁用
curl -X POST /api/hooks/catalog/pre-tool-use-security/disable \
  -H "Authorization: Bearer <token>"
```

**注意**：管理员强制启用（enforced）的 Hook 无法禁用。

---

## 获取 Hook 配置

```bash
curl GET /api/hooks/config \
  -H "Authorization: Bearer <token>"
```

**响应**：返回合并后的配置（管理员强制 + 项目级 + 本地级）。

---

## 更新 Hook 配置

添加或修改自定义处理器：

```bash
curl -X PUT /api/hooks/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hooks": {
      "pre-tool-use": [
        {
          "type": "command",
          "command": "/path/to/check.sh",
          "matcher": "Bash",
          "timeout": 30
        }
      ]
    }
  }'
```

### 处理器类型

**命令类型 (command)**：
```json
{
  "type": "command",
  "command": "/path/to/script.sh",
  "matcher": "Bash",
  "timeout": 30
}
```
- 执行 shell 命令，退出码 0 = 通过

**HTTP 类型 (http)**：
```json
{
  "type": "http",
  "url": "https://webhook.example.com/hook",
  "headers": {"Authorization": "Bearer xxx"},
  "matcher": "",
  "timeout": 30
}
```
- 发送 POST 请求，返回 JSON 中 `decision` 字段

**提示词类型 (prompt)**：
```json
{
  "type": "prompt",
  "prompt": "判断此操作是否安全：{{input}}",
  "model": "claude-haiku-4",
  "matcher": "",
  "timeout": 30
}
```
- 让 AI 模型评估

---

## 测试 Hook

### 测试自定义处理器

```bash
curl -X POST /api/hooks/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "handler": {
      "type": "command",
      "command": "echo allowed"
    },
    "input": {
      "tool_name": "Bash",
      "tool_input": {"command": "ls -la"}
    },
    "dry_run": true
  }'
```

### 测试内置 Hook

```bash
curl -X POST /api/hooks/test/builtin \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hook_id": "pre-tool-use-security",
    "input": {
      "tool_name": "Bash",
      "tool_input": {"command": "rm -rf /"}
    }
  }'
```

**响应**：
```json
{
  "decision": "deny",
  "reason": "危险操作：删除根目录",
  "exit_code": 1,
  "stdout": "",
  "stderr": "Blocked: destructive command",
  "duration_ms": 50
}
```

---

## 获取执行日志

```bash
curl GET "/api/hooks/logs?event=pre-tool-use&limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

**查询参数**：
| 参数 | 说明 |
|------|------|
| event | 按事件类型筛选（可选） |
| limit | 每页数量 |
| offset | 偏移量 |

**响应**：
```json
{
  "logs": [
    {
      "timestamp": "2024-03-25T10:30:00Z",
      "event": "pre-tool-use",
      "handler_type": "command",
      "exit_code": 0,
      "tool": "Bash",
      "duration_ms": 45
    }
  ],
  "total": 128
}
```

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | 处理器配置无效 | 检查 type 和必填字段 |
| 403 | 无法禁用强制 Hook | 联系管理员 |
| 404 | Hook ID 不存在 | 检查 hook_id |
| 408 | 处理器执行超时 | 增加 timeout 或优化脚本 |
