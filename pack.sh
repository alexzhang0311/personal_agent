#!/bin/bash

# Pack vivian project for UAT deployment
# Usage: ./pack.sh [options]
#
# Options:
#   --skip-build            Skip frontend build
#   --include-dependency     Download and pack Python wheel packages into lib/
#   --platform PLATFORM     Target OS: linux (default) or macosx
#   --glibc VERSION         Target glibc version for linux (e.g. 2_17, 2_28, 2_31)
#                           Default: 2_17 (manylinux2014)
#   --python-version VER    Python version for wheel compatibility (e.g. 3.12, 3.13)
#                           Default: 3.12
#   --no-deps               Download wheels without dependencies (only packages listed in requirements.txt)
#
# Produces: vivian-<version>-<platform>.tar.gz
#   e.g. vivian-1.0.0-linux-glibc2_17.tar.gz
#        vivian-1.0.0-macosx-arm64.tar.gz
#
# Examples:
#   ./pack.sh                                          # build frontend + pack (no deps)
#   ./pack.sh --include-dependency                     # pack with all Python/NPM deps (linux, glibc 2.17)
#   ./pack.sh --include-dependency --glibc 2_28        # pack for glibc 2.28
#   ./pack.sh --include-dependency --platform macosx   # pack for macOS
#   ./pack.sh --skip-build --include-dependency        # skip frontend build, pack with deps
#   ./pack.sh --include-dependency --python-version 3.13  # use Python 3.13 wheels
#   ./pack.sh --include-dependency --no-deps           # only direct deps, no transitive
#
# Install (on target server):
#   tar xzf vivian-1.0.0-linux-glibc2_17.tar.gz
#   cd vivian-1.0.0-linux-glibc2_17
#
#   # If packed without --include-dependency (online install):
#   pip install -r requirements.txt
#   npm install -g pm2 docx pptxgenjs pdf-lib pdfjs-dist react react-dom react-icons sharp @anthropic-ai/claude-code
#
#   # If packed with --include-dependency (offline install):
#   pip install --no-index --find-links lib/py -r requirements.txt
#   npm install -g --offline --cache lib/npm-cache pm2 docx pptxgenjs pdf-lib pdfjs-dist react react-dom react-icons sharp @anthropic-ai/claude-code
#
#   bin/server.sh start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- NPM offline packages to include ---
NPM_PACKAGES=(
    pm2
    docx
    pptxgenjs
    pdf-lib
    pdfjs-dist
    react
    react-dom
    react-icons
    sharp
    @anthropic-ai/claude-code
)

# --- Parse arguments ---
SKIP_BUILD=false
INCLUDE_DEPENDENCY=false
PLATFORM=""
GLIBC_VERSION=""
PYTHON_VERSION="3.12"
NO_DEPS=false

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --include-dependency)
            INCLUDE_DEPENDENCY=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --glibc)
            GLIBC_VERSION="$2"
            shift 2
            ;;
        --python-version)
            PYTHON_VERSION="$2"
            shift 2
            ;;
        --no-deps)
            NO_DEPS=true
            shift
            ;;
        -h|--help)
            awk 'NR>=3 && /^set -e/{exit} NR>=3{sub(/^# ?/,""); print}' "$0"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            log_error "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Resolve full platform string
if [ -z "${PLATFORM}" ]; then
    PLATFORM="linux"
fi

case "${PLATFORM}" in
    linux)
        if [ -z "${GLIBC_VERSION}" ]; then
            GLIBC_VERSION="2_17"
        fi
        # Build array of platform tags (pip supports multiple --platform flags)
        # Include both PEP 600 (manylinux_X_Y) and legacy aliases so pip can
        # match wheels published under either naming convention.
        PLATFORM_TAGS=("manylinux_${GLIBC_VERSION}_x86_64")
        case "${GLIBC_VERSION}" in
            2_17) PLATFORM_TAGS+=("manylinux2014_x86_64") ;;
            2_12) PLATFORM_TAGS+=("manylinux2010_x86_64") ;;
            2_5)  PLATFORM_TAGS+=("manylinux1_x86_64") ;;
        esac
        PLATFORM_TAG="${PLATFORM_TAGS[0]}"
        PLATFORM_SUFFIX="linux-glibc${GLIBC_VERSION}"
        NPM_PLATFORM_ARGS=(--os=linux --cpu=x64 --libc=glibc)
        ;;
    macosx)
        PLATFORM_TAGS=("macosx_14_0_arm64")
        PLATFORM_TAG="macosx_14_0_arm64"
        PLATFORM_SUFFIX="macosx-arm64"
        NPM_PLATFORM_ARGS=(--os=darwin --cpu=arm64)
        if [ -n "${GLIBC_VERSION}" ]; then
            log_warn "--glibc is ignored for macosx platform"
        fi
        ;;
    *)
        log_error "Unknown platform: ${PLATFORM}. Must be 'linux' or 'macosx'"
        exit 1
        ;;
