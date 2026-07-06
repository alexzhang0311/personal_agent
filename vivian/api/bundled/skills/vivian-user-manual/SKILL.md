---
name: vivian-user-manual
description: Vivian 平台用户手册。当用户询问如何使用 Vivian、应用有哪些功能、API 怎么调用、怎么配置设置、管理技能、添加 MCP 服务器、配置 Hooks、管理用户、上传文件等问题时使用。触发词包括：用户手册、使用指南、怎么用、功能介绍、帮助文档、how to use、user manual、features、getting started。即使用户没有明确说"手册"，只要在问 Vivian 平台的使用方法或功能，也应触发此技能。
metadata:
  icon: BookMarked
  icon_color: "#58a6ff"
---

# Vivian 用户手册

## 一、概述

Vivian 是一个 AI Agent 对话与管理平台。你可以通过浏览器与 Claude AI 进行对话，管理技能、MCP 工具服务器、Hooks 生命周期钩子等。

- 打开浏览器访问部署地址即可使用
- 支持**中文**和**英文**界面，右上角切换
- 支持**深色**和**浅色**主题

---

## 二、快速开始 — 设置向导

```
首次访问 → 创建管理员账号（自动登录）→ 设置向导（LLM 配置 3 步）→ 开始使用
```

- **创建管理员**：首次访问自动显示，填写用户名+密码，创建后自动登录
- **登录**：非首次用户输入用户名+密码登录（连续 5 次失败触发 60 秒冷却）
- **设置向导**：首次登录后自动弹出（检测到未配置 LLM）
  - Step 1/3：填写 Base URL + Auth Token，自动测试连接
  - Step 2/3：选择 Default / Opus / Sonnet / Haiku 模型（Default 必填）
  - Step 3/3：确认配置并保存
  - 可点击「Skip for now」跳过，24 小时后再次提醒
- **语言/主题**：导航栏右侧切换中文/English、深色/浅色

> 详细操作请读取 `references/webapp-setup.md`

---

## 三、整体布局

```
┌──────────────────────────────────────────────────────────────────────────┐
│  导航栏  [Vivian] [Skills] [MCP] [Scheduler] [Hooks] [SubAgents]       │
│          [Memory] [用户数据]                            ⚙ 🌐 🎨 用户名  │
├──────────┬───────────────────────────────┬───────────────────────────────┤
│  侧边栏   │        主内容区                 │    Canvas 面板               │
│ ┌──────┐ │                               │   ┌───────────┐             │
│ │项目│全局│ │                               │   │  TASKS    │             │
│ │ 全部  │ │                               │   │  FILES    │             │
│ │ 搜索  │ │     对话消息流                   │   │  PLAN     │             │
│ ├──────┤ │     (用户消息 / AI 回复)         │   └───────────┘             │
│ │ 会话1 │ │                               │                             │
│ │ 会话2 │ │  ┌───────────────────────┐    │                             │
│ │ 会话3 │ │  │ 输入框 · /技能 · @文件  │    │                             │
│ │ ...  │ │  │ [+] [权限▼] [模型▼]    │    │                             │
│ └──────┘ │  └───────────────────────┘    │                             │
│ [⚙设置]  │  [快捷操作1] [快捷操作2] ...    │                             │
│ [◀折叠]  │                               │                             │
├──────────┴───────────────────────────────┴───────────────────────────────┤
└──────────────────────────────────────────────────────────────────────────┘
```

- **侧边栏**（左）：会话历史列表，可搜索、删除、按项目/全局筛选。可拖拽调整宽度或折叠
- **主内容区**（中）：当前标签页的核心内容
- **Canvas 面板**（右）：Agent 工作时自动弹出，展示任务进度/文件操作/计划审查。可折叠

---

## 四、聊天功能（Vivian 标签页）

核心对话界面，包含以下功能：

