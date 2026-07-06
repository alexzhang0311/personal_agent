# 定时任务管理面板详细操作指南

点击顶部导航栏的「Scheduler」标签页进入定时任务管理。

---

## 界面布局

```
┌──────────────────┬──────────────────────────┬─────────────────┐
│  任务列表 (左栏)   │  运行历史 (中栏)           │  运行详情 (右栏)  │
│                  │                          │  (按需弹出)      │
│ SCHEDULER 🟢     │ RUN HISTORY — my-job     │  RUN DETAIL      │
│ [+ NEW JOB]      │          kept 7 days [🔄]│  Status: SUCCESS │
│ ┌──────────────┐ │                          │  Started: ...    │
│ │ ▸ my-job     │ │ Status | Started | Dur.  │  Duration: 2m15s │
│ │   ACTIVE     │ │ ✅     | 09:00   | 2m15s│  Session: abc... │
│ │   cron 0 9 * │ │ ✅     | 09:00   | 1m30s│  [View Convers.] │
│ │              │ │ ❌     | 09:00   | 0.5s │                  │
│ │  (展开详情)   │ │                          │  RUN OUTPUT      │
│ │  🤖 Agent Run│ │        1 / 3       ▸     │  [事件流渲染...]   │
│ │  TZ: UTC+8   │ │                          │                  │
│ │  Next: 10:00 │ │                          │                  │
│ │  Prompt:     │ │                          │                  │
│ │  ┌────────┐  │ │                          │                  │
│ │  │ ...    │  │ │                          │                  │
│ │  └────────┘  │ │                          │                  │
│ │ [⏸][⚡][✏][🗑]│ │                          │                  │
│ └──────────────┘ │                          │                  │
│ [⚙设置]    [◀]  │                          │                  │
└──────────────────┴──────────────────────────┴─────────────────┘
```

---

## 任务列表侧边栏（左栏）

### 头部

- 标题「SCHEDULER」
- 健康指示器：绿色圆点 = 调度器正常，红色 = 异常
- 每 5 秒自动刷新状态

### 新建任务按钮

蓝色全宽按钮「+ NEW JOB」，点击弹出创建表单。

### 任务行

每个任务显示：

```
▸ my-daily-report              ACTIVE
  cron 0 9 * * *
```

- **▸ 展开箭头**：点击展开/折叠内联详情
- **任务名称**：粗体，截断显示
- **状态标签**：
  - `ACTIVE`（绿色）— 正常运行中
  - `PAUSED`（黄色）— 已暂停
- **触发摘要**（等宽字体）：
  - Cron 格式：`cron 0 9 * * *`
  - 间隔格式：`every 1h 30m`
- 选中任务左侧蓝色边框

### 内联详情（展开后）

点击任务行展开，显示详细信息：

**1. 任务类型标签**

| 类型 | 图标 | 颜色 |
|------|------|------|
| Agent Run | 🤖 Bot | 紫色 |
| HTTP Call | 🌐 Globe | 青色 |
| User Script | 💻 Terminal | 橙色 |

**2. 通用信息**
- **Timezone**：时区
- **Next Run**：下次执行时间

**3. 类型特有信息**

**Agent Run：**
- Model：使用的模型
- Prompt：提示词（代码块显示，最大高度 200px）

**HTTP Call：**
- Method + URL
- Headers（如有）
- Timeout
- Body（如有，POST/PUT 时）

**User Script：**
- Language：Python / Shell
- Source：file / inline
- File Path（文件模式）
- Timeout
- Script Preview（内联模式）

**4. 操作按钮**

```
[⏸ 暂停] [⚡ 立即触发] [✏ 编辑] [🗑 删除]
```

- **暂停/恢复**：切换任务的 ACTIVE/PAUSED 状态
- **立即触发**：立即执行一次（不影响定时计划）
- **编辑**：打开编辑表单
- **删除**：点击后变为确认按钮（红色「Confirm」+ 灰色「Cancel」）

### 底部操作栏

- **设置**：打开设置弹窗
- **折叠**：折叠为 48px 图标模式

---

## 创建/编辑任务

点击「+ NEW JOB」或任务详情的「编辑」按钮弹出表单。

### 基本信息

```
┌──────────────────────────────────────┐
│ CREATE JOB                      [×] │
│                                      │
│ NAME                                 │
│ ┌──────────────────────────────────┐ │
│ │ my-daily-report                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ JOB TYPE                             │
│ [AGENT RUN] [HTTP CALL] [USER SCRIPT]│
└──────────────────────────────────────┘
```

### 任务类型配置

#### Agent Run

```
PROMPT
┌──────────────────────────────────────┐
│ (PromptComposer 富文本输入框)          │
│ 支持 /技能 调用 + 文件附件上传          │
└──────────────────────────────────────┘

MODEL
┌──────────────────────────────────────┐
│ claude-sonnet-4                      │
└──────────────────────────────────────┘
```

- Prompt 使用与聊天相同的 PromptComposer 组件，支持技能选择和文件上传
- Model 为可选文本输入

#### HTTP Call

```
METHOD              URL
┌────────┐ ┌──────────────────────────┐
│ POST ▼ │ │ https://api.example.com  │
└────────┘ └──────────────────────────┘

HTTP HEADERS
┌──────────┬────────────────────────┐
│ Auth     │ Bearer xxx          [×]│
└──────────┴────────────────────────┘
[+ Add Header]

BODY (POST/PUT only)
┌──────────────────────────────────────┐
│ {"key": "value"}                     │
└──────────────────────────────────────┘

TIMEOUT
┌──────┐
│ 30   │ seconds (1-300)
└──────┘
```

#### User Script

