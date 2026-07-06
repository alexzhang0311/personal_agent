#!/usr/bin/env python3
"""MCP Server 脚手架生成器 — 快速创建 Streamable HTTP MCP 服务器项目骨架。

用法:
    python3 scaffold_mcp_server.py \
        --name my_server \
        --port 8200 \
        --target-dir /path/to/output \
        [--mode standalone|gateway] \
        [--tools get_status,query_data] \
        [--with-management dedicated|generic]
"""

import argparse
import os
import re
import stat
import sys
from pathlib import Path


# ─────────────────────────────── 模板 ───────────────────────────────

REQUIREMENTS_TXT = """\
mcp>=1.8.0
uvicorn[standard]>=0.32.0
loguru>=0.7.0
"""

STANDALONE_SERVER_TEMPLATE = '''\
import argparse
import uvicorn
from pathlib import Path
from typing import Annotated

from loguru import logger
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

mcp = FastMCP(
    name="{server_display_name}",
    json_response=False,
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


{tool_functions}


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    script_name = Path(__file__).stem
    log_file = script_dir / f"{{script_name}}.log"

    logger.remove()
    logger.add(
        log_file,
        rotation="00:00",
        retention="7 days",
        level="DEBUG",
        format="{{time:YYYY-MM-DD HH:mm:ss}} | {{level: <8}} | {{name}}:{{function}}:{{line}} - {{message}}",
    )

    parser = argparse.ArgumentParser(description="{server_display_name} MCP Server")
    parser.add_argument("--port", type=int, default={port}, help="监听端口")
    args = parser.parse_args()

    logger.info(f"Starting {server_display_name} on port {{args.port}}")
    uvicorn.run(mcp.streamable_http_app, host="0.0.0.0", port=args.port)
'''

GATEWAY_SERVER_TEMPLATE = '''\
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

# ── 常量（凭证和上游地址）──
# TODO: 替换为实际值
AUTH_KEY = "your-auth-key-here"
UPSTREAM_URL = "http://10.0.0.1:8080/mcp"

# ── 服务器 ──
mcp = FastMCP(
    name="{server_display_name}",
    json_response=False,
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


async def _call_upstream(url: str, tool_name: str, arguments: dict) -> str:
    """连接上游 MCP 服务器并调用指定工具，返回文本内容。"""
    async with AsyncExitStack() as stack:
        read_stream, write_stream, _ = await stack.enter_async_context(
            streamablehttp_client(url=url, headers={{}}, timeout=30)
        )
        session = await stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        parts = [block.text for block in result.content if hasattr(block, "text")]
        return "\\n".join(parts)


{tool_functions}


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    script_name = Path(__file__).stem
    log_file = script_dir / f"{{script_name}}.log"

    logger.remove()
    logger.add(
        log_file,
        rotation="00:00",
        retention="7 days",
        level="DEBUG",
        format="{{time:YYYY-MM-DD HH:mm:ss}} | {{level: <8}} | {{name}}:{{function}}:{{line}} - {{message}}",
    )

    parser = argparse.ArgumentParser(description="{server_display_name} MCP Gateway")
    parser.add_argument("--port", type=int, default={port}, help="监听端口")
    args = parser.parse_args()

    logger.info(f"Starting {server_display_name} gateway on port {{args.port}}")
    uvicorn.run(mcp.streamable_http_app, host="0.0.0.0", port=args.port)
'''

STANDALONE_TOOL_TEMPLATE = '''\
@mcp.tool(description="TODO: {tool_name} 的功能描述")
async def {tool_name}(
    param: Annotated[str, Field(description="TODO: 参数描述")] = "",
) -> str:
    """TODO: 补充文档。"""
    return f"{tool_name} called with param={{param}}"
'''

GATEWAY_TOOL_TEMPLATE = '''\
@mcp.tool(description="TODO: {tool_name} 的功能描述")
async def {tool_name}(
    param: Annotated[str, Field(description="TODO: 参数描述")] = "",
) -> str:
    """TODO: 补充文档。"""
    args = {{"param": param, "authKey": AUTH_KEY}}
    return await _call_upstream(UPSTREAM_URL, "{tool_name}", args)
'''

DEDICATED_SERVER_SH = '''\
#!/bin/bash

APP_NAME="{server_name}"
DEFAULT_PORT={port}

if [ $# -lt 1 ]; then
    echo "Usage: $0 {{start|stop|restart|status}} [port]"
    echo "  port: defaults to $DEFAULT_PORT"
    exit 1
fi

OPERATION="$1"
SERVER_PORT="${{2:-$DEFAULT_PORT}}"

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_APP="$APP_DIR/${{APP_NAME}}.py"
PID_FILE="$APP_DIR/${{APP_NAME}}.pid"
NOHUP_LOG="$APP_DIR/${{APP_NAME}}_nohup.log"

if [ ! -f "$PYTHON_APP" ]; then
    echo "Error: Python file \'$PYTHON_APP\' not found"
    exit 1
fi

is_running() {{
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            return 0
        else
            return 1
        fi
    else
        return 2
    fi
}}

start() {{
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
}}

stop() {{
    echo "Stopping $APP_NAME..."
    is_running
    status=$?
    if [ $status -eq 0 ]; then
        pid=$(cat "$PID_FILE")
        kill $pid
        for i in {{1..30}}; do
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
}}

restart() {{ stop; sleep 2; start; }}

status_cmd() {{
    is_running
    s=$?
    if [ $s -eq 0 ]; then
        echo "$APP_NAME is running (PID: $(cat $PID_FILE))"
    elif [ $s -eq 1 ]; then
        echo "$APP_NAME not running (stale PID file)"
    else
        echo "$APP_NAME is not running"
    fi
}}

case "$OPERATION" in
    start)   start      ;;
    stop)    stop       ;;
    restart) restart    ;;
    status)  status_cmd ;;
    *) echo "Error: Invalid operation \'$OPERATION\'"; exit 1 ;;
esac
exit 0
'''