- **发消息**：输入文字按 Enter 发送，Agent 流式回复
- **技能调用**：输入 `/` 选择技能，技能以标签显示在输入框内
- **文件引用**：输入 `@` 选择已上传文件附加到消息
- **文件上传**：通过 + 按钮、拖拽或粘贴图片上传（最大 3MB，最多 5 个）
- **模型选择**：工具栏右侧下拉菜单切换 AI 模型
- **权限模式**：工具栏左侧 🛡 按钮切换（Bypass / Default / Accept Edits / Plan）
- **MCP 选择**：+ 按钮菜单中的 MCP 子菜单（Auto / Disable / 自选）
- **Canvas 面板**：右侧自动弹出，含 TASKS（任务树+待办）、FILES（文件操作）、PLAN（计划审查）
- **Plan 审批**：Plan 模式下审查计划后选择执行方式或提供反馈
- **引用回复**：引用消息文字进行针对性回复
- **快捷操作**：欢迎页显示预设按钮（4 列网格），支持 `{变量}` 模板
- **侧边栏**：会话列表（项目/全局/全部筛选，Today/Yesterday/More 分组），搜索、删除、折叠

> 详细操作请读取 `references/webapp-chat.md`

---

## 五、技能管理（Skills 标签页）

三栏布局：技能列表（左）→ 文件树（中）→ 文件预览（右）

- **浏览**：左栏显示所有技能，分 PROJECT（项目级）和 GLOBAL（全局），支持搜索和级别筛选（All/Project/Global）
- **查看**：点击技能 → 中栏显示文件树（支持搜索）→ 点击文件 → 右栏预览（Markdown 预览/源码切换，语法高亮，行号）
- **上传**：支持 .zip / .tar.gz / .tgz / .skill 格式，普通用户上传到 project 级别，管理员可选 project 或 global
- **下载**：文件树顶部下载按钮，导出为 .tar.gz
- **删除**：文件树顶部删除按钮，需输入技能名确认（project 级别或管理员可操作）
- **优化**：在文件预览中选中代码 → 弹出 Optimize 气泡 → 添加评论 → 发送到聊天让 Agent 改进（仅 project 技能）
- **启用/禁用**：全局技能可单独开关，禁用后 Agent 不会调用
- **Skill Hub**：左栏 Hub 按钮打开技能市场，浏览/预览/一键安装全局技能

> 详细操作请读取 `references/webapp-skills.md`

---

## 六、MCP 服务器管理（MCP 标签页）

四栏布局：服务器列表（左）→ 服务器元信息（左中）→ 能力详情（中）→ 工具测试抽屉（右，按需弹出）

- **浏览**：左栏显示所有服务器，分 PROJECT / GLOBAL，支持搜索和级别筛选
- **添加**：搜索栏旁 + 按钮，填写名称、类型（HTTP/SSE）、URL、超时、请求头，**测试通过后**才可保存
- **编辑**：元信息面板顶部编辑按钮，打开同一表单修改配置（project 级别或管理员）
- **删除**：元信息面板底部删除按钮，需输入服务器名确认（project 级别或管理员）
- **查看能力**：TOOLS / PROMPTS / RESOURCES 三个标签页，显示服务器提供的工具、提示词模板、资源
- **测试工具**：点击工具名 → 右侧抽屉弹出 → 按 schema 自动生成表单 → 填参数 → 运行 → 查看结果（支持 JSON/Markdown/图片自动渲染）
- **敏感信息**：包含 auth/token/key/secret 的请求头值在元信息面板中自动脱敏显示

> 详细操作请读取 `references/webapp-mcp.md`

---

## 七、Scheduler（定时任务，Scheduler 标签页）

按 cron 或时间间隔自动执行任务，支持三种任务类型。

