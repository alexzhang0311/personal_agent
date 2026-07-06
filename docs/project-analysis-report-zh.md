# Vivian（TCTP-vivian）— 项目深度分析报告（中文版）

> 分析日期：2026-06-11 · 代码库：`vivian-agent-sdk-v2`（claude-agent-sdk 0.1.81，FastAPI 后端 + React 18 WebUI）
> 分析范围：完整阅读 `vivian/api`（约 80 个 Python 模块）、`vivian/web`（约 140 个 JSX 模块）、`docs/`、`tests/`、部署脚本，并结合公开资料调研 OpenClaw 与 Hermes。
> 英文版：`docs/project-analysis-report.md`

---

## 1. 项目定位（Project Purpose）

**Vivian 是一个自托管、多用户的 Claude Code 企业级控制平面（control plane）。** 它用 FastAPI 把 Claude Agent SDK（SDK 本身以子进程方式驱动 Claude Code CLI）包装成服务，把 Claude Code 的全部能力——工具、Skills、Hooks、MCP、子代理（subagents）、会话——通过三个 Claude Code 自身不具备的"门面"暴露出来：

1. **Web UI**（React 18 + Vite + Zustand，GitHub-Dark"工业极简"设计体系）——支持 SSE/WebSocket 实时流式对话；任务进度 Canvas 面板（任务树、子代理检视器、Todo 检视器、计划评审、文件操作、浏览器调试）；会话管理（续聊 / fork / 回滚到检查点 / 重命名 / 打标签）；以及 Skills、MCP 服务器、Hooks、子代理、调度器的全套自助管理面板。
2. **IM 渠道**——通过独立的 channels 守护进程（`aibot` WebSocket SDK）深度接入企业微信（WeCom），并精心设计了一套**纯文本同步反馈协议**：IM 用户可以在 Agent 运行中途回答 `AskUserQuestion` 提问、确认高危操作（协议规范见 `docs/im-channel-permission-zh.md`）；另有 **OpenClaw 桥接**（逆向还原的 Ed25519 v3 网关协议），让 Vivian 的 Agent 可以把任务委派给 OpenClaw 管理的专家 Agent。
3. **自治调度器**——独立的 APScheduler 守护进程，运行 cron / 间隔 / 一次性任务（Agent 运行、HTTP 调用、用户脚本、工具重试），带运行历史；并通过进程内 MCP 服务器（`vivian_scheduler`）让 **Agent 在对话中给自己排任务**。

围绕这个核心，Vivian 补齐了企业放手让自治 Agent 替员工干活之前必须具备的一切：JWT/API-key 多用户认证 + 管理员角色、按用户隔离的 LLM 网关凭证（每个用户独立的 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`）、带图表的审计日志、管理员可配置的**高危工具确认清单**（即使在 `bypassPermissions` 模式下也强制人工确认）、流式输出的 PII 脱敏、危险 bash 拦截 Hook、Prometheus 指标，以及完整的**离线/内网隔离部署流水线**（`pack.sh` 打包 glibc 2.17 的 Python wheel + npm 离线缓存 + 本地字体）。

一句话概括：**"Claude Code 是发动机，Vivian 是企业级底盘"**——为那些既不能用 claude.ai、也无法直接使用原生 Claude Code 的环境（尤其是中国企业内网）提供身份、治理、渠道、调度、可观测性与部署能力。

---

## 2. 核心架构 —— 设计细节与设计意图

### 2.1 进程拓扑：三个协作的守护进程

```
                       ┌────────────────────────────────────────────┐
                       │  bin/server.sh（start/stop/status，PID 管理）│
                       └────────────────────────────────────────────┘
                                │                │               │
        ┌───────────────────────┴──┐   ┌─────────┴────────┐   ┌──┴──────────────────┐
        │ API Server (uvicorn)     │   │ Scheduler 守护进程 │   │ Channels 守护进程    │
        │ FastAPI：17 个 router    │   │ APScheduler       │   │ 企业微信 WS (aibot)  │
        │ SSE / WS 流式输出        │   │ cron/间隔/        │   │ OpenClaw 桥接        │
        │ Web 静态资源 (web/dist)  │   │ 定时触发器         │   │ 消息队列/会话映射     │
        └───────────┬──────────────┘   └─────────┬────────┘   └──┬──────────────────┘
                    │      基于文件的 IPC：commands 目录、heartbeat 心跳文件、
                    │      JSONL 任务存储 / 运行历史 / 会话 / 审计
                    ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ services/claude_sdk —— 引擎舱                                    │
        │  options.py   → 按用户组装 ClaudeAgentOptions                    │
        │  service.py   → agent_run / agent_run_events / agent_run_stream │
        │  permission_coordinator.py → 人机协同（human-in-the-loop）future │
        │  retry.py + session_heal.py → 合成错误重试与会话修复              │
        │      │ 拉起子进程                                                │
        │      ▼                                                          │
        │  Claude Code CLI 子进程（每次运行一个）→ 企业内部 LLM 网关        │
        └─────────────────────────────────────────────────────────────────┘
