# 管理员 API 使用指南

所有管理员端点的前缀为 `/api/admin`。**所有端点仅管理员可用。**

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 获取所有用户列表 |
| POST | /api/admin/users | 创建新用户 |
| PUT | /api/admin/users/{username} | 更新用户信息 |
| DELETE | /api/admin/users/{username} | 删除用户 |
| GET | /api/admin/stats | 获取系统统计 |
| GET | /api/admin/audit | 查询审计日志 |
| GET | /api/admin/users/{username}/skills | 查看用户技能 |
| DELETE | /api/admin/users/{username}/skills/{level}/{name} | 删除用户技能 |
| GET | /api/admin/users/{username}/mcp | 查看用户 MCP 配置 |
| DELETE | /api/admin/users/{username}/mcp/{level}/{name} | 删除用户 MCP 配置 |
| GET | /api/admin/presetprompt | 获取系统预设提示词 |
| PUT | /api/admin/presetprompt | 更新系统预设提示词 |

---

## 用户管理

### 获取用户列表

```bash
curl GET /api/admin/users \
  -H "Authorization: Bearer <admin_token>"
```

**响应**：
```json
{
  "users": [
    {
      "username": "admin",
      "role": "admin",
      "created_at": "2024-03-25T10:00:00Z",
      "has_apikey": true
    },
    {
      "username": "user1",
      "role": "user",
      "created_at": "2024-03-25T11:00:00Z",
      "has_apikey": false
    }
  ]
}
```

### 创建用户

```bash
curl -X POST /api/admin/users \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "password": "secure_password",
    "role": "user"
  }'
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 否 | 密码（不传则使用默认密码） |
| role | string | 否 | `user`（默认）或 `admin` |

### 更新用户

```bash
curl -X PUT /api/admin/users/user1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "new_password",
    "role": "admin"
  }'
```

可更新的字段：`password`、`role`、`apikey`（生成/撤销）、`env`（环境变量）。

### 删除用户

```bash
curl -X DELETE /api/admin/users/user1 \
  -H "Authorization: Bearer <admin_token>"
```

**注意**：删除用户会同时删除其所有数据。不可撤销。

---

## 系统统计

```bash
curl GET /api/admin/stats \
  -H "Authorization: Bearer <admin_token>"
```

**响应**：
```json
{
  "total_users": 5,
  "total_sessions": 128,
  "total_storage_bytes": 52428800,
  "users": [
    {
      "username": "admin",
      "sessions": 45,
      "storage_bytes": 20971520,
      "files": 12,
      "last_active": "2024-03-25T15:30:00Z"
    }
  ]
}
```

---

## 审计日志

```bash
curl GET "/api/admin/audit?action=login&actor=admin&limit=50&offset=0" \
  -H "Authorization: Bearer <admin_token>"
```

**查询参数**：
| 参数 | 说明 |
|------|------|
| action | 操作类型：`login`、`user.*`、`session.*`、`skill.*`、`tool.*` |
| actor | 操作人用户名 |
| target | 操作目标 |
| start | 开始时间（ISO 格式） |
| end | 结束时间（ISO 格式） |
| limit | 每页数量 |
| offset | 偏移量 |

**响应**：
```json
{
  "entries": [
    {
      "timestamp": "2024-03-25T10:00:00Z",
      "actor": "admin",
      "action": "login.success",
      "target": "admin",
      "details": {}
    }
  ],
  "total": 200
}
```

---

## 查看用户资源

### 查看用户技能

```bash
curl GET /api/admin/users/user1/skills \
  -H "Authorization: Bearer <admin_token>"
```

### 删除用户技能

```bash
curl -X DELETE /api/admin/users/user1/skills/project/my-skill \
  -H "Authorization: Bearer <admin_token>"
```

### 查看用户 MCP 配置

```bash
curl GET /api/admin/users/user1/mcp \
  -H "Authorization: Bearer <admin_token>"
```

---

## 系统预设提示词

### 获取

```bash
curl GET /api/admin/presetprompt \
  -H "Authorization: Bearer <admin_token>"
```

### 更新

```bash
curl -X PUT /api/admin/presetprompt \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "content": "你是一个专业的技术助手，请使用中文回答。"
  }'
```

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 403 | 非管理员 | 仅 admin 角色可访问 |
| 404 | 用户不存在 | 检查用户名 |
| 409 | 用户名已存在 | 使用不同用户名 |
