# TCTP Vivian 部署说明

本文档说明 Vivian 项目的开发环境启动、打包方式、生产部署方式，以及生产环境已有虚拟环境时的增量更新流程。

> 开发、提交和发布前请先阅读
> [版本号与 Git 分支管理规范](docs/versioning-and-branching.md)。项目当前版本以根目录
> `VERSION` 为准，版本一致性可通过 `python3 scripts/check_version.py` 校验。

应用版本不再保存在 `vivian/api/config.yaml`。生产部署可以继续保留旧配置中的端口、密码和日志设置；旧配置即使仍有 `app_version` 也只会被兼容接收并忽略，后端接口与打包工具会从新发布包根目录的 `VERSION` 读取实际代码版本。

## 1. 项目结构

```text
vivian/
├── api/                  # FastAPI 后端
├── bin/
│   └── server.sh         # 服务管理脚本
└── web/                  # React + Vite 前端
    ├── src/              # 前端源码
    ├── package.json      # npm 脚本和依赖
    ├── vite.config.js    # Vite 开发代理配置
    └── dist/             # npm run build 后生成的生产静态文件

requirements.txt          # Python 依赖
VERSION                   # 应用版本唯一来源
CHANGELOG.md              # 发布变更记录
pack.sh                   # 打包脚本
```

生产模式下，前端不是单独启动 Vite 服务，而是由 FastAPI 挂载 `vivian/web/dist`：

```python
WEB_DIST = Path(__file__).parent.parent / "web" / "dist"

if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
```

因此生产访问入口通常是：

```text
http://<服务器IP>:8081
```

前端请求接口使用相对路径 `/api`，浏览器会自动请求同源后端：

```text
http://<服务器IP>:8081/api/...
```

## 2. 环境要求

| 项目 | 要求 |
| --- | --- |
| Python | >= 3.12 |
| Node.js | >= 18 |
| npm | >= 9 |
| 操作系统 | Linux x86_64 / macOS ARM64 |

生产离线部署时，构建机应尽量与生产机环境一致，尤其是：

```text
CPU 架构
Python 版本
glibc 版本
```

生产机查看 glibc：

```bash
ldd --version
```

常见版本：

```text
CentOS 7           glibc 2.17
RHEL/Rocky 8       glibc 2.28
Ubuntu 20.04       glibc 2.31
Ubuntu 22.04       glibc 2.35
```

## 3. 开发环境部署与启动

### 3.1 安装 Python 依赖

在项目根目录：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3.2 安装前端依赖

```bash
cd vivian/web
npm install
```

`npm install` 类似 Python 的 `pip install -r requirements.txt`，用于安装前端依赖到 `vivian/web/node_modules`。

### 3.3 启动后端开发服务

```bash
cd vivian
python -m uvicorn api.main:app --host 0.0.0.0 --port 8081 --reload
```

后端默认监听端口来自：

```text
vivian/api/config.yaml
```

```yaml
server:
  host: "0.0.0.0"
  port: 8081
  debug: true
```

### 3.4 启动前端开发服务

另开一个终端：

```bash
cd vivian/web
npm run dev
```

前端开发服务默认访问：

```text
http://localhost:5173
```

Vite 开发代理配置在：

```text
vivian/web/vite.config.js
```

```js
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:8081',
      changeOrigin: true,
    },
  },
}
```

开发模式下：

```text
浏览器访问: http://localhost:5173
前端请求:   /api/...
实际代理到: http://localhost:8081/api/...
```

## 4. 前端 build 说明

前端源码不能直接作为生产页面部署，需要先构建：

```bash
cd vivian/web
npm run build
```

构建前是源码：

```text
vivian/web/src/
vivian/web/package.json
vivian/web/vite.config.js
```

构建后生成生产静态文件：

```text
vivian/web/dist/
├── index.html
├── assets/
├── fonts/
└── file-icons/
```

`dist` 目录是生产产物，可以被 FastAPI、nginx 或其他静态文件服务直接托管。

注意：

```text
npm run dev      启动 Vite 开发服务器，面向 src 源码
npm run build    生成 dist 生产静态文件
npm run preview  预览 dist
```

生产环境只运行 `web/dist` 时，不需要再执行 `npm install`、`npm run dev` 或 `npm run build`。

## 5. 打包方式

打包脚本：

```bash
./pack.sh [options]
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--skip-build` | 跳过前端 build，要求已有 `vivian/web/dist/index.html` |
| `--include-dependency` | 下载并打包 Python / npm 离线依赖 |
| `--platform linux` | 目标平台为 Linux |
| `--platform macosx` | 目标平台为 macOS ARM64 |
| `--glibc 2_17` | 指定 Linux glibc 版本，默认 `2_17` |
| `--python-version 3.12` | 指定 Python wheel 兼容版本，默认 `3.12` |
| `--no-deps` | 只下载 requirements.txt 直接依赖，不下载传递依赖 |