- **任务类型**：Agent Run（AI 对话）、HTTP Call（HTTP 请求）、User Script（Python/Shell 脚本）
- **触发方式**：Cron 定时（预设 + 自定义五段表达式）或 固定间隔（秒/分/时/天/周）
- **任务管理**：创建、编辑、暂停/恢复、立即触发、删除
- **运行历史**：按任务查看历史执行记录（状态、耗时、轮次），支持分页
- **运行详情**：实时查看执行输出（Agent 事件流 / 脚本 stdout+stderr / HTTP 请求响应），2 秒轮询自动刷新
- **运行中任务**：查看正在执行的任务列表，支持查看输出和取消执行
- **健康指示器**：左栏顶部圆点显示调度器健康状态

> 详细操作请读取 `references/webapp-scheduler.md`

---

## 七.5、即将推出的功能

以下功能正在开发中，敬请期待：

| 功能 | 说明 | 状态 |
|------|------|------|
| **SubAgents（子代理）** | 多 Agent 协作，主 Agent 可派遣子代理并行处理 | 标签页已存在，功能开发中 |
| **Memory（记忆）** | Agent 跨会话记忆管理，记住用户偏好和上下文 | 标签页已存在，功能开发中 |

---

## 八、Hooks 生命周期钩子（Hooks 标签页）

在 Agent 执行的关键节点插入自定义逻辑。三栏布局：侧边栏 Hook 列表（左）→ 交互式生命周期图谱（中）→ 详情面板（右，按需弹出）。

- **13 个生命周期事件**，分 4 组：Session（setup / session-start / session-end）、Tool（user-prompt-submit / pre-tool-use / permission-request / post-tool-use / post-tool-use-failure）、Agent（subagent-start / subagent-stop / stop）、Misc（notification / pre-compact）
- **可拦截事件**：pre-tool-use、permission-request、stop 标记为 BLOCK，处理器可阻止操作继续
- **生命周期图谱**：SVG 可视化，支持缩放/平移/点击节点查看弹窗说明
- **内置 Hook**：启用/禁用开关，查看源码，管理员可强制执行（ENFORCED）
- **自定义处理器**（CONFIG 标签页）：4 种类型 — Command（Shell 脚本）、HTTP（请求 URL）、Prompt（调用模型）、Agent（即将推出），支持 matcher 匹配和超时设置
- **测试**（TEST 标签页）：从下拉选择处理器或输入自定义命令，填入 JSON 输入，运行查看 exit code / stdout / stderr 或内置 Hook 的 pass/deny 结果
- **日志**（LOGS 标签页）：执行历史记录表格，按事件类型筛选，支持自动刷新（10 秒）和分页（每页 50 条）

> 详细操作请读取 `references/webapp-hooks.md`

---

## 九、用户数据（用户数据标签页）

左侧导航栏切换各子页面，包含统计、文件管理和管理员功能。

- **使用量**：会话数、存储空间、文件数、总文件大小、最近活跃时间
- **分析图表**：活动时间线（按类别堆叠面积图）、热门技能（水平条形图）、会话活动趋势（垂直条形图），支持自定义时间范围
- **审计日志**：按类型/时间/目标/操作人筛选，左侧条目列表（可展开 JSON 详情）+ 右侧图表，支持自动刷新和分页
- **文件管理**：可排序表格 + 右侧预览抽屉（支持 CSV/Excel/Word/PDF/Markdown/代码 等多格式预览），按日期/扩展名/关键字筛选，批量选择删除，复制服务器路径
- **文件浏览器**：目录式文件浏览界面，左侧文件列表 + 右侧预览面板（可拖拽调整宽度），支持面包屑导航和路径输入跳转。预览面板支持代码语法高亮、图片、PDF 等多格式。**Ask for Vivian**：在预览面板中选中文本 → 弹出「询问 Vivian」气泡 → 打开评论弹窗 → 发送到聊天（Plan 模式），或点击文件名旁的 ✨ 图标直接对整个文件发起提问
- **用户管理**（仅管理员）：创建/编辑/删除用户，修改角色和密码，生成/撤销 API Key，查看用户的技能和 MCP 配置（Inspect 面板）

> 详细操作请读取 `references/webapp-userdata.md`

---