esac

# Read version from config.yaml
VERSION=$(python3 -c "
import yaml
with open('vivian/api/config.yaml') as f:
    cfg = yaml.safe_load(f) or {}
print(cfg.get('app_version', '1.0.0'))
" 2>/dev/null || echo "1.0.0")

BUILD_TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="vivian-${VERSION}-${PLATFORM_SUFFIX}-${BUILD_TS}"
DIST_DIR="${SCRIPT_DIR}/dist"

# Step 1: Build frontend
if [ "${SKIP_BUILD}" = "false" ]; then
    log_info "Building frontend..."
    if [ ! -d "vivian/web/node_modules" ]; then
        log_info "Installing frontend dependencies..."
        (cd vivian/web && npm install)
    fi
    (cd vivian/web && npm run build)
    log_info "Frontend build complete"
else
    log_warn "Skipping frontend build (--skip-build)"
fi

# Verify frontend dist exists
if [ ! -f "vivian/web/dist/index.html" ]; then
    log_error "Frontend dist not found. Run without --skip-build first."
    exit 1
fi

# Step 2: Prepare dist directory
log_info "Preparing distribution package..."
rm -rf "${DIST_DIR}/${ARCHIVE_NAME}"
mkdir -p "${DIST_DIR}/${ARCHIVE_NAME}"

# Copy project files
cp -r vivian/api    "${DIST_DIR}/${ARCHIVE_NAME}/api"
cp -r vivian/bin    "${DIST_DIR}/${ARCHIVE_NAME}/bin"
mkdir -p "${DIST_DIR}/${ARCHIVE_NAME}/web"
cp -r vivian/web/dist "${DIST_DIR}/${ARCHIVE_NAME}/web/dist"
cp    requirements.txt "${DIST_DIR}/${ARCHIVE_NAME}/requirements.txt"

# Vite's vite-plugin-static-copy already copies public/fonts into dist/fonts
# during `npm run build`. Only fall back to a manual copy when the build
# output is missing the fonts directory entirely (e.g. --skip-build over a
# stale dist). Use `cp -r src/. dst` so files merge into dst rather than
# nesting under dst/fonts/fonts (BSD cp behavior on macOS).
if [ -d "vivian/web/public/fonts" ] && [ ! -d "${DIST_DIR}/${ARCHIVE_NAME}/web/dist/fonts" ]; then
    mkdir -p "${DIST_DIR}/${ARCHIVE_NAME}/web/dist/fonts"
    cp -r vivian/web/public/fonts/. "${DIST_DIR}/${ARCHIVE_NAME}/web/dist/fonts/"
fi

# Step 3: Download dependencies
if [ "${INCLUDE_DEPENDENCY}" = "true" ]; then
    # --- Python wheels -> lib/py ---
    PY_LIB_DIR="${DIST_DIR}/${ARCHIVE_NAME}/lib/py"
    mkdir -p "${PY_LIB_DIR}"

    log_info "Downloading Python packages for platform: ${PLATFORM_TAGS[*]}, python: ${PYTHON_VERSION}"

    PIP_COMMON_ARGS=()
    if [ "${NO_DEPS}" = "true" ]; then
        PIP_COMMON_ARGS+=(--no-deps)
        log_info "Downloading without transitive dependencies (--no-deps)"
    fi

    # Build --platform flags (pip accepts multiple)
    PLATFORM_FLAGS=()
    for ptag in "${PLATFORM_TAGS[@]}"; do
        PLATFORM_FLAGS+=(--platform "${ptag}")
    done

    # Pass 1: try each package with platform-specific wheels
    # Pass 2: fallback without --platform for packages that failed (source-only like odfpy)
    PASS2_PKGS=()
    while IFS= read -r pkg; do
        [ -z "${pkg}" ] && continue
        [[ "${pkg}" =~ ^# ]] && continue
        if pip3 download "${pkg}" -d "${PY_LIB_DIR}" \
            "${PLATFORM_FLAGS[@]}" \
            --python-version "${PYTHON_VERSION}" \
            --only-binary=:all: \
            "${PIP_COMMON_ARGS[@]}" 2>&1; then
            :
        else
            PASS2_PKGS+=("${pkg}")
        fi
    done < requirements.txt

    if [ ${#PASS2_PKGS[@]} -gt 0 ]; then
        log_warn "Pass 2: retrying as pure-Python (noarch/sdist only): ${PASS2_PKGS[*]}"
        PASS3_PKGS=()
        for pkg in "${PASS2_PKGS[@]}"; do
            # Snapshot existing files so we can inspect what this package adds
            BEFORE_LIST=$(find "${PY_LIB_DIR}" -maxdepth 1 -type f | sort)
            # Drop --python-version and --platform here: pip rejects sdists
            # under those flags unless --only-binary=:all: is set, which would
            # block odfpy. Pure-Python packages don't need version pinning.
            if pip3 download "${pkg}" -d "${PY_LIB_DIR}" --no-deps 2>&1; then
                AFTER_LIST=$(find "${PY_LIB_DIR}" -maxdepth 1 -type f | sort)
                NEW_FILES=$(comm -13 <(echo "${BEFORE_LIST}") <(echo "${AFTER_LIST}"))
                # Reject any platform-specific wheel (macosx, win, manylinux not in our list, etc.)
                BAD_FILES=$(echo "${NEW_FILES}" | grep -E '\.whl$' | grep -Ev '\-py[0-9]+\-none\-any\.whl$|\-py2\.py3\-none\-any\.whl$' || true)
                if [ -n "${BAD_FILES}" ]; then
                    log_error "Pass 2 downloaded non-noarch wheels for ${pkg}:"
                    echo "${BAD_FILES}" | while read -r f; do log_error "  ${f}"; done
                    log_error "Removing them — package is not pure-Python"
                    echo "${BAD_FILES}" | xargs rm -f
                    PASS3_PKGS+=("${pkg}")
                fi
            else
                PASS3_PKGS+=("${pkg}")
            fi
        done

        if [ ${#PASS3_PKGS[@]} -gt 0 ]; then
            log_error "Failed to find ${PLATFORM_TAG} wheels (python ${PYTHON_VERSION}) for:"
            for pkg in "${PASS3_PKGS[@]}"; do
                log_error "  - ${pkg}"
            done
            log_error ""
            log_error "These packages have compiled extensions but no wheel matches:"
            log_error "  ${PLATFORM_TAGS[*]}"
            log_error ""
            log_error "Options:"
            log_error "  1. Raise glibc baseline: --glibc 2_28 (or 2_34)"
            log_error "  2. Pin an older version of the package in requirements.txt"
            log_error "  3. Add additional manylinux tags to PLATFORM_TAGS in pack.sh"
            exit 1
        fi
    else
        log_info "All packages downloaded in pass 1"
    fi

    WHL_COUNT=$(find "${PY_LIB_DIR}" -maxdepth 1 \( -name "*.whl" -o -name "*.tar.gz" -o -name "*.zip" \) | wc -l | tr -d ' ')
    log_info "Downloaded ${WHL_COUNT} Python packages into lib/py/"

    # --- NPM packages -> lib/npm (cache-based for full dependency tree) ---
    if [ ${#NPM_PACKAGES[@]} -gt 0 ]; then
        NPM_CACHE_DIR="${DIST_DIR}/${ARCHIVE_NAME}/lib/npm-cache"
        mkdir -p "${NPM_CACHE_DIR}"
        TEMP_NPM_PREFIX=$(mktemp -d)

        log_info "Downloading NPM packages (with all dependencies): ${NPM_PACKAGES[*]}"
        for pkg in "${NPM_PACKAGES[@]}"; do
            if npm install --prefix "${TEMP_NPM_PREFIX}" --cache "${NPM_CACHE_DIR}" "${NPM_PLATFORM_ARGS[@]}" "${pkg}" > /dev/null 2>&1; then
                log_info "  cached ${pkg} (with deps)"
            else
                log_error "  failed to cache ${pkg}"
            fi
        done
        rm -rf "${TEMP_NPM_PREFIX}"

        CACHE_SIZE=$(du -sh "${NPM_CACHE_DIR}" | cut -f1)
        log_info "NPM cache size: ${CACHE_SIZE} in lib/npm-cache/"
    fi
else
    log_info "Skipping dependency download (use --include-dependency to include wheels)"
fi

# Remove dev/temp files from the copy
find "${DIST_DIR}/${ARCHIVE_NAME}" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "${DIST_DIR}/${ARCHIVE_NAME}" -name "*.pyc" -delete 2>/dev/null || true
find "${DIST_DIR}/${ARCHIVE_NAME}" -name "*.pid" -delete 2>/dev/null || true
find "${DIST_DIR}/${ARCHIVE_NAME}" -name ".DS_Store" -delete 2>/dev/null || true
find "${DIST_DIR}/${ARCHIVE_NAME}" -name "._*" -delete 2>/dev/null || true
find "${DIST_DIR}/${ARCHIVE_NAME}" -name ".gitkeep" -delete 2>/dev/null || true
rm -rf "${DIST_DIR}/${ARCHIVE_NAME}/logs"

# Create empty logs dir
mkdir -p "${DIST_DIR}/${ARCHIVE_NAME}/logs"

chmod +x "${DIST_DIR}/${ARCHIVE_NAME}/bin/server.sh"

# Step 4: Generate README.md
log_info "Generating README.md..."
NPM_INSTALL_LIST="${NPM_PACKAGES[*]}"
if [ "${INCLUDE_DEPENDENCY}" = "true" ]; then
    _INSTALL_DEPS_SECTION="
### 3. 安装依赖（离线模式）

本安装包已包含所有依赖，无需联网。

**Python 依赖：**

\`\`\`bash
pip install --no-index --find-links lib/py -r requirements.txt
\`\`\`

**NPM 依赖：**

\`\`\`bash
npm install -g --offline --cache lib/npm-cache ${NPM_INSTALL_LIST}
\`\`\`
"
else
    _INSTALL_DEPS_SECTION="
### 3. 安装依赖（在线模式）

本安装包未包含依赖，需要联网安装。

**Python 依赖：**

\`\`\`bash
pip install -r requirements.txt
\`\`\`

**NPM 依赖：**

\`\`\`bash
npm install -g ${NPM_INSTALL_LIST}
\`\`\`
"
fi

cat > "${DIST_DIR}/${ARCHIVE_NAME}/README.md" << READMEEOF
# Vivian 部署指南

- **版本：** ${VERSION}
- **构建时间：** ${BUILD_TS}
- **目标平台：** ${PLATFORM_TAG}

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Python | >= 3.12 |
| Node.js | >= 18 |
| npm | >= 9 |
| 操作系统 | Linux x86_64 / macOS ARM64 |

---

## 部署步骤

### 1. 解压安装包

\`\`\`bash
tar xzf ${ARCHIVE_NAME}.tar.gz
cd ${ARCHIVE_NAME}
\`\`\`

### 2. 配置

编辑 \`api/config.yaml\`，根据实际环境修改以下配置：

\`\`\`yaml
server:
  host: "0.0.0.0"      # 监听地址
  port: 8081            # 监听端口
  debug: false          # 生产环境建议关闭
  work_dir: "~/vivian_workspace"  # 工作目录

auth:
  jwt_secret: "替换为安全密钥"   # 必须修改！
  jwt_expire_hours: 24
  default_password: "替换为安全密码"  # 首次登录密码
  enable_anonymous: false
\`\`\`
${_INSTALL_DEPS_SECTION}
### 4. 启动服务

\`\`\`bash
bin/server.sh start
\`\`\`

启动后会自动运行以下服务：
- **API 服务器** — 主服务（uvicorn）
- **调度器守护进程** — 定时任务
- **频道守护进程** — 消息通道

### 5. 验证服务状态

\`\`\`bash
bin/server.sh status
\`\`\`

浏览器访问 \`http://<服务器IP>:8081\` 确认前端页面正常加载。

---

## 常用运维命令

| 命令 | 说明 |
|------|------|
| \`bin/server.sh start\` | 启动所有服务 |
| \`bin/server.sh stop\` | 停止所有服务 |
| \`bin/server.sh restart\` | 重启所有服务 |
| \`bin/server.sh status\` | 查看服务状态 |

**环境变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| \`WORKERS\` | 1 | uvicorn 工作进程数 |
| \`DEBUG\` | config.yaml | 覆盖调试模式 |
| \`ENABLE_RELOAD\` | auto | 热重载：true / false / auto |

示例：

\`\`\`bash
WORKERS=4 bin/server.sh start
\`\`\`

---

## 目录结构

\`\`\`
${ARCHIVE_NAME}/
├── api/                  # 后端 Python 代码
├── bin/
│   └── server.sh         # 服务管理脚本
├── web/
│   └── dist/             # 前端构建产物
├── logs/                 # 日志目录（运行后生成）
├── requirements.txt      # Python 依赖清单
$([ "${INCLUDE_DEPENDENCY}" = "true" ] && echo "├── lib/
│   ├── py/               # Python 离线包
│   └── npm-cache/        # NPM 离线缓存")
└── README.md             # 本文档
\`\`\`

---

## 日志文件

| 日志 | 路径 | 说明 |
|------|------|------|
| 服务器日志 | \`logs/server.log\` | uvicorn 运行日志 |
| 应用日志 | \`logs/app.log\` | 业务逻辑日志 |
| 访问日志 | \`logs/access.log\` | HTTP 请求日志 |
| 调度器日志 | \`logs/scheduler.log\` | 定时任务日志 |

---

## 常见问题

**Q: 端口被占用？**

\`\`\`bash
# 查看占用端口的进程
lsof -i :8081
# 修改 api/config.yaml 中的 port 或 kill 占用进程
\`\`\`

**Q: 离线安装 npm 包失败（ENOTCACHED）？**

确保使用 \`--offline --cache lib/npm-cache\` 参数，并指定包名（而非 .tgz 文件）：

\`\`\`bash
npm install -g --offline --cache lib/npm-cache ${NPM_INSTALL_LIST}
\`\`\`

**Q: pip 安装报找不到包？**

确保使用 \`--no-index --find-links lib/py\` 参数：

\`\`\`bash
pip install --no-index --find-links lib/py -r requirements.txt
\`\`\`

**Q: 服务启动超时？**

查看日志排查：

\`\`\`bash
tail -50 logs/server.log
\`\`\`
READMEEOF

log_info "README.md generated"

# Step 5: Create tar.gz
log_info "Creating archive: ${ARCHIVE_NAME}.tar.gz"
cd "${DIST_DIR}"

# Strip macOS extended attributes so BSD tar does not embed AppleDouble (._*) entries
if command -v xattr >/dev/null 2>&1; then
    xattr -rc "${ARCHIVE_NAME}" 2>/dev/null || true
fi

# COPYFILE_DISABLE prevents macOS tar from writing ._* resource-fork files
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${ARCHIVE_NAME}.tar.gz" "${ARCHIVE_NAME}" 2>/dev/null \
    || COPYFILE_DISABLE=1 tar -czf "${ARCHIVE_NAME}.tar.gz" "${ARCHIVE_NAME}"

# Cleanup staging dir
rm -rf "${DIST_DIR}/${ARCHIVE_NAME}"

ARCHIVE_PATH="${DIST_DIR}/${ARCHIVE_NAME}.tar.gz"
SIZE=$(du -sh "${ARCHIVE_PATH}" | cut -f1)

echo ""
log_info "=========================================="
log_info "  Package created successfully!"
log_info "=========================================="
log_info "  File: ${ARCHIVE_PATH}"
log_info "  Size: ${SIZE}"
log_info "  Platform: ${PLATFORM_TAG}"
if [ "${INCLUDE_DEPENDENCY}" = "true" ]; then
    log_info "  Dependencies: included in lib/py/ and lib/npm-cache/"
else
    log_info "  Dependencies: not included"
fi
echo ""
log_info "  Deployment steps:"
log_info "    1. Copy ${ARCHIVE_NAME}.tar.gz to the UAT server"
log_info "    2. tar xzf ${ARCHIVE_NAME}.tar.gz"
log_info "    3. cd ${ARCHIVE_NAME}"
if [ "${INCLUDE_DEPENDENCY}" = "true" ]; then
    log_info "    4. pip install --no-index --find-links lib/py -r requirements.txt"
    log_info "    5. npm install -g --offline --cache lib/npm-cache ${NPM_INSTALL_LIST}"
else
    log_info "    4. pip install -r requirements.txt"
    log_info "    5. npm install -g ${NPM_INSTALL_LIST}"
fi
log_info "    6. bin/server.sh start"
echo ""
