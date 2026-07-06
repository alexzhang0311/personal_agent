# MCP Server 架构详解

## Streamable HTTP 传输机制

MCP 协议支持三种传输方式：

| 传输方式 | 适用场景 | 特点 |
|---------|---------|------|
| **stdio** | 本地进程（Claude Desktop 插件） | 通过标准输入输出通信，最简单 |
| **SSE** | 旧版远程服务 | Server-Sent Events，单向流 |
| **Streamable HTTP** | 远程 HTTP 服务（推荐） | 无状态 HTTP + 可选流式响应 |

**为什么选 Streamable HTTP：**

- 标准 HTTP 部署，兼容负载均衡、反向代理、防火墙
- `stateless_http=True` 时每个请求独立，服务器可水平扩展
- 既支持同步响应也支持流式（长任务场景）
- MCP 官方推荐的远程传输方式

## FastMCP 初始化参数

```python
mcp = FastMCP(
    name="server-name",
    json_response=False,
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)
```

### `stateless_http=True`

- 服务器不在内存中维护客户端会话状态
- 每个 HTTP 请求都是独立完整的 JSON-RPC 调用
- 优势：可部署多个实例做负载均衡，进程重启不丢失状态
- 如果需要有状态交互（如多轮对话需要服务端记忆），设为 `False`

### `json_response=False`

- Tool 函数返回 `str` 时，FastMCP 将其包装为 `TextContent` 块
- 设为 `True` 则会尝试 JSON 序列化返回值，额外包一层
- 推荐 `False`：调用方（Claude）直接拿到文本，更简洁

### `TransportSecuritySettings`

```python
from mcp.server.transport_security import TransportSecuritySettings
```

- `enable_dns_rebinding_protection=False` — 关闭 DNS 重绑定防护
- 内网部署时**必须关闭**，否则请求来自内网 IP（非公网域名）会被拒绝
- 公网部署 + 绑定域名时可以开启

## FastMCP vs 底层 MCP Server

FastMCP 是 `mcp.server.Server` 的高级封装：

- `@mcp.tool()` 装饰器自动注册工具、生成 JSON Schema
- `mcp.streamable_http_app` 属性返回一个 ASGI 应用，可直接传给 uvicorn
- 自动处理 `initialize`、`list_tools`、`call_tool` 等 MCP 协议方法
- 内部使用 Pydantic 做参数校验

如果不需要自定义协议行为，直接用 FastMCP 即可。

## 网关架构

```
Claude / 调用方
      │
      │ HTTP POST /mcp/
      │
  ┌───▼─────────────────────────────┐
  │   网关 MCP Server (FastMCP)     │
  │                                 │
  │   @mcp.tool("query_data")       │
  │     ├─ 参数转换（友好名→API名） │
  │     ├─ 凭证注入（AUTH_KEY）     │
  │     └─ _call_upstream(url, ...) │
  └───┬─────────────────────────────┘
      │
      │ streamablehttp_client
      │
  ┌───▼─────────────────────────────┐
  │   上游 MCP Server               │
  │   （被代理的真实服务）           │
  └─────────────────────────────────┘
```

**每次工具调用都建立新连接：** 因为网关自身是 `stateless_http=True`，不持有持久连接。`_call_upstream` 内部通过 `AsyncExitStack` 管理连接生命周期，函数返回后自动关闭。

### AsyncExitStack 生命周期

```python
async with AsyncExitStack() as stack:
    # 1. 建立传输连接（HTTP stream）
    read_stream, write_stream, _ = await stack.enter_async_context(
        streamablehttp_client(url=url, headers={}, timeout=30)
    )
    # 2. 建立 MCP 会话
    session = await stack.enter_async_context(
        ClientSession(read_stream, write_stream)
    )
    # 3. 协议握手
    await session.initialize()
    # 4. 调用工具
    result = await session.call_tool(tool_name, arguments=arguments)
    # 5. 退出 with 块时，自动关闭 session → 关闭 stream
```

`AsyncExitStack` 确保即使发生异常，所有资源也会被正确释放。这是 Python 异步资源管理的标准模式。

## 进程管理

### nohup + PID 文件模式

```
启动: nohup python server.py --port 8200 > nohup.log 2>&1 &
      → 记录 $! 到 .pid 文件
      → sleep 2 确认进程存活

停止: 读取 .pid → kill PID (SIGTERM)
      → 等待最多 30 秒
      → 仍存活则 kill -9 (SIGKILL)
      → 删除 .pid 文件
```

**为什么不用 systemd / supervisor：**

- 开发和小规模部署场景足够
- 无需 root 权限
- 脚本可直接放在项目目录中
- 适合容器化前的过渡阶段

生产环境大规模部署建议用 systemd unit 或 Docker 容器。

### 信号处理

- **SIGTERM（默认 kill）：** uvicorn 收到后会完成当前请求、关闭监听、退出
- **SIGKILL（kill -9）：** 强制终止，不执行清理，仅作为最后手段
- 30 秒超时足以让绝大多数请求完成

## 日志架构

### loguru vs stdlib logging

选择 loguru 的原因：
- 开箱即用的日志轮转（无需 `RotatingFileHandler` 配置）
- 更友好的格式化（时间、级别、调用位置）
- `logger.remove()` 清除默认 stderr 输出
- 一行代码配置文件日志

### 日志分工

| 日志文件 | 来源 | 内容 |
|---------|------|------|
| `{name}.log` | loguru | 应用层日志（工具调用、业务逻辑、错误） |
| `{name}_nohup.log` | nohup 重定向 | 启动阶段输出、未捕获异常、uvicorn 启动日志 |

### 轮转策略

```python
logger.add(log_file, rotation="00:00", retention="7 days", level="DEBUG", ...)
```

- `rotation="00:00"` — 每天午夜创建新日志文件
- `retention="7 days"` — 自动删除 7 天前的旧日志
- `level="DEBUG"` — 开发期全量记录，生产环境可改为 `"INFO"`

## 端口规划建议

建议为 MCP 服务器预留端口段：

| 范围 | 用途 |
|------|------|
| 8100–8149 | 基础设施类服务 |
| 8150–8199 | 业务网关类服务 |
| 8200–8249 | 业务工具类服务 |
| 8250–8299 | 开发/测试用 |

避免与常见服务冲突：8080 (HTTP alt)、8443 (HTTPS alt)、8888 (Jupyter)。