## 十、设置（⚙ 按钮）

侧边栏底部设置按钮或弹窗打开，覆盖式面板，左侧标签导航 + 右侧内容区。

**所有用户可见：**
- **API Key**：生成/重新生成/撤销 API Key，密码遮罩 + 显示切换 + 复制
- **LLM 提供商**：配置 Base URL + Auth Token（自动测试连接），选择 Default/Opus/Sonnet/Haiku 模型（可搜索下拉），配置 Vision 模型
- **快捷操作**：创建聊天欢迎页快捷按钮（名称 + 提示词模板 + 50+ 图标选择），支持 `{变量}` 占位符
- **Channels**：WeCom 机器人配置（Bot ID、Secret、代理 URL、用户白名单、欢迎/拒绝消息、模型覆盖、队列/超时），实时连接状态轮询；Feishu 即将推出
- **Advanced**：传输模式切换（WebSocket / SSE）

**管理员专属：**
- **Runtime**：全局系统提示词（开关 + 编辑/预览 + 字符计数），历史保留天数，CLI 路径，工具重试配置（重试次数/间隔 + Script/WeCom 回调）
- **Plugins**：MCP 插件管理（启用/禁用 + URL/工具名/超时/请求头配置）

> 详细操作请读取 `references/webapp-settings.md`

---

## 十一、API 调用指南

### 鉴权方式

所有 API 请求需要在 Header 中携带鉴权信息：

```
Authorization: Bearer <你的JWT令牌或API Key>
```

JWT 令牌通过登录接口获取，API Key 在设置页面生成。公开端点（setup、login）无需鉴权。

### 端点概览