```

**设计意图：** channels 守护进程持有长连 WebSocket，调度器持有定时器——两者都必须在 API 重启/重新发布时存活，所以拆成独立 OS 进程，由 `server.sh` 通过心跳文件监管。三个进程通过 `$VIVIAN_HOME/vivian`（JSONL/YAML 文件）共享状态，使部署零外部依赖：没有数据库、没有 Redis、没有消息队列——这是对离线内网服务器的刻意取舍。

### 2.2 引擎舱：`services/claude_sdk`

- **`options.py` —— 按用户组装运行参数。** 每次运行都重新构建 `ClaudeAgentOptions`：用户自己的网关凭证（按用户的 env 文件）、按用户隔离的工作目录 `cwd`、模型覆盖（含**粘性视觉模型路由**——带图片的消息切换到配置的多模态模型，且整个会话保持锁定）、按用户的 **Skill 白名单**（`options.skills`）、管理员运行时配置（CLI 路径覆盖——对无 shebang 的 node 脚本用 Linux `memfd_create` 生成内存内包装器、追加系统提示词、插件），以及每次运行注入的三个**进程内 MCP 服务器**：`vivian_scheduler`（自我调度）、`vivian_File`（FileCanvas 注册，让 Agent 产出的文件出现在 WebUI Canvas）、`vivian_openclaw`（任务委派）。`BUILTIN_DISALLOWED_TOOLS` 移除了 `WebFetch`/`WebSearch`/`Cron*`/worktree 等工具——与"无公网、只走企业网关"的环境一致。
- **`service.py` —— 一个核心，三种运行模式。** `agent_run`（同步 REST）、`agent_run_events`（回调驱动的核心，被 WS、channels 守护进程、调度器共用）、`agent_run_stream`（SSE 生成器）。核心把 SDK 消息泵入队列，每 2 秒发 keepalive，从 `system.init` 捕获 CLI 分配的会话 id（对重试至关重要），审计每次工具调用，并支持**回合中途注入用户消息**：排队的消息在干净的 tool-result 边界经 `client.interrupt()` 刷入——这是原生 Claude Code 只有在其自身 TUI 里才有的对话原生能力。
- **`permission_coordinator.py` —— 人机协同内核。** `can_use_tool` 回调被转换成携带 `request_id`/`kind`/`risky`/`matched_rule` 的 `permission_request` 事件；一个 `asyncio.Future` 把 Agent 挂起，直到 `/api/agent/permission/respond` 解决它（带所有者鉴权），或超时（默认 600 秒）按拒绝处理。注册表在 CLI 把临时 uuid 换成真实会话 id 时做重映射。统一回调的路由规则：`AskUserQuestion` → 永远阻塞等回答；显式权限模式 → 所有工具都阻塞；`bypassPermissions` + 管理员高危清单 → 只有命中的工具阻塞；其余自动放行（仍需回调存在，因为 CLI 内部保护 `.claude/{skills,commands,agents}/**`）。
- **`retry.py` + `session_heal.py` —— 可靠性"外科手术"。** CLI 自身重试耗尽后有时会以*合成错误消息*结束回合；Vivian 检测这类消息，**把 `options.resume` 旋转到 CLI 当前真实会话 id**，修复会话 JSONL 里的孤儿 `tool_use` 记录，剥离合成错误行（模型永远看不到），再退避重试——保留失败尝试中已完成的全部工作。channels 守护进程再加一层保护：陈旧 resume id 失败 → 清空后重新全新运行。这一层是整个代码库生产化打磨最深的部分。

### 2.3 IM 反馈协议（本项目最具原创性的设计）

IM 输入框只有纯文本——没有按钮、没有表单。Vivian 的协议（在 `docs/im-channel-permission-zh.md` 中为任何渠道实现者写成了规范）让同步的 Agent↔人对话照样成立：

- 选项**编号化**；用户回 `2`、回选项原文、回自由文本、或回「跳过」都可以。
- 多问题提示**一题一条消息**逐题发送，答案在渠道侧缓存，最后**一次性**提交 `respond`。
- 答案按锁定的行格式（`- <header> -> <label>`）序列化，由 `service._askuser_answers_map()` 重新解析成 CLI 的 `AskUserQuestion` 真正期望的 `{question_text: answer}` 映射——修复了一个真实的 CLI 坑：自由文本 `answer` 字段会被静默丢弃，导致模型瞎编选择。
- `enable_permission_feedback=false` 是**优雅降级路径**：服务端直接从工具集移除 `AskUserQuestion`，受控工具默认拒绝，没实现协议的渠道永远不会把连接挂死。
- 企业微信守护进程把 coordinator 超时提高到 86,400 秒、自己跑每题计时器，把提问者的下一条消息截获为答案（忽略非提问者），提供 `/reset` 万能逃生口，并在发生人工交互后改用主动推送（原回复流已失效）。

这是一套完整、想透了的交互设计——超时语义、会话重映射后的 404 重试、多选逗号规则、是/否识别失败时偏保守等边界情况的清单，只有真正跑过生产才写得出来。

### 2.4 治理与扩展面

- **Hooks：** 装饰器注册的内置 Hook（`block-dangerous-bash`、`audit-tool-use`、`lint-on-write`、`notify-slack`、`retry-failed-tools`、`require-permission-risky-tools`）+ 管理员自定义 Hook，WebUI 提供配置、测试、日志。
- **Skills：** global/project 两级，中心化 **Skill Hub** 走上传→审核→分发流程，启动时重新播种内置 Skills（Anthropic 官方 office 套件 docx/xlsx/pptx/pdf，加自研的 `itsm-workflow-query`、`ops-knowledge`、`prod-agent-gateway`、`rota-schedule`、`mermaid-visualizer`、带评测框架的 `skill-creator` 等）。
- **MCP：** 按用户/层级的增删改查 + 校验 + 能力探测；用 `--strict-mcp-config` 纪律保证管理员意图永远压过 `.mcp.json` 自动发现。
- **插件：** 服务端插件管理器（如 `enterprise_user_info` 按运行注入员工上下文到系统提示词）。
- **可观测性：** Prometheus 多进程指标（有一篇 ADR 论证基数控制取舍）；loguru 按关注点分流的滚动压缩日志（access/server/app/scheduler/channels）；审计 JSONL + 管理员分析图表；scalar API 文档。

---

## 3. Why & How —— 设计背后的推理链

| 约束（Why） | 设计应对（How） |
|---|---|
| 员工无法直连 Anthropic；LLM 流量必须走内部网关、按用户发 token | 按用户的 env 文件（`ANTHROPIC_BASE_URL`/`AUTH_TOKEN`），每次运行前校验；模型列表来自配置；针对 IP 白名单网关的 `NO_PROXY` 处理 |
| 服务器内网隔离 / 出网严格受限 | `pack.sh` 离线 tarball（manylinux wheels、npm 离线缓存、本地字体）；禁用 `WebFetch`/`WebSearch`；给 WeCom SDK 打 CONNECT 正向代理补丁 |
| 非开发人员也要能用 Agent | WebUI 对话 + Canvas；企业微信渠道——Agent 就活在员工已经在用的聊天软件里 |
| 合规：谁、用什么工具、花了多少钱 | 每次工具调用/Skill 调用/运行完成（token 用量）写审计 JSONL，管理员图表，访问日志，Prometheus 计数器 |
| 自治 Agent 默认就是危险的 | 分层防护：危险 bash 正则 Hook（直接拒绝）、管理员高危清单 → 即使 bypass 模式也同步人工确认、流式输出 PII 脱敏、权限超时默认拒绝、全量审计 |
| CLI/网关组合的失败方式很难看（合成错误、丢 tool_use、会话 id 切换） | §2.2 的重试/修复/剥离/resume 旋转层——故障恢复且*保留已完成的工作* |
| 一个团队的 Agent 平台应当能与其他生态组合 | OpenClaw 桥接：Vivian 的 Agent 可以通过持久的 Ed25519 认证 WebSocket `delegate_to_openclaw(...)` 委派给专家 Agent |
| 运维自动化必须 7×24 无人值守 | 调度器守护进程 + 面向 Agent 的调度 MCP 工具（工具描述里做了提示词工程护栏，区分"排一个定时任务"和"现在就委派子代理"） |

贯穿始终的元决策：**绝不重新实现 Claude Code 已有的东西**（Agent 循环、工具、会话 JSONL、Skills、Hooks、MCP、检查点）——而是包装它、治理它、传输它。CLI 有缺口的地方（AskUserQuestion 答案 schema、合成错误、会话 id 切换），在边界上打补丁而不是 fork。

---

## 4. 取舍与收益（Trade-offs & Benefits）

### 4.1 基于 Claude Agent SDK / CLI 子进程构建

- ✅ **收益：** 免费获得 Claude Code 全部保真度——每次 CLI 升级都带来新工具、会话格式、文件检查点/回滚、Skills/插件生态兼容。约 2,500 行引擎舱代码换来巨大的能力面。
- ⚠️ **代价：** 每次运行一个进程的开销；版本耦合（SDK 锁定 0.1.81；CLI 路径覆盖 + `server.sh` 里的 statsig 开关覆盖暴露了对 CLI 内部的敏感性）；heal/strip 逻辑**直接给 CLI 的私有 JSONL 会话格式动手术**——一个不稳定的契约；`await asyncio.sleep(1)` 的刷盘宽限期是基于时间的 hack。

### 4.2 文件态存储，不用数据库

- ✅ 零外部依赖 → 离线打包极简；状态可 grep、可调试；`VIVIAN_HOME` 隔离支持单机多实例。
- ⚠️ 单机天花板：无 HA、无水平扩展；SSE/WS 流和权限注册表都在进程内（开第二个 uvicorn worker 会打断 permission respond 的路由）；并发安全依赖默认单 worker。

### 4.3 三守护进程 + 文件 IPC

- ✅ 渠道 WS 长连和 cron 定时器不受 API 重启影响；故障隔离；可独立重启。
- ⚠️ 运维复杂度（3 个 PID、心跳、带崩溃恢复的命令文件队列）；配置变更是最终一致而非事务性传播；给 `aibot` SDK 打猴子补丁（ws:// 的 SSL、CONNECT 代理）在 SDK 升级面前脆弱。

### 4.4 默认 `bypassPermissions` + 高危清单叠加

- ✅ 低摩擦体验（Agent 不会为每个 `ls` 烦人），同时管理员中心化决定什么*永远*需要人确认（如 `Bash(rm:*)`），并在 WebUI、WS、IM 三端行为一致。
- ⚠️ 安全质量完全取决于管理员清单的质量；危险 bash 正则 Hook 是兜底而非沙箱——工具执行**没有 OS 级隔离**（容器/seccomp）；巧妙的提示词注入仍可能在被允许的工具集内作恶。

### 4.5 逆向还原的 OpenClaw 协议

- ✅ 今天就能用的真实互操作：Vivian 的 Agent 可以委派给另一个完整的 Agent 生态。
- ⚠️ 协议来自对安装包 `dist/*.js` 的反汇编——上游协议一升级就会静默断掉；且是单向桥（Vivian → OpenClaw），不是渠道复用。

### 4.6 安全姿态的诚实账

- ✅ 真实机制：bcrypt 密码、JWT + 按用户 API key、permission respond 的所有者校验、密钥加密工具、0600 权限的设备密钥、管理员才可用的 PTY 终端、`/metrics` 无鉴权有 ADR 文档化论证（ADR-0002）。
- ⚠️ 代码里带出厂的危险默认值：`jwt_secret: "sk-vivian"`、`default_password: "vivian"`、CORS `allow_origins=["*"]` 且带凭证、Web 终端=宿主机远程 shell（虽管理员限定，但仍是）。在可信内网没问题；放到任何别的地方都危险。

---

## 5. 多维度评分

| 维度 | 评分 | 理由 |
|---|---:|---|
| 架构与关注点分离 | **8.5/10** | 分层干净（routers→services→SDK），三进程拓扑契合约束，进程内 MCP 注入优雅，是一个工程化程度很高的项目。扣分项：文件 IPC 散落，单例模式拖累可测性。 |
| 可靠性工程 | **9/10** | 重试/修复/resume 旋转层、IM 优雅降级、队列满背压、崩溃恢复的命令处理——对这个项目的年龄来说异常成熟。 |
| 安全与治理设计 | **7.5/10** | 分层控制（Hooks、高危清单、审计、脱敏、所有者校验）确实出色；不安全的默认值（JWT 密钥、CORS `*`、默认密码）和缺乏执行沙箱拉低了分数。 |
| 可扩展性（Scalability） | **5.5/10** | 刻意单机，零外部依赖很大程度上可能是为了快速交付而做出的妥协；进程内权限注册表和文件态使水平扩展必须重构。对小规模团队部署够用，对大规模推广增长是天花板。 |
| 代码质量与可维护性 | **8/10** | 风格一致，注释讲*为什么*（AskUserQuestion answers-map 的 docstring 堪称范本），到处都是带类型的 Pydantic 模型。部分函数过长（`agent_run_events`、channels 守护进程的 handler）。 |
| 测试 | **5.5/10** | 20 个聚焦的后端测试模块覆盖了最棘手的部分（重试/续聊、权限协调器、答案映射、高危匹配、PII Hook）——选点精准但整体偏薄，关键路径(stream / retry / interrupt)无集成测试；前端无测试；没有对真实 CLI 的集成测试。 |
| 文档 | **7.5/10** | IM 协议指南极佳（生产级规范）；两篇有思考的 ADR；CLAUDE.md/design-spec 锁定了设计体系。缺：给新人的顶层 README/架构总览。 |
| 前端 / UX | **8.5/10** | 纪律性的设计体系（锁定配色、骨架屏、状态左边框、拒绝 AI 味儿），深度的 Agent 原生 UI（Canvas、计划评审、检查点、排队消息、权限卡片），`CLAUDE.md` 的前端设计规范极详细，带来了堪比原生Agent App 的体验。 |
| 可部署性（企业/离线） | **9/10** | 带 glibc 目标的 `pack.sh`、离线 wheel/npm 打包、`VIVIAN_HOME`、日志滚动、健康检查端点——离线故事好于任何开源竞品。 |
| 可观测性 | **8/10** | Prometheus 带成文的基数论证、按子系统分流的结构化滚动日志、审计分析。缺分布式追踪（OTel 是依赖但没用来打 span）。 |
| 生态与可扩展性（Extensibility） | **8/10** | Skills + Hub、Hooks 注册表、MCP 管理器、插件、子代理、OpenClaw 委派。网络效应仅限内部（没有社区市场）。 |
| **总体** | **8.0/10** | 一个生产化打磨过、边界划得很准的企业 Agent 平台；它的天花板（扩展性、安全默认值、渠道广度）是有意识的取舍而非疏忽。从前端的设计规范和后台设计的思考来看，两者磨合得非常好，是一个工程素养很高的团队结合 AI 编码工具精心设计的项目，而非随意 "vibe coding" 的产物 |

---

## 6. 竞品与格局分析（vs OpenClaw / Hermes）

### 6.1 格局

到 2026 年中，"自托管个人/团队 Agent 宿主"这个品类有三个参照系，而 Vivian 占据了它们都不在的第四个位置：

| | **Vivian（本项目）** | **OpenClaw** | **Hermes Agent（Nous Research）** | **Claude Code（原生）** |
|---|---|---|---|---|
| 定位 | **企业多用户控制平面**（Claude Code 之上） | 个人 AI 助理网关（"你的助理出现在每个聊天软件里"） | 带记忆与自我进化 Skills 的开源自治 Agent 平台 | 单用户 Agent 编程 CLI |
| 运行时 | Python（FastAPI）+ Claude Code CLI 子进程 | Node/TypeScript Gateway，hub-and-spoke 控制面 | Python | Node CLI |
| 引擎 | Claude Agent SDK → Claude Code CLI（全保真） | 自研 Agent 运行时，多模型 | 自研循环，Hermes/其他模型 | Claude Code 本体 |
| 多用户 / 租户 | ✅ JWT + 管理员 + 按用户凭证、工作区，预留配额 | ❌ 实质单 owner（联系人配对/白名单） | ❌ 单操作者 | ❌ 单用户 |
| 渠道 | 企业微信（深度，含同步反馈协议）；OpenClaw 桥（委派）；为飞书/钉钉/Telegram 接入写好的 SSE 规范 | ✅ 20+ 渠道（WhatsApp、Telegram、Slack、Discord、iMessage、飞书、微信、QQ…）——核心强项 | Telegram、Discord、Slack、WhatsApp | ❌ 无（终端/IDE/Web 应用） |
| IM 上的人机协同 | ✅ **运行中途同步 AskUserQuestion + 高危工具确认**（独有） | 部分（有 exec 审批，但不是通用的阻塞式问答协议） | 有限 | 仅 TUI 提示 |
| 治理 / 合规 | ✅ 审计 + 图表、高危清单确认、PII 脱敏、Hooks、管理控制台 | 极少（个人工具）；配对码、白名单 | 极少 | 有企业 managed-settings 但无中心服务器 |
| 调度 | ✅ 守护进程 + Agent 自调度工具 + 运行历史 UI | ✅ cron 任务 | ✅ cron 调度 | 云端 `/schedule`（依赖 Anthropic 云） |
| 持久记忆 | ❌ 仅会话续聊 | 部分（会话/工作区文件） | ✅ **跨会话记忆 + 自我进化 Skills**——核心强项 | 按项目 CLAUDE.md/自动记忆 |
| Skills 生态 | 内部 Skill Hub（受控、企业向） | **ClawHub 社区市场** | 自动习得的 Skills | 插件/Skill 市场 |
| 离线 / 内网隔离部署 | ✅ **同类最佳**（`pack.sh`，无外部服务） | ❌ 默认依赖公网（npm、API） | 部分（可自托管，但通常在线模型） | ❌ 需 Anthropic/网关在线；无服务器模式 |
| 协议 / 社区 | 专有/自研内部 | MIT，大社区 | 开源（Nous） | 专有（CLI 免费） |

### 6.2 Vivian 赢在哪

1. **多租户 + 治理是护城河。** OpenClaw 和 Hermes 都无法可信地回答"给 200 名员工每人一个 Agent，各用各的网关 token，带审计和管理员强制审批规则"。这正是 Vivian 存在的全部理由，且做得很深（permission respond 的所有者校验、按用户 Skill 白名单、管理员可检视任意用户的 Skills/MCP/任务）。
2. **同步 IM 审批协议。** OpenClaw 基本把渠道当传输层；Vivian 把渠道变成*控制面*——Agent 可以中途暂停，用纯文本和人协商。规范的质量（超时语义、降级开关、答案映射重建）领先任何可比方案。
3. **Claude Code 引擎保真度。** Hermes 和 OpenClaw 跑自己的循环；Vivian 继承 Anthropic 的——包括检查点/回滚、计划模式、子代理、Skills 格式——并在 UI 里完整呈现（回滚横幅、计划评审面板），甚至超过 Anthropic 自己的 Web 应用。
4. **内网隔离部署。** 这一组里独一份。

### 6.3 Vivian 输在哪

1. **渠道广度。** 一个深度渠道（企业微信）对 OpenClaw 的 20+。OpenClaw *桥接*是委派而非渠道复用——Vivian 今天没法不写新守护进程就在 WhatsApp/Telegram/飞书上应答。
2. **没有持久记忆。** Hermes 的跨会话记忆 + 自学 Skills 造就一个*越用越好*的助理；Vivian 的 Agent 除非用户续聊某个会话，否则一切归零。
3. **生态引力。** MIT 社区（ClawHub、Hermes 的 GitHub）会复利增长；内部 Skill Hub 不会。
4. **单机扩展天花板**——一个部门够用，全公司铺开是问题。

---

## 7. 为什么不直接用 Claude Code？

Vivian *就是在用* Claude Code——每次运行都是一个 Claude Code CLI 子进程。真正的问题是"为什么不直接把 CLI 发给员工？"代码库本身就是答案：

1. **身份与凭证。** 原生 Claude Code 是一个用户、一个 `~/.claude`、一份凭证。Vivian 把每次运行绑定到 JWT 认证的用户和该用户*自己的*网关 base-url/token（`options.py` 没有就拒绝运行）——中心化发放、吊销、按用户成本归集。（项目记忆里记录过一个真实故障：用户级 `~/.claude.json` 的 env 块静默压过注入的网关地址——这正是中心化注入要消灭的问题类别。）
2. **非开发者可用。** CLI 假设你有终端、懂 git，能独立完成各种高级的Hooks, SubAgents, MCP 的配置。Vivian 的用户在企业微信或浏览器里聊天，Agent 运行在目标服务器/私有云平台，并且实时可观测；Agent 产出的文件通过注入的 `FileCanvas` MCP 工具呈现在 Canvas 上，而不是丢在某个目录里。
3. **用户关不掉的治理。** CLI 用户自己选权限模式、自己改设置。Vivian 的高危清单、危险 bash Hook、PII 脱敏、禁用工具、审计日志全部**服务端强制**、按管理员策略统一执行，收敛用户配置 CLI 的能力差异带来的风险——进程从来不归用户所有。
4. **随时随地的同步审批。** Claude Code 的权限提示活在 TUI 里。Vivian 把它们外化为 `permission_request` 事件，可以在浏览器标签页或一条企业微信消息里应答——Agent 运行和审批的人不再需要共享一个终端。
5. **不依赖 Anthropic 云的常驻自治。** Claude Code 的定时/云端 Agent 依赖 Anthropic 云，在企业网关后无法使用。Vivian 的调度器守护进程完全在本地跑 cron Agent 任务，带历史和管理 UI。
6. **机队运维。** 会话集中存储在服务器（可列出/检索/删除任意用户的会话）、用量统计、Prometheus 指标、可热切换的 CLI 二进制路径（管理员一次给所有人升级 CLI 版本）、离线打包——200 台笔记本各跑各的 CLI 时这些全都不存在。
7. **规模化的故障兜底。** 个人 CLI 用户在网关抖动时手动重试就行；平台不行——于是有了合成错误重试/修复/resume 层，本质上是*围绕 CLI 固化下来的 SRE 工作*。

诚实的推论：对一个有终端、能直连 API 的单个开发者，原生 Claude Code 严格更好——Vivian 的价值恰好从"一个用户、一个终端、一把钥匙"失效的地方开始，是**给组织的托管平台**。

---

## 8. 面向未来产品演进的关键竞争优化

按杠杆率（影响 ÷ 成本）排序，对应 §6 的竞争缺口：

1. **持久记忆层（补 Hermes 的缺口）。** 按用户、按会话（chat）的记忆文件注入系统提示词（`vivian_plugin/` 的插件体系是天然挂载点——`enterprise_user_info` 已经验证了该模式）。先做：按企业微信 chat key 的滚动对话摘要、用户偏好记忆、每次运行后的回写 Hook。这把 Vivian 从"每次会话都是新 Agent"变成"认识你的助理"，是现成可得的最大感知质量跃升。
2. **渠道 SPI + 再加 2–3 个渠道（补 OpenClaw 的缺口）。** 企业微信守护进程硬编码了渠道逻辑；把已验证的抽象（按 chat key 的消息队列、待答状态机、会话映射、准入门、主动推送）抽成渠道接口，然后上**飞书和钉钉**适配器——`docs/im-channel-permission-zh.md` 的 SSE 协议已经是现成契约。备选/叠加方案：把 OpenClaw *当渠道扇出*用（它会说 20+ 渠道，包括飞书/微信），Vivian 继续做受治理的引擎——桥已经在了，反转方向可能比写五个适配器便宜。
3. **水平扩展逃生通道。** 把进程内权限注册表 + 文件队列换成 SQLite→Postgres + Redis pub/sub，藏在薄的 repository 接口后面，让 SSE 流和 permission respond 能跨 worker。即使默认仍是单机，拆掉架构天花板能为更大规模铺开去风险。
4. **下一部署层级的安全加固。** 初始化时强制轮换 JWT 密钥/密码、配置化 CORS 白名单、可选 `METRICS_TOKEN`（ADR-0002 已预留），以及——最重要的——**沙箱化工具执行**（按运行起容器或 bubblewrap，bind-mount 用户工作区）。最后这一项是"受治理"和"被容器化约束"的分界线，而这一组竞品也都没有：先做的人赢得企业安全评审。
5. **CLI 契约测试套件。** heal/strip/resume 逻辑依赖 Claude Code 私有的会话 JSONL 格式和合成错误形态。一套小型集成测试，让*捆绑的* CLI 跑脚本化故障（并在 CI 里对每个 CLI 升级候选跑一遍），把代码库里最危险的耦合变成被管理的耦合——使 SDK 升级速度快过竞品所能安全做到的程度。
6. **成本与配额平面。** token 用量已经按运行审计；加上按用户/按团队预算、运行启动时的软/硬配额拦截、成本看板。企业买家在问完审计之后马上就会问这个，OpenClaw 和 Hermes 都没有。
7. **Skill Hub 的内部网络效应。** 加版本化、签名、审批工作流和自动评测（内置的 `skill-creator` 已含评测框架——把它接进 Hub 分发当质量门）。卖点变成"受治理的内部市场"，恰好以企业偏好的方式对照 ClawHub 的无治理社区模式。
8. **确定性的多 Agent 编排。** 子代理已有；下一步是可复用、可调度的流水线（评审 → 验证 → 综合），每阶段带审计——调度器的 `AgentRunConfig` 是天然基座。这契合前沿 harness 的演进方向，并能同时区隔两家竞品的单循环设计。
9. **群聊原生运行。** 当前企业微信集成在单聊最强（群历史按 SDK 限制是 push-only；完整历史需要单独的会话存档/msgaudit 产品）。面向"Agent 作为群成员"设计——@提及触发运行、按群记忆、按话题（thread）的会话——这才是中国企业 IM 的真实使用重心。
10. **可观测性收尾。** OpenTelemetry 已是依赖；按运行/工具/重试打 span 并关联审计条目，给运维一个"这个回答为什么慢"的链路视图——成本低、信任回报高。

---

## 附录 A —— 关键文件地图

| 领域 | 文件 |
|---|---|
| 引擎 | `vivian/api/services/claude_sdk/{options,service,permission_coordinator,retry,session_heal,serialization}.py` |
| 渠道 | `vivian/api/services/channels/{daemon,wecom_feedback,openclaw_bridge,openclaw_mcp_tools,config_store}.py` |
| 调度器 | `vivian/api/services/scheduler/{daemon,job_store,run_history,mcp_tools,builtin_tasks,tool_retry}.py` |
| 治理 | `vivian/api/services/hooks/*`、`services/audit_log.py`、`utils/sensitive_mask.py`、`services/user_store.py` |
| API 面 | `vivian/api/routers/*`（17 个 router，约 120 个端点，含 `/api/agent/ws/run`、`/api/agent/run/stream`、`/api/pty/ws`） |
| 前端 | `vivian/web/src/{components,stores,api}`（21 个 Zustand store；chat/canvas/admin/scheduler/skills/mcp/hooks/subagents/terminal） |
| 部署 | `pack.sh`、`vivian/bin/server.sh`、`requirements.txt` |
| 规范 | `docs/im-channel-permission-zh.md`、`docs/adr/000{1,2}-*.md`、`vivian/web/design-spec.md`、`CLAUDE.md`/`AGENTS.md` |

## 附录 B —— 竞品资料来源

- [OpenClaw GitHub](https://github.com/openclaw/openclaw) · [OpenClaw 文档](https://docs.openclaw.ai/) · [OpenClaw 架构综述（ppaolo）](https://ppaolo.substack.com/p/openclaw-system-architecture-overview) · [多渠道网关指南（Bill WANG）](https://medium.com/@ozbillwang/understanding-openclaw-a-comprehensive-guide-to-the-multi-channel-ai-gateway-ad8857cd1121)
- [Hermes Agent（NousResearch）— Web UI gateway issue #501](https://github.com/NousResearch/hermes-agent/issues/501) · [Hermes vs OpenClaw 对比（hostadvice）](https://hostadvice.com/blog/ai/hermes-agent-vs-openclaw/) · [2026 Hermes 替代方案（Composio）](https://composio.dev/content/hermes-agent-alternatives) · [Hermes WebUI 与替代品（BSWEN）](https://docs.bswen.com/blog/2026-06-02-hermes-webui-vs-alternatives/)
- OpenClaw 协议桥的库内证据：`vivian/api/services/channels/openclaw_bridge.py`（Ed25519 设备身份握手，网关协议 v3）。
