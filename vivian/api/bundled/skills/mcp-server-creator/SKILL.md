---
name: mcp-server-creator
description: >
  创建 Streamable HTTP MCP 服务器项目。当用户想要搭建新的 MCP Server、
  创建 MCP 工具服务、编写网关代理 MCP 服务器、生成服务管理脚本、
  或需要 FastMCP 相关帮助时使用此技能。
  触发词：MCP 服务器、MCP server、创建 MCP、搭建 MCP、MCP 网关、MCP gateway、
  streamable http、FastMCP、管理脚本、server.sh。
  即使用户没有明确说"MCP"，只要在描述需要创建一个暴露工具的 HTTP 服务，也应触发。
metadata:
  icon: Server
  icon_color: "#58a6ff"
---

# MCP Server 创建指南

帮助从零搭建基于 Streamable HTTP 传输的 MCP 服务器，包括服务器代码和管理脚本。

## 技术栈

| 组件 | 技术 |
|------|------|
| MCP 框架 | `mcp` (FastMCP) |
| ASGI 服务器 | `uvicorn` |
| 日志 | `loguru` |
| 类型标注 | `pydantic` (Field) |
| 运行管理 | Bash 脚本 (nohup + PID) |

## 路径变量约定

- `$TARGET_DIR` — 新项目的目标目录
- `$SKILL_PATH` — 本技能的安装路径（运行脚手架脚本时使用）

---

## 快速开始 — 脚手架脚本

运行 `scripts/scaffold_mcp_server.py` 可快速生成项目骨架：

```bash
python3 $SKILL_PATH/scripts/scaffold_mcp_server.py \
  --name my_server \
  --port 8200 \
  --target-dir $TARGET_DIR \
  --mode standalone \
  --tools get_status,query_data
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--name` | 是 | 服务器名称（snake_case，用于文件名和 FastMCP name） |
| `--port` | 是 | 默认端口号 |
| `--target-dir` | 是 | 输出目录 |
| `--mode` | 否 | `standalone`（默认）或 `gateway` |
| `--tools` | 否 | 逗号分隔的 tool 名称列表，生成占位函数 |
| `--with-management` | 否 | `dedicated`（默认，专用脚本）或 `generic`（通用脚本） |

生成后的项目结构：

```
$TARGET_DIR/
├── my_server.py          # 主服务器
├── server.sh             # 管理脚本
└── requirements.txt      # 依赖
```

**也可以不用脚手架脚本**——下面的模板代码都可以直接复制使用。

---

## 场景一：独立 MCP 服务器

适用于：直接实现业务逻辑的 MCP 服务器，工具函数内完成所有工作。

### 服务器初始化

```python
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

mcp = FastMCP(
    name="my-server",              # 服务器名称
    json_response=False,           # 返回原始文本，不做 JSON 包装
    stateless_http=True,           # 无状态 HTTP 模式
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,  # 允许内网 IP 连接
    ),
)
```

**关键参数说明：**
- `json_response=False` — 让 FastMCP 自动处理序列化，返回纯文本给调用方
- `stateless_http=True` — 每个请求独立，不维护会话状态，适合 HTTP 部署
- `enable_dns_rebinding_protection=False` — 内网部署时需要关闭，否则会拒绝非公网域名请求

### Tool 定义规范

```python
from typing import Annotated
from pydantic import Field

@mcp.tool(description="工具的中文描述，说明功能和使用场景")
async def my_tool(
    required_param: Annotated[str, Field(description="必填参数的中文说明")],
    optional_param: Annotated[str, Field(description="可选参数的中文说明")] = "",
) -> str:
    """函数文档字符串，补充说明用法和示例。"""
    # 实现业务逻辑
    result = f"处理结果: {required_param}"
    return result
```