GENERIC_MANAGE_SH = """#!/bin/bash

if [ $# -ne 3 ]; then
    echo "Usage: $0 {start|stop|restart} <app_name> <port>"
    echo ""
    echo "Generic MCP Server Management Script"
    echo ""
    echo "Example: $0 start my_server 8200"
    exit 1
fi

OPERATION="$1"
APP_NAME="$2"
SERVER_PORT="$3"

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
            return 1
        fi
    else
        return 2
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
    else
        echo "Failed to start $APP_NAME"
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
            kill -9 $pid
            sleep 1
        fi
        rm -f "$PID_FILE"
        echo "$APP_NAME stopped"
    elif [ $status -eq 1 ]; then
        rm -f "$PID_FILE"
        echo "$APP_NAME not running (stale PID removed)"
    else
        echo "$APP_NAME is not running"
    fi
}

restart() { stop; sleep 2; start; }

case "$OPERATION" in
    start)   start   ;;
    stop)    stop    ;;
    restart) restart ;;
    *) echo "Error: Invalid operation '$OPERATION'"; exit 1 ;;
esac
exit 0
"""


# ─────────────────────────── 生成逻辑 ───────────────────────────


def validate_name(name: str) -> bool:
    return bool(re.match(r'^[a-z][a-z0-9_]*$', name))


def generate_tool_functions(tools: list[str], mode: str) -> str:
    template = GATEWAY_TOOL_TEMPLATE if mode == "gateway" else STANDALONE_TOOL_TEMPLATE
    blocks = []
    for tool_name in tools:
        blocks.append(template.format(tool_name=tool_name))
    return "\n\n".join(blocks)


def write_file(path: Path, content: str, executable: bool = False) -> None:
    path.write_text(content, encoding="utf-8")
    if executable:
        st = path.stat()
        path.chmod(st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def main():
    parser = argparse.ArgumentParser(
        description="MCP Server 脚手架生成器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  python3 scaffold_mcp_server.py --name my_server --port 8200 --target-dir ./output\n"
            "  python3 scaffold_mcp_server.py --name gateway --port 8150 --target-dir ./output "
            "--mode gateway --tools query_user,send_msg\n"
        ),
    )
    parser.add_argument("--name", required=True, help="服务器名称 (snake_case)")
    parser.add_argument("--port", required=True, type=int, help="默认端口号")
    parser.add_argument("--target-dir", required=True, help="输出目录")
    parser.add_argument("--mode", choices=["standalone", "gateway"], default="standalone",
                        help="服务器模式 (默认: standalone)")
    parser.add_argument("--tools", default="", help="逗号分隔的 tool 名称列表")
    parser.add_argument("--with-management", choices=["dedicated", "generic"], default="dedicated",
                        help="管理脚本类型 (默认: dedicated)")

    args = parser.parse_args()

    if not validate_name(args.name):
        print(f"错误: 名称 '{args.name}' 无效，需要 snake_case 格式 (例: my_server)", file=sys.stderr)
        sys.exit(1)

    target = Path(args.target_dir)
    if not target.exists():
        target.mkdir(parents=True)

    server_display_name = args.name.replace("_", "-")
    tools = [t.strip() for t in args.tools.split(",") if t.strip()] if args.tools else []
    tool_functions = generate_tool_functions(tools, args.mode)

    # 选择模板
    if args.mode == "gateway":
        server_code = GATEWAY_SERVER_TEMPLATE.format(
            server_display_name=server_display_name,
            port=args.port,
            tool_functions=tool_functions,
        )
    else:
        server_code = STANDALONE_SERVER_TEMPLATE.format(
            server_display_name=server_display_name,
            port=args.port,
            tool_functions=tool_functions,
        )

    # 写入文件
    files_created = []

    server_file = target / f"{args.name}.py"
    write_file(server_file, server_code)
    files_created.append(server_file)

    req_file = target / "requirements.txt"
    write_file(req_file, REQUIREMENTS_TXT)
    files_created.append(req_file)

    if args.with_management == "dedicated":
        sh_file = target / "server.sh"
        write_file(sh_file, DEDICATED_SERVER_SH.format(
            server_name=args.name, port=args.port,
        ), executable=True)
        files_created.append(sh_file)
    else:
        sh_file = target / "manage_mcp_server.sh"
        write_file(sh_file, GENERIC_MANAGE_SH, executable=True)
        files_created.append(sh_file)

    # 输出摘要
    print(f"✓ 项目已生成: {target.resolve()}")
    print()
    for f in files_created:
        print(f"  {f.name}")
    print()
    print("后续步骤:")
    print(f"  1. cd {target.resolve()}")
    print(f"  2. pip install -r requirements.txt")
    if args.with_management == "dedicated":
        print(f"  3. ./server.sh start")
    else:
        print(f"  3. ./manage_mcp_server.sh start {args.name} {args.port}")
    print(f"  4. 编辑 {args.name}.py 中的 TODO 占位符")


if __name__ == "__main__":
    main()
