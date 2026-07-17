#!/bin/bash

# Vivian API Server Management Script
# Usage: ./server.sh {start|stop|restart|status}

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_FILE="${SCRIPT_DIR}/server.pid"
SCHEDULER_PID_FILE="${SCRIPT_DIR}/scheduler.pid"
CONFIG_FILE="${PROJECT_ROOT}/api/config.yaml"
LOG_DIR="${PROJECT_ROOT}/logs"
SERVER_LOG="${LOG_DIR}/server.log"
APP_LOG="${LOG_DIR}/app.log"
ACCESS_LOG="${LOG_DIR}/access.log"
SERVER_LOG_START_OFFSET=0

# Server runtime options (can be overridden via environment variables)
WORKERS="${WORKERS:-1}"
API_APP="api.main:app"

# Enable the Monitor tool (gated by the tengu_amber_sentinel Statsig flag in
# the bundled Claude CLI). Exported so server / scheduler / channels children
# all inherit it.
export ANTHROPIC_STATSIG_OVERRIDE_tengu_amber_sentinel="${ANTHROPIC_STATSIG_OVERRIDE_tengu_amber_sentinel:-true}"

# Bypass the local system proxy (Clash/Surge TUN, 127.0.0.1:7892) for the
# upstream LLM gateway. The gateway's API key is IP-allowlisted to this host's
# wired NIC (en0); when httpx/anthropic-sdk honor the macOS system proxy they
# egress via Wi-Fi and get a 403 "IP not allowed". NO_PROXY makes httpx connect
# directly so it follows the en0 host route instead. Comma-separated hosts;
# override via env for other gateway addresses.
export NO_PROXY="${NO_PROXY:-172.21.11.82,localhost,127.0.0.1}"
export no_proxy="${no_proxy:-$NO_PROXY}"

# Per-deployment state dir parent. The app appends 'vivian':
#   $VIVIAN_HOME/vivian/.vivian.settings.yml
#   $VIVIAN_HOME/vivian/.vivian.audit.jsonl
# Override per instance for multi-instance deploys on one host.
export VIVIAN_HOME="${VIVIAN_HOME:-$HOME/.config}"

# Prometheus multiprocess metrics dir. Owned by this script: wiped every boot
# (just before uvicorn launch) so counters never carry stale inflation across
# restarts. Shared by all uvicorn workers.
export PROMETHEUS_MULTIPROC_DIR="${VIVIAN_HOME}/vivian/.prometheus-multiproc"

# Select a Python interpreter that can read YAML config and run uvicorn.
select_python_bin() {
    local candidates=()

    if [ -n "${PYTHON_BIN:-}" ]; then
        candidates+=("${PYTHON_BIN}")
    fi
    candidates+=("python" "python3")

    for candidate in "${candidates[@]}"; do
        if ! command -v "${candidate}" >/dev/null 2>&1; then
            continue
        fi

        if "${candidate}" - <<'PY' >/dev/null 2>&1
import importlib.util
import sys

required = ("yaml", "uvicorn")
missing = [name for name in required if importlib.util.find_spec(name) is None]
sys.exit(0 if not missing else 1)
PY
        then
            echo "${candidate}"
            return 0
        fi
    done

    return 1
}

PYTHON_BIN=$(select_python_bin) || {
    echo "[ERROR] Could not find a Python interpreter with both 'yaml' and 'uvicorn' installed." >&2
    exit 1
}

# Read settings from config.yaml via Python
read_config() {
    local key="$1" default="$2"
    "${PYTHON_BIN}" -c "
import yaml
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f) or {}
value = cfg
for part in '${key}'.split('.'):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        value = '${default}'
        break
print('${default}' if value is None else value)
" 2>/dev/null || echo "${default}"
}

HOST=$(read_config server.host 0.0.0.0)
PORT=$(read_config server.port 8001)
DEBUG="${DEBUG:-$(read_config server.debug False)}"
ENABLE_RELOAD="${ENABLE_RELOAD:-auto}"
SERVER_LOG=$(read_config logging.server.path logs/server.log)
APP_LOG=$(read_config logging.app.path logs/app.log)
ACCESS_LOG=$(read_config logging.access.path logs/access.log)