**编写规范：**
- 参数类型用 `Annotated[type, Field(description="中文描述")]`
- 可选参数给默认值（通常为空字符串 `""`）
- 返回值统一为 `str`（MCP 协议传输）
- 函数必须是 `async def`
- description 用中文，面向 AI 调用方描述清楚：做什么、什么时候用、参数含义

### 入口点模板

```python
import argparse
import uvicorn
from pathlib import Path
from loguru import logger

if __name__ == "__main__":
    # 日志配置
    script_dir = Path(__file__).parent
    script_name = Path(__file__).stem
    log_file = script_dir / f"{script_name}.log"

    logger.remove()
    logger.add(
        log_file,
        rotation="00:00",       # 每天午夜轮转
        retention="7 days",     # 保留 7 天
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    )

    # 命令行参数
    parser = argparse.ArgumentParser(description="My MCP Server")
    parser.add_argument("--port", type=int, default=8200, help="监听端口")
    args = parser.parse_args()

    logger.info(f"Starting MCP server on port {args.port}")
    uvicorn.run(mcp.streamable_http_app, host="0.0.0.0", port=args.port)
```

### 完整最小示例

一个包含两个工具的可运行服务器：

```python
import argparse
import uvicorn
from pathlib import Path
from typing import Annotated

from loguru import logger
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

mcp = FastMCP(
    name="demo-server",
    json_response=False,
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


@mcp.tool(description="将两个数相加并返回结果")
async def add(
    a: Annotated[float, Field(description="第一个数")],
    b: Annotated[float, Field(description="第二个数")],
) -> str:
    """简单的加法计算。"""
    return str(a + b)


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    script_name = Path(__file__).stem
    log_file = script_dir / f"{script_name}.log"

    logger.remove()
    logger.add(
        log_file,
        rotation="00:00",
        retention="7 days",
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    )

    parser = argparse.ArgumentParser(description="Demo MCP Server")
    parser.add_argument("--port", type=int, default=8200, help="监听端口")
    args = parser.parse_args()

    logger.info(f"Starting demo MCP server on port {args.port}")
    uvicorn.run(mcp.streamable_http_app, host="0.0.0.0", port=args.port)
```

---

## 场景二：网关 MCP 服务器

适用于：聚合多个上游 MCP 服务器、做参数转换/权限注入、统一对外暴露接口。

### 架构

```
Claude / 调用方
      │
      ├─ Streamable HTTP
      │
  ┌───▼─────────────────────────┐
  │   网关 MCP Server           │
  │   - 参数转换                │
  │   - 凭证注入                │
  └───┬─────────────────────────┘
      │
      ├─► 上游 MCP Server A
      ├─► 上游 MCP Server B
      └─► 上游 MCP Server C
```

### _call_upstream 通用调用函数

```python
from contextlib import AsyncExitStack
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def _call_upstream(url: str, tool_name: str, arguments: dict) -> str:
    """连接上游 MCP 服务器并调用指定工具，返回文本内容。"""
    async with AsyncExitStack() as stack:
        read_stream, write_stream, _ = await stack.enter_async_context(
            streamablehttp_client(url=url, headers={}, timeout=30)
        )
        session = await stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        parts = [block.text for block in result.content if hasattr(block, "text")]
        return "\n".join(parts)
```

### 网关 Tool 编写模式

```python
# ── 常量（凭证和上游地址，不暴露为 tool 参数）──
AUTH_KEY = "your-auth-key-here"           # TODO: 替换为实际凭证
UPSTREAM_API = "http://10.0.0.1:8080/mcp" # TODO: 替换为实际地址

@mcp.tool(description="查询用户信息，根据用户ID返回详细资料")
async def query_user(
    user_id: Annotated[str, Field(description="用户ID")],
) -> str:
    """根据用户ID查询信息。凭证自动注入，调用方无需传递。"""
    # 参数映射：对外友好命名 → 上游 API 命名
    args = {
        "userId": user_id,
        "authKey": AUTH_KEY,        # 凭证注入
    }
    return await _call_upstream(UPSTREAM_API, "getUserInfo", args)
```