| 分类 | 方法 | 路径 | 说明 |
|------|------|------|------|
| **认证** | GET | /api/auth/setup | 检查是否需要初始化 |
| | POST | /api/auth/setup | 首次设置管理员 |
| | POST | /api/auth/login | 登录获取令牌 |
| | POST | /api/auth/refresh | 刷新令牌 |
| | GET | /api/auth/me | 获取当前用户信息 |
| | GET | /api/auth/me/apikey | 获取 API Key |
| | POST | /api/auth/me/apikey | 生成 API Key |
| | DELETE | /api/auth/me/apikey | 撤销 API Key |
| | GET | /api/auth/me/env | 获取用户环境配置 |
| | PUT | /api/auth/me/env | 更新用户环境配置 |
| | GET | /api/auth/me/env/status | 检查环境是否已配置 |
| **对话** | POST | /api/agent/run | 发送消息（同步） |
| | POST | /api/agent/run/stream | 发送消息（流式 SSE） |
| | WS | /api/agent/ws/run | WebSocket 实时对话 |
| | GET | /api/agent/sessions | 获取会话列表 |
| | GET | /api/agent/sessions/{id}/messages | 获取会话消息 |
| | DELETE | /api/agent/sessions/{id} | 删除会话 |
| | POST | /api/agent/permission/respond | 回应权限请求 |
| **技能** | GET | /api/resource/skills/ | 获取技能列表 |
| | GET | /api/resource/skills/{level}/{name} | 获取技能详情 |
| | GET | /api/resource/skills/{level}/{name}/file | 获取技能文件内容 |
| | GET | /api/resource/skills/{level}/{name}/download | 下载技能包 |
| | POST | /api/resource/skills/upload | 上传技能（FormData） |
| | DELETE | /api/resource/skills/{level}/{name} | 删除技能 |
| | GET | /api/resource/skills/config | 获取技能启用配置 |
| | PUT | /api/resource/skills/config | 更新技能启用配置 |
| **Skill Hub** | GET | /api/resource/skill-hub/ | 获取 Hub 技能列表 |
| | GET | /api/resource/skill-hub/{name} | 获取 Hub 技能详情 |
| | POST | /api/resource/skill-hub/{name}/deliver | 安装 Hub 技能 |
| | POST | /api/resource/skill-hub/upload | 上传到 Hub（管理员） |
| | DELETE | /api/resource/skill-hub/{name} | 删除 Hub 技能（管理员） |
| **MCP** | GET | /api/resource/mcp/ | 获取 MCP 服务器列表 |
| | GET | /api/resource/mcp/{level}/{name} | 获取服务器详情 |
| | GET | /api/resource/mcp/{level}/{name}/capabilities | 获取服务器能力 |
| | POST | /api/resource/mcp/ | 添加 MCP 服务器 |
| | PUT | /api/resource/mcp/{level}/{name} | 更新 MCP 服务器 |
| | DELETE | /api/resource/mcp/{level}/{name} | 删除 MCP 服务器 |
| | POST | /api/resource/mcp/validate | 测试服务器连接 |
| | POST | /api/resource/mcp/validate/tool | 测试工具执行 |
| **文件** | POST | /api/files/upload | 上传文件（FormData） |
| | GET | /api/files/ | 获取文件列表 |
| | GET | /api/files/{uuid} | 下载文件 |
| | DELETE | /api/files/{uuid} | 删除文件 |
| **Scheduler** | GET | /api/scheduler/jobs | 获取任务列表 |
| | POST | /api/scheduler/jobs | 创建任务 |
| | GET | /api/scheduler/jobs/{id} | 获取任务详情 |
| | PUT | /api/scheduler/jobs/{id} | 更新任务 |
| | DELETE | /api/scheduler/jobs/{id} | 删除任务 |
| | POST | /api/scheduler/jobs/{id}/pause | 暂停任务 |
| | POST | /api/scheduler/jobs/{id}/resume | 恢复任务 |
| | POST | /api/scheduler/jobs/{id}/trigger | 立即触发 |
| | GET | /api/scheduler/jobs/{id}/history | 获取任务运行历史 |
| | GET | /api/scheduler/running | 获取运行中任务 |
| | GET | /api/scheduler/running/{id}/output | 获取运行输出 |
| | POST | /api/scheduler/running/{id}/cancel | 取消运行 |
| | GET | /api/scheduler/health | 获取调度器健康状态 |
| | POST | /api/scheduler/lint-script | 脚本语法检查 |
| **Hooks** | GET | /api/hooks/catalog | 获取内置 Hook 列表 |
| | POST | /api/hooks/catalog/{id}/enable | 启用内置 Hook |
| | POST | /api/hooks/catalog/{id}/disable | 禁用内置 Hook |
| | GET | /api/hooks/config | 获取 Hook 配置 |
| | PUT | /api/hooks/config | 更新 Hook 配置 |
| | POST | /api/hooks/test | 测试自定义 Hook |
| | POST | /api/hooks/test/builtin | 测试内置 Hook |
| | GET | /api/hooks/logs | 获取执行日志 |
| | GET | /api/hooks/script/content | 获取脚本内容 |
| **Channels** | GET | /api/channels/wecom/config | 获取 WeCom 配置 |
| | PUT | /api/channels/wecom/config | 更新 WeCom 配置 |
| | POST | /api/channels/wecom/connect | 连接 WeCom |
| | POST | /api/channels/wecom/disconnect | 断开 WeCom |
| | POST | /api/channels/wecom/reconnect | 重新连接 |
| | GET | /api/channels/wecom/status | 获取连接状态 |
| | GET | /api/channels/health | 获取渠道健康状态 |
| **用户数据** | GET | /api/user/stats | 获取用户统计 |
| | GET | /api/user/audit | 获取用户审计日志 |
| | GET | /api/user/analytics | 获取用户分析数据 |
| | GET | /api/user/files/list | 浏览用户文件目录 |
| | GET | /api/user/files/preview | 预览用户文件 |
| | GET | /api/user/files/download | 下载用户文件 |
| **设置** | GET | /api/resource/models | 获取可用模型列表 |
| | GET | /api/resource/quickactions | 获取快捷操作 |
| | PUT | /api/resource/quickactions | 更新快捷操作 |
| | GET | /api/resource/vision-model | 获取 Vision 模型 |
| | PUT | /api/resource/vision-model | 更新 Vision 模型 |
| **管理员** | GET | /api/admin/users | 获取用户列表 |
| | POST | /api/admin/users | 创建用户 |
| | PUT | /api/admin/users/{username} | 更新用户 |
| | DELETE | /api/admin/users/{username} | 删除用户 |
| | GET | /api/admin/stats | 系统统计 |
| | GET | /api/admin/audit | 审计日志 |
| | GET | /api/admin/users/{username}/skills | 查看用户技能 |
| | GET | /api/admin/users/{username}/mcp | 查看用户 MCP |
| | GET/PUT | /api/admin/presetprompt | 系统提示词 |
| | GET/PUT | /api/admin/clipath | CLI 路径 |
| | GET/PUT | /api/admin/history-retention | 历史保留 |
| | GET/PUT | /api/admin/retryable-tools | 工具重试 |
| | GET/PUT | /api/admin/system/plugin/{id} | 插件管理 |
| | GET | /api/admin/files/list | 管理员文件浏览 |
| | GET | /api/admin/files/preview | 管理员文件预览 |
| | POST | /api/admin/files/upload | 管理员文件上传 |