### 5.1 在线环境普通打包

```bash
./pack.sh
```

会执行：

```text
1. 如无 vivian/web/node_modules，则执行 npm install
2. 执行 npm run build
3. 复制 api、bin、web/dist、requirements.txt
4. 生成 README.md
5. 生成 dist/vivian-<version>-<platform>-<timestamp>.tar.gz
```

该包不包含 Python / npm 离线依赖，目标服务器需要联网安装依赖。

### 5.2 离线生产包

生产环境不能联网时，推荐：

```bash
./pack.sh --include-dependency --platform linux --glibc 2_17 --python-version 3.12
```

如果生产机 glibc 是 2.28：

```bash
./pack.sh --include-dependency --platform linux --glibc 2_28 --python-version 3.12
```

离线包会额外包含：

```text
lib/
├── py/                  # Python wheels / tar.gz / zip
└── npm-cache/           # npm 离线缓存
```

Python 依赖以 `.whl`、`.tar.gz`、`.zip` 形式下载到 `lib/py`。安装时 `pip` 使用本地目录作为离线安装源。

npm 依赖以 npm cache 形式存放到 `lib/npm-cache`。安装时 `npm` 使用该缓存离线恢复全局包。

`pack.sh` 中缓存的 npm 全局包包括：

```text
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
```

这些不是前端 build 的必要条件。前端页面本身只需要 `web/dist`。这些 npm 包主要用于运行期工具链、全局 `claude` 命令或备用场景。

## 6. 生产部署

### 6.1 解压部署包

```bash
cd /opt
tar xzf vivian-xxx-linux-glibc2_17-xxx.tar.gz
cd vivian-xxx-linux-glibc2_17-xxx
```

### 6.2 创建或使用 Python 虚拟环境

新环境：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
```

如果生产环境已有虚拟环境，直接激活已有环境即可。

### 6.3 安装 Python 依赖

在线安装：

```bash
pip install -r requirements.txt
```

离线安装：

```bash
pip install --no-index --find-links lib/py -r requirements.txt
```

参数说明：

```text
--no-index
  禁止访问 PyPI

--find-links lib/py
  只从本地 lib/py 查找依赖安装包
```

### 6.4 可选：安装 npm 运行期工具

如果生产环境需要全局 npm 工具，在线安装：

```bash
npm install -g pm2 docx pptxgenjs pdf-lib pdfjs-dist react react-dom react-icons sharp @anthropic-ai/claude-code
```

离线安装：

```bash
npm install -g --offline --cache lib/npm-cache pm2 docx pptxgenjs pdf-lib pdfjs-dist react react-dom react-icons sharp @anthropic-ai/claude-code
```

如果只运行 FastAPI 挂载的前端页面，前端本身不需要在生产机安装 npm 包。

### 6.5 修改生产配置

编辑：

```bash
vi api/config.yaml
```

生产建议：

```yaml
server:
  host: "0.0.0.0"
  port: 8081
  debug: false
  work_dir: "~/vivian_workspace"

auth:
  jwt_secret: "替换为强随机密钥"
  jwt_expire_hours: 24
  default_password: "替换为安全初始密码"
  enable_anonymous: false