### 响应后处理模式

```python
import json

@mcp.tool(description="查询订单列表")
async def query_orders(
    status: Annotated[str, Field(description="订单状态: 'pending'=待处理, 'done'=已完成")],
) -> str:
    # 枚举映射
    status_map = {"pending": "1", "done": "2"}
    upstream_status = status_map.get(status, status)

    raw = await _call_upstream(UPSTREAM_API, "queryOrders", {"status": upstream_status})

    # JSON 响应处理 + 字段重命名
    try:
        data = json.loads(raw)
        for item in data.get("list", []):
            if "orderId" in item:
                item["order_id"] = item.pop("orderId")
        return json.dumps(data, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return raw
```

### 完整网关示例

```python
import argparse
import json
import uvicorn
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Annotated

from loguru import logger
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

# ── 常量 ──
AUTH_KEY = "your-auth-key"                    # TODO: 替换
UPSTREAM_URL = "http://10.0.0.1:8080/mcp"    # TODO: 替换

# ── 服务器 ──
mcp = FastMCP(
    name="my-gateway",
    json_response=False,
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


async def _call_upstream(url: str, tool_name: str, arguments: dict) -> str:
    async with AsyncExitStack() as stack:
        read_stream, write_stream, _ = await stack.enter_async_context(
            streamablehttp_client(url=url, headers={}, timeout=30)
        )
        session = await stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        parts = [block.text for block in result.content if hasattr(block, "text")]
        return "\n".join(parts)


@mcp.tool(description="通过网关查询上游服务的数据")
async def query_data(
    keyword: Annotated[str, Field(description="查询关键词")],
) -> str:
    args = {"keyword": keyword, "authKey": AUTH_KEY}
    return await _call_upstream(UPSTREAM_URL, "search", args)


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    script_name = Path(__file__).stem
    log_file = script_dir / f"{script_name}.log"

    logger.remove()
    logger.add(
        log_file, rotation="00:00", retention="7 days", level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    )

    parser = argparse.ArgumentParser(description="Gateway MCP Server")
    parser.add_argument("--port", type=int, default=8200, help="监听端口")
    args = parser.parse_args()

    logger.info(f"Starting gateway on port {args.port}")
    uvicorn.run(mcp.streamable_http_app, host="0.0.0.0", port=args.port)
```

---

## 场景三：管理脚本

### 专用管理脚本（推荐）

适用于单服务器项目。提供 start/stop/restart/status 四个操作、默认端口、PID 管理、优雅关闭。

用法：
```bash
chmod +x server.sh
./server.sh start [port]     # 启动，port 可选，有默认值
./server.sh stop             # 停止（SIGTERM → 30s → SIGKILL）
./server.sh restart [port]   # 重启
./server.sh status           # 查看运行状态
```

完整模板（将 `APP_NAME` 和 `DEFAULT_PORT` 替换为实际值）：