if [[ "${SERVER_LOG}" != /* ]]; then
    SERVER_LOG="${PROJECT_ROOT}/${SERVER_LOG}"
fi
if [[ "${APP_LOG}" != /* ]]; then
    APP_LOG="${PROJECT_ROOT}/${APP_LOG}"
fi
if [[ "${ACCESS_LOG}" != /* ]]; then
    ACCESS_LOG="${PROJECT_ROOT}/${ACCESS_LOG}"
fi
LOG_DIR="$(dirname "${SERVER_LOG}")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Get the main process PID
get_pid() {
    if [ -f "${PID_FILE}" ]; then
        cat "${PID_FILE}"
    else
        echo ""
    fi
}

# Remove a stale PID file if the recorded process no longer exists.
clear_stale_pid_file() {
    local pid
    pid=$(get_pid)
    if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
        log_warn "Removing stale PID file for non-existent process ${pid}"
        rm -f "${PID_FILE}"
    fi
}

# Capture the process table once and derive descendants from that fixed view.
# Avoid recursive pgrep: status can be run from a Vivian child process, and a
# live recursive scan may chase the shell/pgrep/ps processes it just created.
get_process_snapshot() {
    if command -v ps &> /dev/null; then
        ps -eo pid=,ppid=,comm= 2>/dev/null || true
    fi
}

get_process_tree_from_snapshot() {
    local pid=$1
    local snapshot=$2

    if [ -z "${pid}" ]; then
        return 0
    fi

    if [ -z "${snapshot}" ]; then
        echo "${pid}"
        return 0
    fi

    printf '%s\n' "${snapshot}" | awk -v root="${pid}" '
        {
            pid = $1
            ppid = $2
            children[ppid] = children[ppid] " " pid
        }
        function walk(pid,    parts, count, i, child) {
            if (seen[pid]++) {
                return
            }
            print pid
            count = split(children[pid], parts, " ")
            for (i = 1; i <= count; i++) {
                child = parts[i]
                if (child != "") {
                    walk(child)
                }
            }
        }
        END {
            walk(root)
        }
    '
}

# Get all process tree (parent + all descendants)
get_process_tree() {
    local pid=$1
    local snapshot
    snapshot=$(get_process_snapshot)
    get_process_tree_from_snapshot "${pid}" "${snapshot}"
}

print_process_tree_from_snapshot() {
    local pid=$1
    local snapshot=$2

    if [ -z "${pid}" ]; then
        return 0
    fi

    printf '%s\n' "${snapshot}" | awk -v root="${pid}" '
        {
            pid = $1
            ppid = $2
            cmd = $3
            parent[pid] = ppid
            command[pid] = cmd
            children[ppid] = children[ppid] " " pid
        }
        function print_row(pid, role,    ppid, cmd) {
            ppid = (pid in parent) ? parent[pid] : "?"
            cmd = (pid in command) ? command[pid] : "?"
            printf "  %-8s  %-8s  %s (%s)\n", pid, ppid, cmd, role
        }
        function walk(pid, role,    parts, count, i, child) {
            if (seen[pid]++) {
                return
            }
            print_row(pid, role)
            count = split(children[pid], parts, " ")
            for (i = 1; i <= count; i++) {
                child = parts[i]
                if (child != "") {
                    walk(child, "child")
                }
            }
        }
        END {
            walk(root, "main")
        }
    '
}

# Check if process is running
is_running() {
    local pid=$(get_pid)
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Check if port is in use
is_port_in_use() {
    if command -v lsof &> /dev/null; then
        lsof -i :"${PORT}" &>/dev/null
    elif command -v ss &> /dev/null; then
        ss -tuln | grep -q ":${PORT} "
    elif command -v netstat &> /dev/null; then
        netstat -tuln | grep -q ":${PORT} "
    else
        return 1
    fi
}

# Return PIDs currently listening on the configured port.
get_port_pids() {
    if command -v lsof &> /dev/null; then
        lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u
    fi
}

# Print the processes currently listening on the configured port.
describe_port_usage() {
    if ! is_port_in_use; then
        return 0
    fi

    log_warn "Processes listening on port ${PORT}:"
    if command -v lsof &> /dev/null; then
        lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | while read line; do
            echo "  ${line}"
        done
    elif command -v ss &> /dev/null; then
        ss -ltnp | grep ":${PORT} " | while read line; do
            echo "  ${line}"
        done
    else
        echo "  (port is in use, but no process inspection tool is available)"
    fi
}

# Verify the live app exposes the expected API routes before reporting startup success.
verify_api_routes() {
    "${PYTHON_BIN}" - "${HOST}" "${PORT}" <<'PY'
import json
import sys
import urllib.request

host = sys.argv[1]
port = sys.argv[2]
if host == "0.0.0.0":
    host = "127.0.0.1"

url = f"http://{host}:{port}/openapi.json"
try:
    with urllib.request.urlopen(url, timeout=3) as response:
        data = json.load(response)
except Exception:
    raise SystemExit(1)

paths = data.get("paths", {})
required = {
    "/api/agent/run": "post",
    "/api/agent/run/stream": "post",
    "/api/agent/permission/respond": "post",
}

for path, method in required.items():
    if method not in paths.get(path, {}):
        raise SystemExit(2)
PY
}

read_new_server_log() {
    if [ ! -f "${SERVER_LOG}" ]; then
        return 0
    fi

    local current_size
    current_size=$(wc -c < "${SERVER_LOG}" 2>/dev/null || echo "0")

    if [ "${current_size}" -lt "${SERVER_LOG_START_OFFSET}" ]; then
        cat "${SERVER_LOG}" 2>/dev/null || true
        return 0
    fi

    if [ "${current_size}" -eq "${SERVER_LOG_START_OFFSET}" ]; then
        return 0
    fi

    tail -c +"$((SERVER_LOG_START_OFFSET + 1))" "${SERVER_LOG}" 2>/dev/null || true
}

print_recent_startup_log() {
    local recent_log
    recent_log=$(read_new_server_log | tail -50)

    if [ -n "${recent_log}" ]; then
        log_error "Last lines from this startup attempt:"
        printf '%s\n' "${recent_log}"
    else
        log_error "No new server log output was captured for this startup attempt"
    fi
}

has_explicit_startup_failure() {
    read_new_server_log | tail -200 | grep -qE \
        'CRITICAL|FATAL|Traceback \(most recent call last\):|ImportError:|ModuleNotFoundError:|Error loading ASGI app|Application startup failed'
}

# Wait for startup with route verification
wait_for_startup() {
    local timeout=30
    local interval=1
    local elapsed=0

    log_info "Waiting for server to start (timeout: ${timeout}s)..."

    while [ ${elapsed} -lt ${timeout} ]; do
        if verify_api_routes; then
            if read_new_server_log | tail -200 | grep -qE "ERROR|error|Error|Exception|Traceback"; then
                log_warn "Server started but recent errors were detected in server log"
            fi
            return 0
        fi

        # Check only this startup attempt for explicit bootstrap failures. Avoid
        # a generic ERROR match because applications may log recoverable errors.
        if has_explicit_startup_failure; then
            log_error "Explicit startup failure detected in server log"
            print_recent_startup_log
            return 1
        fi

        # Check if process is still running
        if ! is_running; then
            log_error "Server process terminated unexpectedly"
            print_recent_startup_log
            return 1
        fi

        if is_port_in_use; then
            log_debug "Port ${PORT} is live, but expected API routes are not available yet"
        fi

        sleep ${interval}
        elapsed=$((elapsed + interval))
    done

    log_error "Server startup timed out after ${timeout}s"
    if is_port_in_use; then
        describe_port_usage
        log_error "The process on port ${PORT} did not expose the expected API routes"
    fi
    print_recent_startup_log
    return 1
}

# --- Scheduler daemon management ---

SCHEDULER_LOG=$(read_config logging.scheduler.path logs/scheduler.log)
if [[ "${SCHEDULER_LOG}" != /* ]]; then
    SCHEDULER_LOG="${PROJECT_ROOT}/${SCHEDULER_LOG}"
fi

HEARTBEAT_INTERVAL=$(read_config scheduler.heartbeat_interval 5.0)

get_scheduler_pid() {
    if [ -f "${SCHEDULER_PID_FILE}" ]; then
        cat "${SCHEDULER_PID_FILE}"
    else
        echo ""
    fi
}

is_scheduler_running() {
    local pid=$(get_scheduler_pid)
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

clear_stale_scheduler_pid() {
    local pid=$(get_scheduler_pid)
    if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
        log_warn "Removing stale scheduler PID file for non-existent process ${pid}"
        rm -f "${SCHEDULER_PID_FILE}"
    fi
}

start_scheduler() {
    clear_stale_scheduler_pid

    if is_scheduler_running; then
        log_warn "Scheduler daemon is already running (PID: $(get_scheduler_pid))"
        return 0
    fi

    mkdir -p "$(dirname "${SCHEDULER_LOG}")"
    log_info "Starting scheduler daemon..."

    cd "${PROJECT_ROOT}"
    nohup ${PYTHON_BIN} -m api.services.scheduler.daemon >/dev/null 2>&1 &
    local pid=$!
    echo "${pid}" > "${SCHEDULER_PID_FILE}"
    log_info "Scheduler daemon started with PID: ${pid}"

    # Wait for fresh heartbeat
    local timeout=15
    local elapsed=0
    local start_ts=$(date +%s)

    while [ ${elapsed} -lt ${timeout} ]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_error "Scheduler daemon terminated unexpectedly"
            rm -f "${SCHEDULER_PID_FILE}"
            return 1
        fi

        # Check heartbeat freshness
        local hb_file
        hb_file=$("${PYTHON_BIN}" -c "
import yaml, os
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f) or {}
work_dir = cfg.get('server', {}).get('work_dir', '~/vivian_workspace')
work_dir = os.path.expanduser(work_dir)
print(os.path.join(work_dir, '.scheduler', 'heartbeat'))
" 2>/dev/null)

        if [ -f "${hb_file}" ]; then
            local hb_ts
            hb_ts=$("${PYTHON_BIN}" -c "
from datetime import datetime, timezone
with open('${hb_file}') as f:
    ts = f.read().strip()
dt = datetime.fromisoformat(ts)
print(int(dt.timestamp()))
" 2>/dev/null || echo "0")
            if [ "${hb_ts}" -ge "${start_ts}" ] 2>/dev/null; then
                log_info "Scheduler daemon heartbeat verified"
                return 0
            fi
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_error "Scheduler daemon heartbeat never appeared (timeout: ${timeout}s)"
    return 1
}

stop_scheduler() {
    clear_stale_scheduler_pid

    local pid=$(get_scheduler_pid)
    if [ -z "${pid}" ]; then
        log_warn "Scheduler daemon is not running"
        rm -f "${SCHEDULER_PID_FILE}"
        return 0
    fi

    log_info "Stopping scheduler daemon (PID: ${pid})..."
    kill -TERM "${pid}" 2>/dev/null || true

    local timeout=15
    local elapsed=0
    while [ ${elapsed} -lt ${timeout} ]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_info "Scheduler daemon terminated gracefully"
            rm -f "${SCHEDULER_PID_FILE}"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_warn "Scheduler daemon did not stop gracefully, sending SIGKILL..."
    kill -9 "${pid}" 2>/dev/null || true
    rm -f "${SCHEDULER_PID_FILE}"
    return 0
}

# --- Channels daemon management ---

CHANNELS_PID_FILE="${SCRIPT_DIR}/channels.pid"
CHANNELS_LOG=$(read_config logging.channels.path logs/channels.log)
if [[ "${CHANNELS_LOG}" != /* ]]; then
    CHANNELS_LOG="${PROJECT_ROOT}/${CHANNELS_LOG}"
fi

get_channels_pid() {
    if [ -f "${CHANNELS_PID_FILE}" ]; then
        cat "${CHANNELS_PID_FILE}"
    else
        echo ""
    fi
}

is_channels_running() {
    local pid=$(get_channels_pid)
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

clear_stale_channels_pid() {
    local pid=$(get_channels_pid)
    if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
        log_warn "Removing stale channels PID file for non-existent process ${pid}"
        rm -f "${CHANNELS_PID_FILE}"
    fi
}

start_channels() {
    clear_stale_channels_pid

    if is_channels_running; then
        log_warn "Channels daemon is already running (PID: $(get_channels_pid))"
        return 0
    fi

    mkdir -p "$(dirname "${CHANNELS_LOG}")"
    log_info "Starting channels daemon..."

    cd "${PROJECT_ROOT}"
    nohup ${PYTHON_BIN} -m api.services.channels.daemon >/dev/null 2>&1 &
    local pid=$!
    echo "${pid}" > "${CHANNELS_PID_FILE}"
    log_info "Channels daemon started with PID: ${pid}"

    # Wait for fresh heartbeat
    local timeout=15
    local elapsed=0
    local start_ts=$(date +%s)

    while [ ${elapsed} -lt ${timeout} ]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_error "Channels daemon terminated unexpectedly"
            rm -f "${CHANNELS_PID_FILE}"
            return 1
        fi

        # Check heartbeat freshness
        local hb_file
        hb_file=$("${PYTHON_BIN}" -c "
import yaml, os
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f) or {}
work_dir = cfg.get('server', {}).get('work_dir', '~/vivian_workspace')
work_dir = os.path.expanduser(work_dir)
print(os.path.join(work_dir, '.channels', 'heartbeat'))
" 2>/dev/null)

        if [ -f "${hb_file}" ]; then
            local hb_ts
            hb_ts=$("${PYTHON_BIN}" -c "
with open('${hb_file}') as f:
    ts = f.read().strip()
print(int(float(ts)))
" 2>/dev/null || echo "0")
            if [ "${hb_ts}" -ge "${start_ts}" ] 2>/dev/null; then
                log_info "Channels daemon heartbeat verified"
                return 0
            fi
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_error "Channels daemon heartbeat never appeared (timeout: ${timeout}s)"
    return 1
}

stop_channels() {
    clear_stale_channels_pid

    local pid=$(get_channels_pid)
    if [ -z "${pid}" ]; then
        log_warn "Channels daemon is not running"
        rm -f "${CHANNELS_PID_FILE}"
        return 0
    fi

    log_info "Stopping channels daemon (PID: ${pid})..."
    kill -TERM "${pid}" 2>/dev/null || true

    local timeout=15
    local elapsed=0
    while [ ${elapsed} -lt ${timeout} ]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_info "Channels daemon terminated gracefully"
            rm -f "${CHANNELS_PID_FILE}"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    log_warn "Channels daemon did not stop gracefully, sending SIGKILL..."
    kill -9 "${pid}" 2>/dev/null || true
    rm -f "${CHANNELS_PID_FILE}"
    return 0
}

# Start the server
do_start() {
    log_info "Starting Vivian API Server..."

    clear_stale_pid_file

    # Check if already running
    if is_running; then
        log_warn "Server is already running (PID: $(get_pid))"
        return 1
    fi

    # Check if port is in use
    if is_port_in_use; then
        log_error "Port ${PORT} is already in use"
        describe_port_usage
        return 1
    fi

    # Create log directory if not exists
    mkdir -p "${LOG_DIR}"
    if [ -f "${SERVER_LOG}" ]; then
        SERVER_LOG_START_OFFSET=$(wc -c < "${SERVER_LOG}" 2>/dev/null || echo "0")
    else
        SERVER_LOG_START_OFFSET=0
    fi

    # Build uvicorn command
    local cmd="${PYTHON_BIN} -m uvicorn ${API_APP} --host ${HOST} --port ${PORT} --workers ${WORKERS} --no-access-log"

    # Auto-enable reload in debug mode unless explicitly disabled.
    local use_reload="false"
    if [ "${ENABLE_RELOAD}" = "true" ]; then
        use_reload="true"
    elif [ "${ENABLE_RELOAD}" = "auto" ] && { [ "${DEBUG}" = "True" ] || [ "${DEBUG}" = "true" ]; }; then
        use_reload="true"
    fi

    if [ "${use_reload}" = "true" ]; then
        cmd="${cmd} --reload"
        log_info "Debug mode enabled, auto-reload ON"
    fi

    # Reset Prometheus multiprocess dir so metrics start clean each boot.
    rm -rf "${PROMETHEUS_MULTIPROC_DIR}" && mkdir -p "${PROMETHEUS_MULTIPROC_DIR}"

    # Start server in background
    cd "${PROJECT_ROOT}"
    log_info "Starting with host=${HOST}, port=${PORT}, workers=${WORKERS}"
    # Capture bootstrap output before the application's logging configuration
    # is available (for example import errors and ASGI startup tracebacks).
    nohup ${cmd} >>"${SERVER_LOG}" 2>&1 &
    local pid=$!

    # Save PID
    echo "${pid}" > "${PID_FILE}"
    log_info "Server process started with PID: ${pid}"

    # Wait for startup
    if wait_for_startup; then
        log_info "Server started successfully on ${HOST}:${PORT}"
        log_info "Server log: ${SERVER_LOG}"
        log_info "App log: ${APP_LOG}"
        log_info "Access log: ${ACCESS_LOG}"

        # Start scheduler daemon
        if start_scheduler; then
            log_info "Scheduler log: ${SCHEDULER_LOG}"
        else
            log_warn "Scheduler daemon failed to start (server continues without scheduler)"
        fi

        # Start channels daemon
        if start_channels; then
            log_info "Channels log: ${CHANNELS_LOG}"
        else
            log_warn "Channels daemon failed to start (server continues without channels)"
        fi

        return 0
    else
        log_error "Server failed to start properly"
        do_stop
        return 1
    fi
}

# Stop the server
do_stop() {
    log_info "Stopping Vivian API Server..."

    # Stop channels daemon first
    stop_channels

    # Stop scheduler daemon
    stop_scheduler

    clear_stale_pid_file

    local pid=$(get_pid)

    if [ -z "${pid}" ]; then
        log_warn "No PID file found"
        # Try to find process by port
        if is_port_in_use; then
            log_info "Found process using port ${PORT}, attempting to stop..."
            describe_port_usage
            if command -v lsof &> /dev/null; then
                pid=$(lsof -t -i :"${PORT}" 2>/dev/null | head -1)
            fi
        fi
    fi

    if [ -z "${pid}" ]; then
        log_warn "Server is not running"
        rm -f "${PID_FILE}"
        return 0
    fi

    # Get all child processes
    local all_pids=$(get_process_tree "${pid}")
    log_info "Stopping processes: ${all_pids}"

    # Send SIGTERM to main process
    log_info "Sending SIGTERM to PID ${pid}..."
    kill -TERM "${pid}" 2>/dev/null || true

    # Wait for graceful shutdown (up to 10 seconds)
    local timeout=10
    local elapsed=0

    while [ ${elapsed} -lt ${timeout} ]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_info "Main process terminated gracefully"
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
        log_debug "Waiting for shutdown... (${elapsed}/${timeout}s)"
    done

    # Force kill if still running
    if kill -0 "${pid}" 2>/dev/null; then
        log_warn "Graceful shutdown timed out, sending SIGKILL..."
        for p in ${all_pids}; do
            kill -9 "${p}" 2>/dev/null || true
        done
        sleep 1
    fi

    # Verify all processes are terminated
    local remaining=""
    for p in ${all_pids}; do
        if kill -0 "${p}" 2>/dev/null; then
            remaining="${remaining} ${p}"
        fi
    done

    if [ -n "${remaining}" ]; then
        log_error "Failed to terminate processes:${remaining}"
        return 1
    fi

    # Clean up PID file
    rm -f "${PID_FILE}"

    # Verify port is released
    sleep 1
    if is_port_in_use; then
        log_warn "Port ${PORT} is still in use"
    else
        log_info "Port ${PORT} released"
    fi

    log_info "Server stopped successfully"
    return 0
}

# Restart the server
do_restart() {
    log_info "Restarting Vivian API Server..."
    do_stop
    sleep 2
    do_start
}

# Show server status
do_status() {
    echo ""
    echo "=========================================="
    echo "  Vivian API Server Status"
    echo "=========================================="
    echo ""

    # Server info
    echo -e "${BLUE}Server Configuration:${NC}"
    echo "  Host:        ${HOST}"
    echo "  Port:        ${PORT}"
    echo "  Debug:       ${DEBUG}"
    echo "  Config:      ${CONFIG_FILE}"
    echo "  Server Log:  ${SERVER_LOG}"
    echo "  App Log:     ${APP_LOG}"
    echo "  Access Log:  ${ACCESS_LOG}"
    echo ""

    # Process status
    local pid=$(get_pid)
    echo -e "${BLUE}Process Status:${NC}"

    if [ -z "${pid}" ]; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (no PID file)"
    elif ! kill -0 "${pid}" 2>/dev/null; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (stale PID file)"
        rm -f "${PID_FILE}"
    else
        echo -e "  Status: ${GREEN}RUNNING${NC}"
        echo "  Main PID: ${pid}"
        echo ""

        # Show process tree
        echo -e "${BLUE}Process Tree:${NC}"
        echo "  PID       PPID      CMD"
        echo "  ----      ----      ---"

        if command -v ps &> /dev/null; then
            local process_snapshot
            process_snapshot=$(get_process_snapshot)
            print_process_tree_from_snapshot "${pid}" "${process_snapshot}"
        fi
    fi

    echo ""

    # Port status
    echo -e "${BLUE}Port Status:${NC}"
    if is_port_in_use; then
        echo -e "  Port ${PORT}: ${GREEN}IN USE${NC}"
        describe_port_usage
    else
        echo -e "  Port ${PORT}: ${YELLOW}NOT IN USE${NC}"
    fi

    echo ""

    echo -e "${BLUE}API Route Check:${NC}"
    if verify_api_routes; then
        echo -e "  OpenAPI routes: ${GREEN}OK${NC}"
    elif is_port_in_use; then
        echo -e "  OpenAPI routes: ${RED}MISSING OR WRONG APP${NC}"
    else
        echo "  OpenAPI routes: (server not listening)"
    fi

    echo ""

    # Scheduler status
    echo -e "${BLUE}Scheduler Daemon:${NC}"
    local sched_pid=$(get_scheduler_pid)
    if [ -z "${sched_pid}" ]; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (no PID file)"
    elif ! kill -0 "${sched_pid}" 2>/dev/null; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (stale PID file)"
        rm -f "${SCHEDULER_PID_FILE}"
    else
        echo -e "  Status: ${GREEN}RUNNING${NC} (PID: ${sched_pid})"
    fi
    echo "  Scheduler Log: ${SCHEDULER_LOG}"
    echo ""

    # Channels daemon status
    echo -e "${BLUE}Channels Daemon:${NC}"
    local chan_pid=$(get_channels_pid)
    if [ -z "${chan_pid}" ]; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (no PID file)"
    elif ! kill -0 "${chan_pid}" 2>/dev/null; then
        echo -e "  Status: ${RED}NOT RUNNING${NC} (stale PID file)"
        rm -f "${CHANNELS_PID_FILE}"
    else
        echo -e "  Status: ${GREEN}RUNNING${NC} (PID: ${chan_pid})"
    fi
    echo "  Channels Log: ${CHANNELS_LOG}"
    echo ""

    # Recent log entries
    echo -e "${BLUE}Recent Server Log (last 5 lines):${NC}"
    if [ -f "${SERVER_LOG}" ]; then
        tail -5 "${SERVER_LOG}" 2>/dev/null | while read line; do
            echo "  ${line}"
        done
    else
        echo "  (no log file)"
    fi

    echo ""
    echo "=========================================="
}

# Show usage
show_usage() {
    echo "Usage: $0 {start|stop|restart|status}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the server, scheduler daemon, and channels daemon"
    echo "  stop    - Stop the server, scheduler daemon, and channels daemon (graceful, then force)"
    echo "  restart - Restart all services"
    echo "  status  - Show server, scheduler, and channels status"
    echo ""
    echo "Environment Variables:"
    echo "  WORKERS  - Number of worker processes (default: 1)"
    echo "  DEBUG    - Override debug mode from config"
    echo "  ENABLE_RELOAD - Control uvicorn reload: true, false, or auto (default)"
    echo "  VIVIAN_HOME   - Parent dir for state files. Resolved dir is \$VIVIAN_HOME/vivian/ (default: ~/.config)"
    echo "  PROMETHEUS_MULTIPROC_DIR - Prometheus multiprocess dir (auto: \$VIVIAN_HOME/vivian/.prometheus-multiproc, wiped each boot)"
    echo ""
    echo "Examples:"
    echo "  ./server.sh start"
    echo "  ./server.sh status"
    echo "  WORKERS=4 ./server.sh start"
    echo "  ENABLE_RELOAD=false ./server.sh start"
    echo ""
}

# Main
case "${1:-}" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