```

必须修改：

```text
server.debug: false
auth.jwt_secret
auth.default_password
```

### 6.6 启动服务

推荐显式指定虚拟环境 Python：

```bash
PYTHON_BIN="$PWD/.venv/bin/python" ENABLE_RELOAD=false WORKERS=1 bin/server.sh start
```

`server.sh` 会读取：

```text
api/config.yaml
```

并用以下形式启动后端：

```bash
python -m uvicorn api.main:app --host <host> --port <port> --workers <workers> --no-access-log
```

同时启动：

```text
API 服务器
调度器守护进程
频道守护进程
```

### 6.7 验证

```bash
bin/server.sh status
curl http://127.0.0.1:8081/health
```

浏览器访问：

```text
http://<服务器IP>:8081
```

查看日志：

```bash
tail -100 logs/server.log
tail -100 logs/app.log
tail -100 logs/access.log
```

如果不用 nginx，需要确保防火墙或安全组开放服务端口，例如 `8081/tcp`。

## 7. 增量更新部署

如果生产环境已经有可用 Python 虚拟环境，每次功能更新不一定要重建 venv。

判断规则：

```text
只改 api / web / bundled skills    覆盖代码和 web/dist，重启
requirements.txt 有变化            用新包 lib/py 离线升级已有 venv
npm 运行期依赖有变化               用新包 lib/npm-cache 离线安装 npm 全局包
生产配置有变化                     手工合并 api/config.yaml
```

### 7.1 构建新包

联网构建机：

```bash
./pack.sh --include-dependency --platform linux --glibc 2_17 --python-version 3.12
```

如果确认依赖没有变化，也可以：

```bash
./pack.sh --platform linux --glibc 2_17 --python-version 3.12
```

### 7.2 生产机解压到新目录

不要直接覆盖线上目录：

```bash
cd /opt
tar xzf vivian-new.tar.gz
```

假设：

```text
当前线上目录: /opt/vivian-prod
新版本目录:   /opt/vivian-new
```

### 7.3 比较依赖

```bash
diff -u /opt/vivian-prod/requirements.txt /opt/vivian-new/requirements.txt
```

如果 `requirements.txt` 有变化：

```bash
source /opt/vivian-prod/.venv/bin/activate
pip install --no-index --find-links /opt/vivian-new/lib/py -r /opt/vivian-new/requirements.txt
```

### 7.4 停止服务并备份

```bash
cd /opt/vivian-prod
bin/server.sh stop
```

建议至少备份代码目录：

```bash
cp -a api api.bak-$(date +%Y%m%d_%H%M%S)
cp -a bin bin.bak-$(date +%Y%m%d_%H%M%S)
cp -a web web.bak-$(date +%Y%m%d_%H%M%S)
cp -a requirements.txt requirements.txt.bak-$(date +%Y%m%d_%H%M%S)
if [ -f VERSION ]; then
  cp -a VERSION VERSION.bak-$(date +%Y%m%d_%H%M%S)
fi
```

### 7.5 覆盖代码并保留生产配置

```bash
cp api/config.yaml /tmp/vivian-config.yaml

cp -a /opt/vivian-new/api /opt/vivian-prod/
cp -a /opt/vivian-new/bin /opt/vivian-prod/
cp -a /opt/vivian-new/web /opt/vivian-prod/
cp -a /opt/vivian-new/requirements.txt /opt/vivian-prod/
cp -a /opt/vivian-new/VERSION /opt/vivian-prod/
cp -a /opt/vivian-new/CHANGELOG.md /opt/vivian-prod/

cp /tmp/vivian-config.yaml /opt/vivian-prod/api/config.yaml
```

不要覆盖或删除：

```text
.venv/
logs/
用户 work_dir
$VIVIAN_HOME/vivian/
```

### 7.6 重启并验证

```bash
cd /opt/vivian-prod
PYTHON_BIN="$PWD/.venv/bin/python" ENABLE_RELOAD=false WORKERS=1 bin/server.sh start
bin/server.sh status
curl http://127.0.0.1:8081/health
```

如果是 Skill Hub 或内置 skills 更新，需要确认新包里的：

```text
api/bundled/skills/
```

已经覆盖到生产环境。服务启动时会执行内置 skills seed 逻辑，将 bundled skills 同步到运行时资源目录。

## 8. 常用命令

```bash
bin/server.sh start
bin/server.sh stop
bin/server.sh restart
bin/server.sh status
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PYTHON_BIN` | 自动探测 | 指定 Python 解释器 |
| `WORKERS` | `1` | uvicorn worker 数 |
| `DEBUG` | `api/config.yaml` | 覆盖 debug 配置 |
| `ENABLE_RELOAD` | `auto` | 是否启用 uvicorn reload，生产建议 `false` |
| `VIVIAN_HOME` | `$HOME/.config` | Vivian 运行时状态目录 |

生产启动示例：

```bash
PYTHON_BIN="$PWD/.venv/bin/python" ENABLE_RELOAD=false WORKERS=1 bin/server.sh start
```

## 9. 推荐生产目录结构

更稳妥的生产部署可以使用 releases/current/shared 结构：

```text
/opt/vivian/
├── releases/
│   ├── vivian-20260710/
│   │   └── VERSION
│   └── vivian-20260717/
│       └── VERSION
├── current -> /opt/vivian/releases/vivian-20260717
└── shared/
    ├── .venv/
    ├── config.yaml
    ├── logs/
    └── workspace/
```

每次部署：

```text
1. 解压新包到 releases/新版本
2. 复用 shared/.venv
3. 复制 shared/config.yaml 到新版本 api/config.yaml
4. current 软链切到新版本
5. 重启服务
```

这种方式比直接覆盖 `/opt/vivian-prod` 更容易回滚。