```bash
#!/bin/bash

APP_NAME="my_server"        # TODO: 替换为你的服务器文件名（不含 .py）
DEFAULT_PORT=8200            # TODO: 替换为你的默认端口

if [ $# -lt 1 ]; then
    echo "Usage: $0 {start|stop|restart|status} [port]"
    echo "  port: defaults to $DEFAULT_PORT"
    exit 1
fi

OPERATION="$1"
SERVER_PORT="${2:-$DEFAULT_PORT}"

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_APP="$APP_DIR/${APP_NAME}.py"
PID_FILE="$APP_DIR/${APP_NAME}.pid"
NOHUP_LOG="$APP_DIR/${APP_NAME}_nohup.log"

if [ ! -f "$PYTHON_APP" ]; then
    echo "Error: Python file '$PYTHON_APP' not found"
    exit 1
fi

is_running() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            return 0
        else
            return 1  # stale PID
        fi
    else
        return 2  # no PID file
    fi
}

start() {
    echo "Starting $APP_NAME..."
    is_running
    status=$?
    if [ $status -eq 0 ]; then
        echo "$APP_NAME is already running (PID: $(cat $PID_FILE))"
        exit 1
    fi
    [ $status -eq 1 ] && rm -f "$PID_FILE"

    cd "$APP_DIR"
    nohup python "$PYTHON_APP" --port "$SERVER_PORT" > "$NOHUP_LOG" 2>&1 &
    bg_pid=$!
    sleep 2

    if ps -p $bg_pid > /dev/null 2>&1; then
        echo $bg_pid > "$PID_FILE"
        echo "$APP_NAME started (PID: $bg_pid, port: $SERVER_PORT)"
        echo "--- startup log ---"
        tail -20 "$NOHUP_LOG"
    else
        echo "Failed to start $APP_NAME"
        echo "--- error log ---"
        tail -30 "$NOHUP_LOG"
        exit 1
    fi
}

stop() {
    echo "Stopping $APP_NAME..."
    is_running
    status=$?
    if [ $status -eq 0 ]; then
        pid=$(cat "$PID_FILE")
        kill $pid
        for i in {1..30}; do
            ps -p $pid > /dev/null 2>&1 || break
            echo "Waiting ($i/30)..."
            sleep 1
        done
        if ps -p $pid > /dev/null 2>&1; then
            echo "Force killing..."
            kill -9 $pid
            sleep 1
        fi
        rm -f "$PID_FILE"
        echo "$APP_NAME stopped"
    elif [ $status -eq 1 ]; then
        echo "$APP_NAME not running (stale PID file removed)"
        rm -f "$PID_FILE"
    else
        echo "$APP_NAME is not running"
    fi
}

restart() { stop; sleep 2; start; }

status_cmd() {
    is_running
    s=$?
    if [ $s -eq 0 ]; then
        echo "$APP_NAME is running (PID: $(cat $PID_FILE))"
    elif [ $s -eq 1 ]; then
        echo "$APP_NAME not running (stale PID file)"
    else
        echo "$APP_NAME is not running"
    fi
}

case "$OPERATION" in
    start)   start      ;;
    stop)    stop       ;;
    restart) restart    ;;
    status)  status_cmd ;;
    *) echo "Error: Invalid operation '$OPERATION'"; exit 1 ;;
esac
exit 0
```

### 通用管理脚本

适用于同一目录下管理多个 MCP 服务器。无默认端口，需显式传参。

用法：
```bash
./manage_mcp_server.sh start my_server 8200
./manage_mcp_server.sh stop my_server 8200
./manage_mcp_server.sh restart my_server 8200
```

**推荐优先使用专用脚本**，除非同一目录有多个服务器需要统一管理。

---

## 依赖管理

### requirements.txt

```
mcp>=1.8.0
uvicorn[standard]>=0.32.0
loguru>=0.7.0
```

> `pydantic` 已包含在 `mcp` 的依赖中，无需单独安装。
> 如需调用非 MCP 的 HTTP API，额外安装 `httpx`。

### 安装

```bash
pip install -r requirements.txt
```

---

## 部署检查清单

- [ ] 端口无冲突（`lsof -i :<port>` 检查）
- [ ] 防火墙 / 安全组已开放端口
- [ ] 管理脚本有可执行权限（`chmod +x server.sh`）
- [ ] 日志目录有写权限
- [ ] 启动后验证：`curl -s http://<host>:<port>/mcp/ -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}'` 返回 JSON 响应
- [ ] 在 Vivian MCP 标签页添加服务器（类型: HTTP，URL: `http://<host>:<port>/mcp/`）

---

## 参考文件

更深入的架构解释和代码模式集合：

- `references/architecture.md` — Streamable HTTP 传输机制、FastMCP 框架、进程管理原理
- `references/patterns.md` — Tool 参数模式、响应处理、外部集成、调试技巧
