# 常见模式与代码片段

## Tool 参数模式

### 枚举参数 — 内部映射

对外使用语义化字符串，内部映射为上游 API 要求的编码：

```python
@mcp.tool(description="查询消息记录，支持按会话或对话查询")
async def get_messages(
    query_type: Annotated[str, Field(description="查询类型: 'session'=临时会话, 'conversation'=持久对话")],
) -> str:
    type_map = {"session": "1", "conversation": "2"}
    upstream_type = type_map.get(query_type, query_type)
    # ...
```

### 可选参数 — 条件填充

可选参数默认空字符串，只在有值时加入请求：

```python
@mcp.tool(description="发送消息")
async def send_message(
    content: Annotated[str, Field(description="消息内容")],
    title: Annotated[str, Field(description="标题，仅卡片消息时使用")] = "",
    url: Annotated[str, Field(description="跳转链接")] = "",
) -> str:
    args = {"content": content}
    if title:
        args["title"] = title
    if url:
        args["url"] = url
    return await _call_upstream(URL, "send", args)
```

### 多行描述

使用圆括号拼接多行字符串：

```python
@mcp.tool(description=(
    "发送企业微信消息。支持多种类型:\n"
    "- text(默认): content 为文本内容\n"
    "- image: content 为图片路径\n"
    "- card: 需填写 title 和 url"
))
async def send(content: ...) -> str:
    ...
```

---

## 响应处理模式

### JSON 安全解析 + 字段重命名

```python
import json

raw = await _call_upstream(URL, "query", args)
try:
    data = json.loads(raw)
    # 字段重命名：驼峰 → 下划线
    for item in data.get("itemList", []):
        if "itemId" in item:
            item["item_id"] = item.pop("itemId")
        if "itemName" in item:
            item["item_name"] = item.pop("itemName")
    return json.dumps(data, ensure_ascii=False)  # 保留中文
except (json.JSONDecodeError, TypeError):
    return raw  # 非 JSON 直接返回原文
```

---

## 多上游聚合模式

当网关代理多个上游服务时，用常量分组管理 URL：

```python
# ── 上游服务地址 ──
UPSTREAM_USER = "http://10.0.0.1:8001/mcp"     # 用户服务
UPSTREAM_ORDER = "http://10.0.0.1:8002/mcp"     # 订单服务
UPSTREAM_NOTIFY = "http://10.0.0.1:8003/mcp"    # 通知服务

@mcp.tool(description="查询用户信息")
async def query_user(user_id: ...) -> str:
    return await _call_upstream(UPSTREAM_USER, "getUser", {"id": user_id})

@mcp.tool(description="查询用户订单")
async def query_orders(user_id: ...) -> str:
    return await _call_upstream(UPSTREAM_ORDER, "listOrders", {"userId": user_id})

@mcp.tool(description="发送通知")
async def send_notify(user_id: ..., message: ...) -> str:
    return await _call_upstream(UPSTREAM_NOTIFY, "send", {"to": user_id, "msg": message})
```

---

## 环境变量配置模式

敏感信息不硬编码时，用环境变量 + 默认值：

```python
import os

AUTH_KEY = os.getenv("MCP_AUTH_KEY", "")
UPSTREAM_URL = os.getenv("MCP_UPSTREAM_URL", "http://localhost:8080/mcp")
DEFAULT_PORT = int(os.getenv("MCP_PORT", "8200"))

if not AUTH_KEY:
    logger.warning("MCP_AUTH_KEY not set, upstream calls will fail")
```

启动时传入：
```bash
MCP_AUTH_KEY=abc123 MCP_UPSTREAM_URL=http://10.0.0.1:8080/mcp python my_server.py
```

或写入 `.env` 文件配合管理脚本读取。

---

## 外部 HTTP API 集成

当需要调用非 MCP 的 HTTP API 时，用 `httpx`：

```python
import httpx

@mcp.tool(description="查询天气信息")
async def get_weather(
    city: Annotated[str, Field(description="城市名称")],
) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.example.com/weather",
            params={"city": city, "key": API_KEY},
        )
        resp.raise_for_status()
        return resp.text
```

> 记得在 requirements.txt 中添加 `httpx`。

---

## 数据库查询集成

使用 `aiomysql` 做异步 MySQL 查询：

```python
import aiomysql

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "db": os.getenv("DB_NAME", "mydb"),
}

@mcp.tool(description="查询数据库中的用户信息")
async def query_db_user(
    user_id: Annotated[str, Field(description="用户ID")],
) -> str:
    conn = await aiomysql.connect(**DB_CONFIG)
    try:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row = await cur.fetchone()
            return json.dumps(row, ensure_ascii=False, default=str) if row else "未找到用户"
    finally:
        conn.close()
```

> 记得在 requirements.txt 中添加 `aiomysql`。

---

## 调试技巧

### curl 测试初始化

```bash
curl -s http://localhost:8200/mcp/ \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

### curl 列出工具

```bash
curl -s http://localhost:8200/mcp/ \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
```

### curl 调用工具

```bash
curl -s http://localhost:8200/mcp/ \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"my_tool","arguments":{"param":"test"}},"id":3}'
```

### 查看日志

```bash
# 应用日志（loguru 输出）
tail -f my_server.log

# 启动日志（nohup 输出）
tail -f my_server_nohup.log
```

### 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| Connection refused | 服务未启动或端口不对 | 检查 `./server.sh status`，确认端口 |
| 403 Forbidden | DNS rebinding protection 开启 | 设置 `enable_dns_rebinding_protection=False` |
| Tool not found | 工具名拼写错误 | 先用 `tools/list` 列出所有工具名 |
| Timeout | 上游服务响应慢 | 增大 `streamablehttp_client` 的 `timeout` 参数 |
| 中文乱码 | JSON 序列化时 ASCII 转义 | 使用 `json.dumps(..., ensure_ascii=False)` |
