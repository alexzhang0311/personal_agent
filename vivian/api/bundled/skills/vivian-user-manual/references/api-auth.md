# 认证 API 使用指南

所有认证相关端点的前缀为 `/api/auth`。

---

## 端点列表

| 方法 | 路径 | 说明 | 需要登录 |
|------|------|------|----------|
| GET | /api/auth/setup | 检查是否需要初始设置 | 否 |
| POST | /api/auth/setup | 创建管理员账号 | 否 |
| POST | /api/auth/login | 登录获取令牌 | 否 |
| POST | /api/auth/refresh | 刷新令牌 | 是 |
| GET | /api/auth/me | 获取当前用户信息 | 是 |
| GET | /api/auth/me/apikey | 查看 API Key 状态 | 是 |
| POST | /api/auth/me/apikey | 生成新 API Key | 是 |
| DELETE | /api/auth/me/apikey | 撤销 API Key | 是 |
| GET | /api/auth/me/env | 获取环境配置 | 是 |
| PUT | /api/auth/me/env | 更新环境配置 | 是 |
| GET | /api/auth/me/env/status | 检查环境是否已配置 | 是 |

---

## 详细说明

### 检查初始设置

```bash
curl GET /api/auth/setup
```

**响应**：
```json
{
  "needs_setup": true
}
```

如果返回 `true`，说明系统未初始化，需要先创建管理员。

---

### 创建管理员（首次设置）

```bash
curl -X POST /api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your_password"}'
```

**请求参数**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 管理员用户名 |
| password | string | 是 | 管理员密码 |

**响应**：成功返回 200 和用户信息。

---

### 登录

```bash
curl -X POST /api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your_password"}'
```

**请求参数**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**响应**：
```json
{
  "token": "eyJhbGciOiJIUzI...",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

将 `token` 保存，后续请求都需要在 Header 中携带：
```
Authorization: Bearer eyJhbGciOiJIUzI...
```

---

### 刷新令牌

```bash
curl -X POST /api/auth/refresh \
  -H "Authorization: Bearer <token>"
```

**响应**：返回新的 token。

---

### 获取当前用户信息

```bash
curl GET /api/auth/me \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "username": "admin",
  "role": "admin",
  "created_at": "2024-03-25T10:00:00Z"
}
```

---

### API Key 管理

**查看状态**：
```bash
curl GET /api/auth/me/apikey \
  -H "Authorization: Bearer <token>"
```

**生成新 Key**：
```bash
curl -X POST /api/auth/me/apikey \
  -H "Authorization: Bearer <token>"
```

响应中包含完整的 Key，需立即保存。

**撤销 Key**：
```bash
curl -X DELETE /api/auth/me/apikey \
  -H "Authorization: Bearer <token>"
```

---

### 环境配置

获取和更新 LLM 提供商等环境变量。

**获取**：
```bash
curl GET /api/auth/me/env \
  -H "Authorization: Bearer <token>"
```

**更新**：
```bash
curl -X PUT /api/auth/me/env \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "ANTHROPIC_BASE_URL": "https://api.example.com",
    "ANTHROPIC_API_KEY": "sk-xxx"
  }'
```

**检查状态**：
```bash
curl GET /api/auth/me/env/status \
  -H "Authorization: Bearer <token>"
```

返回 `{"configured": true}` 或 `{"configured": false}`。

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 401 | 未认证或令牌过期 | 重新登录获取新令牌 |
| 403 | 权限不足 | 检查用户角色 |
| 409 | 设置已完成 | 系统已初始化，无需再次设置 |
| 429 | 请求频率过高 | 等待后重试 |