> 完整请求/响应格式请读取对应的 `references/api-*.md` 文件

---

## 十二、常用操作速查

### 1. 首次设置
打开浏览器 → 创建管理员 → 登录 → 设置 → 配置 LLM 提供商 → 保存

### 2. 开始新对话
点击侧边栏「新对话」→ 输入消息 → 发送 → 查看 Agent 回复

### 3. 上传并引用文件
+ 按钮上传文件或拖拽上传 → 在输入框输入 `@` → 选择文件 → 发送

### 4. 使用技能
输入 `/` → 从列表选择技能 → 输入指令 → 发送

### 5. 添加 MCP 服务器
MCP 标签页 → 添加 → 填写配置 → 测试连接 → 保存

### 6. 配置 Hook
Hooks 标签页 → 选择事件 → CONFIG → 添加处理器 → 保存

### 7. 创建新用户（管理员）
用户数据 → 管理面板 → 创建用户 → 填写用户名/密码/角色

### 8. 生成 API Key
设置 → API Key → 点击「生成」→ 复制 Key → 用于 API 调用

---

## 十三、参考文件索引

需要更详细的操作说明或 API 文档时，读取以下文件：

| 文件 | 内容 |
|------|------|
| `references/webapp-setup.md` | 设置向导完整操作指南 |
| `references/webapp-chat.md` | 聊天界面完整操作指南 |
| `references/webapp-skills.md` | 技能管理面板完整操作指南 |
| `references/webapp-mcp.md` | MCP 服务器管理面板完整操作指南 |
| `references/webapp-settings.md` | 设置面板完整操作指南 |
| `references/webapp-scheduler.md` | 定时任务管理完整操作指南 |
| `references/webapp-hooks.md` | Hooks 面板完整操作指南 |
| `references/webapp-userdata.md` | 用户数据面板完整操作指南 |
| `references/api-auth.md` | 认证 API（登录、注册、API Key、环境配置） |
| `references/api-agent.md` | Agent 对话 API（同步/流式/WebSocket、会话管理、权限响应） |
| `references/api-skills.md` | 技能管理 API（CRUD、文件查看、下载、启用配置） |
| `references/api-mcp.md` | MCP 服务器 API（CRUD、能力查询、连接验证、工具测试） |
| `references/api-hooks.md` | Hooks API（内置 Hook、自定义处理器、测试、日志） |
| `references/api-admin.md` | 管理员 API（用户管理、系统配置、插件、文件浏览） |
| `references/api-channels.md` | WeCom 渠道 API（配置、连接控制、状态查询） |
| `references/api-files.md` | 文件管理 API（上传、下载、列表、删除） |
