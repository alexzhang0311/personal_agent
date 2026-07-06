# MCP 服务器 API 使用指南

所有 MCP 服务器管理端点的前缀为 `/api/resource/mcp`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/resource/mcp/ | 获取所有 MCP 服务器 |
| GET | /api/resource/mcp/{level}/{name} | 获取服务器详情 |
| GET | /api/resource/mcp/{level}/{name}/capabilities | 获取服务器能力 |
| POST | /api/resource/mcp/ | 创建 MCP 服务器 |
| PUT | /api/resource/mcp/{level}/{name} | 更新服务器配置 |
| DELETE | /api/resource/mcp/{level}/{name} | 删除服务器 |
| POST | /api/resource/mcp/validate | 验证服务器连接 |
| POST | /api/resource/mcp/validate/tool | 测试特定工具 |

---

## 获取服务器列表

```bash
curl GET /api/resource/mcp/ \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "servers": [
    {
      "name": "my-server",
      "level": "project",
      "type": "http",
      "url": "https://mcp.example.com",
      "timeout": 60
    }
  ]
}
```

---

## 创建 MCP 服务器

```bash
curl -X POST /api/resource/mcp/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-server",
    "level": "project",
    "type": "http",
    "url": "https://mcp.example.com",
    "headers": {
      "Authorization": "Bearer xxx"
    },
    "timeout": 60
  }'
```

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 服务器名称 |
| level | string | 是 | `project` 或 `global` |
| type | string | 是 | 服务器类型（如 `http`） |
| url | string | 是 | 服务器 URL |
| headers | object | 否 | 请求头（如认证信息） |
| timeout | int | 否 | 超时时间（秒），默认 60 |

---

## 获取服务器能力

```bash
curl GET /api/resource/mcp/project/my-server/capabilities \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "tools": [
    {
      "name": "search",
      "description": "搜索文档",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {"type": "string", "description": "搜索关键词"},
          "limit": {"type": "integer", "description": "结果数量"}
        },
        "required": ["query"]
      }
    }
  ],
  "prompts": [],
  "resources": [
    {
      "name": "docs",
      "description": "文档资源"
    }
  ]
}
```

---

## 验证服务器连接

在保存前测试服务器是否可连接：

```bash
curl -X POST /api/resource/mcp/validate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "http",
    "url": "https://mcp.example.com",
    "headers": {},
    "timeout": 30
  }'
```

**响应**（成功）：
```json
{
  "valid": true,
  "tools_count": 5,
  "prompts_count": 0,
  "resources_count": 2
}
```

**响应**（失败）：
```json
{
  "valid": false,
  "error": "Connection refused"
}
```

---

## 测试工具

测试 MCP 服务器上的特定工具：

```bash
curl -X POST /api/resource/mcp/validate/tool \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "server_name": "my-server",
    "server_level": "project",
    "tool_name": "search",
    "arguments": {
      "query": "hello",
      "limit": 5
    }
  }'
```

**响应**：
```json
{
  "success": true,
  "result": {
    "content": [{"type": "text", "text": "搜索结果..."}]
  }
}
```

---

## 更新服务器

```bash
curl -X PUT /api/resource/mcp/project/my-server \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://new-url.example.com",
    "timeout": 120
  }'
```

---

## 删除服务器

```bash
curl -X DELETE /api/resource/mcp/project/my-server \
  -H "Authorization: Bearer <token>"
```

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | 配置无效 | 检查 URL 格式和必填字段 |
| 404 | 服务器不存在 | 检查 level 和 name |
| 409 | 同名服务器已存在 | 使用不同名称 |
| 502 | 连接服务器失败 | 检查 URL 和网络 |