```
LANGUAGE            SOURCE
┌──────────┐ ┌────────────────┐
│ Python ▼ │ │ [FILE] [INLINE]│
└──────────┘ └────────────────┘
```

**文件模式：**
- File Path 输入框（等宽字体）
- 自动验证文件扩展名 + 加载预览
- 语法检查结果：✅ Passed / ❌ Failed（可展开查看错误列表）

**内联模式：**
- Script Content 编辑器（带语法诊断）
- 「✨ Ask Vivian」按钮：跳转到聊天让 AI 帮助编写脚本
- 语法检查结果：实时显示错误/警告数量

**Timeout**：1-3600 秒，默认 300

### 触发器配置

```
TRIGGER
[FIXED TIME (Cron)]  [REPEAT EVERY (Interval)]
```

#### Cron 模式

**预设按钮：**
```
[Daily 9am] [Every Hour] [Every Monday 9am] [Every 5min] [Custom]
```

选择预设后显示人类可读摘要：
- `Runs description: Daily at 09:00`
- `Runs description: Every hour at minute 0`
- `Runs description: Monday at 09:00`

**自定义模式**（选择 Custom 后显示）：

```
Minute    Hour      Day of Week
┌──────┐ ┌──────┐ ┌──────┐
│ 0    │ │ 9    │ │ *    │
└──────┘ └──────┘ └──────┘
Day       Month
┌──────┐ ┌──────┐
│ *    │ │ *    │
└──────┘ └──────┘
```

#### Interval 模式

```
┌──────┐ ┌──────────────┐
│ 2    │ │ hours     ▼  │
└──────┘ └──────────────┘
Runs description: every 2 hours
```

单位选项：seconds / minutes / hours / days / weeks

### 提交

- **Create**（新建）或 **Save**（编辑）按钮
- 验证规则：
  - Name 必填
  - Agent Run：Prompt 或技能或附件至少有一项
  - HTTP Call：URL 必填
  - User Script：文件模式需路径 + 语法检查通过；内联模式需内容 + 语法检查通过

---

## 运行历史（中栏）

选中任务后在中栏显示。

### 头部

```
RUN HISTORY — my-daily-report        kept 7 days  [🔄 RELOAD]
```

- 显示任务名称
- 保留天数提示（如果 retention_days > 0）
- 刷新按钮

### 历史表格

| 列 | 说明 |
|---|---|
| **Status** | 状态标签：🟣 Running / ✅ Success / ❌ Error / ⬚ Cancelled / ⏳ Pending / ⏭ Skipped |
| **Started At** | 开始时间 |
| **Duration** | 耗时（如 `2m 15s`、`500ms`） |
| **Turns** | Agent 对话轮次（非 Agent 类型显示 `-`） |
| **👁** | 查看按钮，点击打开运行详情 |

- 点击行可查看详情
- 分页控件：`{total} Total Runs`  `◀ 1 / 3 ▶`

---

## 运行详情（右栏抽屉）

点击运行记录后从右侧滑入，宽度可拖拽调整（280px ~ 60% 窗口宽度）。

### 元信息

- **Status**：大写彩色状态
- **Started At** / **Finished At**：时间戳
- **Duration**：耗时
- **Turns**：轮次
- **Session ID**：青色等宽字体 + 复制按钮（仅 Agent Run）
- **Error Message**（如有）：红色左边框代码块

### 操作

- **View Conversation**：跳转到 Vivian 聊天标签页加载该会话（仅有 session_id 时显示）
- **Reload**：重新加载详情
- **Close**：关闭抽屉

### 运行输出

实时显示执行事件流，正在运行时每 2 秒自动轮询新事件并滚动到底部。

#### Agent Run 事件

每个事件显示为可折叠块：
- **system**：会话初始化信息
- **assistant**：AI 回复文本 + 工具调用
- **tool_use**：工具名称
- **tool_result**：工具结果（错误时红色显示）
- **result**：最终结果（SUCCESS/ERROR 标签 + 轮次统计）
- **permission_request**：权限请求

每个块支持：
- 点击展开/折叠
- 切换「Formatted」/「Raw JSON」视图
- 复制原始 JSON

#### User Script 事件

```
┌──────────────────────────────────────┐
│ 🐍 Python  python3 script.py        │
│ cwd: /workspace                      │
│                                      │
│ [ALL (15)] [STDOUT (12)] [STDERR (3)]│
│                                      │
│ │ Processing data...                 │  ← stdout（灰色左边框）
│ │ Loading file...                    │
│ │ WARNING: missing field            │  ← stderr（红色左边框）
│ │ Done.                              │
│                                      │
│ exit 0                    elapsed 5s │
└──────────────────────────────────────┘
```

- 头部显示语言、命令、工作目录
- 输出标签页：ALL / STDOUT / STDERR（显示行数）
- 每行左侧彩色边框区分 stdout（灰色）和 stderr（红色）
- 底部显示退出码和耗时，超时显示 `TIMED OUT`

#### HTTP Call 事件

- **http_request**：蓝色左边框，显示 Method + URL + Headers
- **http_response**：绿色（2xx）或红色（其他）左边框，显示状态码 + 原因 + 耗时 + Body
- **http_error**：红色左边框，显示错误信息

---

## 运行中任务

任务列表下方显示当前正在执行的任务（每 5 秒自动刷新）：

```
┌──────────────────────────────────────┐
│ my-daily-report        elapsed 2m    │
│                          [👁] [⏹]   │
└──────────────────────────────────────┘
```

- **任务名称** + 已运行时间
- **👁 查看输出**：弹出输出抽屉（同运行详情的输出区域）
- **⏹ 取消**：点击后显示确认按钮，确认后取消执行
