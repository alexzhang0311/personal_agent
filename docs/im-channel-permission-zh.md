# IM 渠道接入指南：权限确认 / AskUserQuestion 交互（SSE）

> 面向对象：IM 渠道（飞书 / 企业微信 / 钉钉 / Telegram 等）的后端开发者。
> 目标：让 IM 用户能像在 WebUI 里一样，**同步地**回答 Agent 抛出的
> “征求意见”和“危险操作确认”，并把答案正确回灌给模型。
>
> 关键约束：**IM 输入框只支持纯文本**（没有按钮 / 卡片回调）。本指南的
> 重点就是：在“只能打字”的前提下，给终端用户设计最顺手的应答体验。

参考实现（可直接跑）：`scripts/sse_permission_demo.py`。

---

## 1. 整体流程

```
渠道服务                              vivian 服务
   │  POST /api/agent/run/stream  (SSE)   │
   ├──────────────────────────────────────▶
   │  event: stream_init / assistant ...   │   读流，只把最终 result 推给用户
   ◀──────────────────────────────────────┤
   │  event: permission_request {kind}     │   ← Agent 阻塞，等用户答复
   ◀──────────────────────────────────────┤
   │  把问题渲染成纯文本发给 IM 用户        │
   │  …用户在 IM 里打字回复…               │
   │  POST /api/agent/permission/respond   │   ← 第二个请求，原 SSE 连接保持不断
   ├──────────────────────────────────────▶
   │  event: tool_result / assistant ...   │   Agent 继续往下跑
   ◀──────────────────────────────────────┤
   │  event: result                        │   把结果发给用户，流结束
   ◀──────────────────────────────────────┤
```

要点：

- `permission_request` 出现时，**Agent 主循环被挂起**，SSE 流不会结束，
  只会持续发 `: keepalive` 注释行保活。你必须用**另一个 HTTP 请求**调用
  `/api/agent/permission/respond` 把答案送回去，原来的 SSE 连接继续读即可。
- 一个 run 同一时刻只会有一个待应答的 `request_id`（按出现顺序处理）。

---

## 2. 第一步：发起 Agent 运行

```
POST {BASE_URL}/api/agent/run/stream
Headers:
  Authorization: Bearer <api-key>      # 每用户 key 或全局 key
  x-user-name:   <username>            # 用全局 key 时必填；同时决定该 run 的归属人
  Accept:        text/event-stream
Body (JSON):
  {
    "message":         "<用户在 IM 里发来的话>",
    "session_id":      null,            # 续聊时填上一次拿到的真实 session id
    "permission_mode": "bypassPermissions",
    "mcp_servers":     "auto",
    "enable_permission_feedback": true  # 关键开关，见下
  }
```

- **`enable_permission_feedback`（可选，默认 `false`）**——是否启用本指南
  描述的同步应答能力：
  - `true`：本文全部生效。`AskUserQuestion` 会同步阻塞等用户作答，命中
    `risky_tool_list` 的危险操作也会阻塞等确认。**你的渠道必须按本文实现
    读流 + 回传**，否则连接会一直挂到超时（默认 600s）。
  - `false` 或不传：服务端**直接移除 `AskUserQuestion` 工具**（模型无法发
    起询问，连接不会挂死），危险/受控工具一律按“拒绝”默认处理。适合
    暂时还没实现应答逻辑、或确实无法交互的渠道——**先这样接，保证不卡死**，
    后续再升级成 `true`。
  - 仅 `/api/agent/run/stream` 与 WebSocket 生效；同步的 `/api/agent/run`
    不处理该字段。
- `permission_mode` 用 `bypassPermissions`。注意：`enable_permission_feedback=true`
  时，**即使在 bypass 模式下 `AskUserQuestion` 仍会同步阻塞**等待用户作答；
  危险操作是否拦截由管理员的 `risky_tool_list` 控制。
- `x-user-name` 既是身份，也是该 run 的 owner。后面调
  `/permission/respond` 必须用**同一身份**，否则 403。

---

## 3. 第二步：解析 SSE 事件流

SSE 帧格式固定为：

```
event: <事件名>
data: <一行 JSON>
            ← 空行表示一帧结束
```

保活行是注释：`: keepalive`（以 `:` 开头），**直接忽略**。

解析伪代码：

```text
event = None
for line in stream.iter_lines():
    if line == "":            # 一帧结束
        dispatch(event, json.parse(buffered_data)); event = None
    elif line.startswith(":"):        # ": keepalive" → 跳过
        continue
    elif line.startswith("event:"):   event = line[6:].strip()
    elif line.startswith("data:"):    buffered_data = line[5:].strip()
```

### Session id 跟踪（务必实现）

- 收到 `stream_init` → 记录 `data.stream_id` 为当前 `session_id`。
- **之后每个事件**，若 `data.session_id` 存在就刷新当前 `session_id`
  （首个 `result` 时临时 uuid 会被换成真实 session id）。
- 调 `/permission/respond` 用“当前最新的 session_id”。若返回 404，用最新
  id 再试一次（见第 7 节）。

### 你需要关心的事件

| event | 处理 |
|---|---|
| `stream_init` | 记录 `stream_id` |
| `permission_request` | **核心**，见第 4 节 |
| `permission_timeout` | 该请求已超时作废，见第 6 节 |
| `result` | 取 `data.result` 作为最终答复发给用户，结束本轮 |
| `stream_error` / `retry_exhausted` | 出错，提示用户稍后重试 |
| 其它（assistant/tool 等） | 渠道一般只需丢弃；不要展示给用户 |

---

## 4. 第三步：处理 permission_request

`data` 结构：

```json
{
  "request_id":  "uuid",
  "tool_name":   "AskUserQuestion" | "Bash" | ...,
  "input":       { ... },           // 工具入参，ask_user 时含 questions
  "session_id":  "...",
  "risky":       false,
  "matched_rule":null,
  "reason":      null,
  "kind":        "ask_user" | "permission"
}
```

按 `kind` 分流。把 `request_id` 与“接下来这个用户的下一条 IM 消息”绑定。

---

### 4.1 场景一：征求意见 `kind = "ask_user"`（AskUserQuestion）

`input.questions` 是一个数组（1~4 个问题），每个问题：

```json
{
  "question":   "你最喜欢的编程语言是什么？",
  "header":     "编程语言",           // 短标签
  "multiSelect":false,                // true=可多选
  "options": [
    { "label": "Python", "description": "简洁优雅，数据分析/AI 首选" },
    { "label": "Rust",   "description": "内存安全+零成本抽象" },
    { "label": "Go",     "description": "云原生与并发服务热门" }
  ]
}
```

#### 纯文本下的最佳交互设计

核心原则：**让用户尽量只打一个数字**，同时容忍各种自然输入。

1. **选项编号化**。渲染时给每个选项编号，用户回数字即可：

   ```
   「请确认」编程语言
   你最喜欢的编程语言是什么？

   1. Python — 简洁优雅，数据分析/AI 首选
   2. Rust — 内存安全+零成本抽象
   3. Go — 云原生与并发服务热门

   回复序号即可（如 2）；也可直接输入你自己的答案；回复「跳过」放弃。
   ```

2. **三种输入都接受**（按优先级解析用户那条纯文本回复）：
   - **序号**：`2` → 选第 2 项；多选题：`1,3` 或 `1 3` 或 `1、3`。
   - **选项原文**：`Rust`（大小写/前后空格不敏感，可做包含匹配）。
   - **自由文本**：都没匹配上 → 当作自定义答案，原样作为该题答案。
   - **跳过/取消**：`跳过` `skip` `不答` → 视为放弃（见 5.1 deny）。

3. **多个问题 → 一题一问（强烈推荐）**。1~4 个问题不要挤在一条消息里逼
   用户用复杂格式回复。正确做法：

   - 渠道**逐题发送**，每发一题等用户回一条；
   - 答案**先在渠道本地缓存**；
   - **所有问题答完后，只调用一次** `/permission/respond`（一个
     `request_id` 对应整组问题）。

   这样用户始终面对“一个问题 + 选个数字”，认知负担最低，也最契合 IM 的
   一问一答习惯。

4. **回显确认**。用户答完后回一句「已记录：Rust」，让用户有掌控感；多题
   时可在最后汇总「已收到你的选择，正在继续…」。

5. **超时兜底**。后端默认 600 秒不答自动作废（管理员可配
   `agent.permission_timeout_seconds`）。期间可给用户一句温和提醒。

#### 把答案拼成 `answer` 文本（关键，决定模型能否拿到正确答案）

后端会把你回传的 `updated_input.answer` 文本解析成
`{问题 -> 答案}` 映射再喂给模型。**务必按下面这一种格式拼**，每个问题一行：

```
- <header 或 question> -> <答案值>
```

规则：

- 行首 `- `，中间分隔符是 ` -> `（空格-箭头-空格，半角）。
- 左边用该问题的 `header`（没有则用 `question` 原文），**必须与原问题
  完全一致**（多题靠它对号入座）。
- 右边是**选项的 label**（不是序号！渠道要先把数字换成 label）。
  - 多选：用**英文逗号 `,`** 连接多个 label，如 `阅读, 运动`
    （这样会话回看时也能正确高亮）。
  - 自定义文本：右边直接放用户原话。
- 单问题时也建议用这个格式（统一、且会话回看能正确还原）。
- `updated_input.questions` 必须原样回传第 3 节收到的
  `input.questions`（逐字 verbatim）。

示例：

| 场景 | answer 文本 |
|---|---|
| 单选 | `- 编程语言 -> Rust` |
| 多选 | `- 兴趣 -> 阅读, 运动` |
| 多题 | `- 编程语言 -> Rust`<br>`- 城市 -> 北京`（两行，`\n` 连接） |
| 自定义 | `- 角色定位 -> 我还没想好` |

> 为什么强调格式：多问题时后端按 `header/question` 对齐，行格式不对的
> 问题会被丢弃，模型就拿不到那一题的答案（会“瞎编”）。单问题相对宽松，
> 但统一用行格式最稳，且 WebUI 回看历史会话时能正确还原“已回答”卡片。

---

### 4.2 场景二：危险操作确认 `kind = "permission"`

管理员把某些工具（如 `Bash(rm:*)`）配进了风险清单，或使用了非 bypass
模式。此时 Agent 想执行某个动作，需要用户点头。

`data` 里可用字段：`tool_name`、`input`、`reason`、`risky`、`matched_rule`。

#### 纯文本下的最佳交互设计

1. **一句话说清要干什么**，默认用 `reason`；没有就用
   `tool_name` + 关键入参摘要。命中风险规则时显式标注。

   ```
   ⚠️ 需要你确认
   Agent 想执行：删除文件 /tmp/cache（Bash: rm -rf /tmp/cache）
   命中风险规则：Bash(rm:*)

   回复「确认 / y」执行，回复「取消 / n」拒绝。
   ```

2. **宽松识别是/否**（中英文都收，降低打字成本）：
   - 允许：`y` `yes` `是` `好` `确认` `同意` `允许` `执行` `ok` `1`
   - 拒绝：`n` `no` `否` `不` `取消` `拒绝` `算了` `0`
   - 无法识别时，再追问一次「请回复 确认 或 取消」，不要默默放过。

3. **危险操作要更谨慎**：`risky=true` 时建议措辞更醒目，并默认偏保守
   （识别不了就当拒绝，别误允许）。

---

### 4.3 消息模板速查（渲染规范）

> 占位符用 `{...}`；可选段（如 `description`）缺失时整段省略。
> **IM 友好**：别用终端框线 / ASCII Art（手机端会错行），用纯文本行 +
> 适度 emoji。`header` 为空时去掉 `「」`，直接用 `question`。

#### 通用渲染规则

| 字段 | 规则 |
|---|---|
| `option.description` | 有则 ` — {description}`；无则只显示 `{label}` |
| `header` | 有则作 `「…」` 标签；空则省略，标题用 `question` |
| `multiSelect=true` | 标题尾部加 `（可多选）`，提示行用「多选」变体 |
| 长文本 | `description` 过长截断到约 40 字 + `…` |
| 选项编号 | 从 `1` 开始，必须与回传时「序号 → label」映射一致 |

#### 模板 A — 单题 AskUserQuestion（`questions` 长度 = 1）

```
「请确认」{header}
{question}

1. {options[0].label} — {options[0].description}
2. {options[1].label} — {options[1].description}
3. {options[2].label} — {options[2].description}

回复序号即可（如 2）；也可直接输入你的答案；回复「跳过」放弃。
```

多选题（`multiSelect=true`）标题改为 `「请确认」{header}（可多选）`，
末行替换为：

```
可多选，序号用英文逗号分隔（如 1,3）；也可直接输入答案；回复「跳过」放弃。
```

#### 模板 B — 多题 AskUserQuestion（`questions` 长度 > 1，**逐题发送**）

绝不要把多题塞进一条消息。**每题一条**，带 `({i}/{N})` 进度；用户回一条 →
你回显 → 再发下一题；最后一题答完后才 `POST /permission/respond`（整组一次）。

第 `{i}` 题（`{i}` 从 1 起，`{N}` = 总题数）：

```
「请确认 ({i}/{N})」{header_i}
{question_i}

1. {label} — {description}
2. {label} — {description}
…

回复序号即可（如 2）；也可直接输入你的答案；回复「跳过」放弃。
```

每题答完，先回显再发下一题：

```
已记录：{该题答案}
```

全部答完（在最后一题回显后追加一行）：

```
已记录：{最后一题答案}
已收到你的全部选择，正在继续…
```

任一题用户回「跳过」→ **整个请求作废**，回一句并按 §5 用
`decision:"deny", message:"user did not answer"` 回传：

```
已跳过本次询问。
```

#### 模板 C — 权限确认（`kind="permission"`，普通）

`{动作}` 取 `reason`（优先）；无 `reason` 时用 `「{tool_name}」` + 关键入参
摘要（命令 / 路径等，过长截断）。

```
⚠️ 需要你确认
Agent 想执行：{动作}

回复「确认 / y」执行，回复「取消 / n」拒绝。
```

#### 模板 D — 权限确认（`risky=true`，高危）

```
🚨 高危操作，请确认
Agent 想执行：{动作}
命中风险规则：{matched_rule}

回复「确认 / y」执行，回复「取消 / n」拒绝。
```

#### 辅助提示模板

| 时机 | 文案 |
|---|---|
| 答案回显（每题） | `已记录：{value}` |
| 多题全部完成 | `已收到你的全部选择，正在继续…` |
| 用户跳过 ask_user | `已跳过本次询问。` |
| 用户拒绝 permission | `已取消该操作。` |
| permission 是/否识别失败（再问一次） | `没听清，请回复「确认」或「取消」。` |
| 收到 `permission_timeout` | `这次确认已超时失效，无需再回复。` |
| 最终 `result` 送达 | 直接展示 `data.result`（markdown 原样渲染） |

---

## 5. 第四步：回传应答 `/permission/respond`

```
POST {BASE_URL}/api/agent/permission/respond
Headers: 同发起 run 时（同一 Authorization + x-user-name）
Body (JSON):
  {
    "session_id":   "<当前最新 session_id>",
    "request_id":   "<该 permission_request 的 request_id>",
    "decision":     "allow" | "deny",
    "message":      "<deny 时的说明，可选>",
    "updated_input":{ ... }              // 仅 ask_user 的 allow 需要
  }
成功 → 200 {"status":"ok"}；原 SSE 流随即继续吐事件。
```

各场景 body：

| 场景 | body |
|---|---|
| ask_user 作答 | `{session_id, request_id, decision:"allow", updated_input:{questions:<原 input.questions>, answer:"<见 4.1 文本>"}}` |
| ask_user 跳过 | `{session_id, request_id, decision:"deny", message:"user did not answer"}` |
| permission 允许 | `{session_id, request_id, decision:"allow"}` |
| permission 拒绝 | `{session_id, request_id, decision:"deny", message:"user declined"}` |

---

## 6. permission_timeout 处理

收到：

```json
{ "request_id": "...", "tool_name": "...", "session_id": "..." }
```

含义：该 `request_id` 已超时，**后端已自动按“拒绝（user did not answer）”
处理**。你要做的：

- 清掉本地“待应答”状态；
- 告诉用户「这次确认已超时失效」；
- **不要**再对这个 `request_id` 调 `/permission/respond`（会 404）。

随后流会照常继续，最终给出 `result`。

---

## 7. 错误处理

| HTTP | 含义 | 处理 |
|---|---|---|
| 401 | API key 缺失/错误 | 检查 `Authorization`，不可重试 |
| 403 | 当前身份不是该 run 的 owner | 用发起 run 时**同一** `x-user-name`/key；不可重试 |
| 404 | session 不存在，或 request_id 过期/已用 | 用“最新 session_id”**重试一次**；仍 404 则认为该请求已失效（多半是超时），放弃并提示用户 |

`/permission/respond` 的 404 最常见原因：首个 `result` 后临时 uuid 被换成
真实 session id，而你还在用旧 id。所以第 3 节的“每个事件刷新 session_id +
404 重试一次”一定要实现。

---

## 8. 端到端示例（IM 会话长这样）

**单选：**

```
用户 → vivian： 帮我挑个数据库
vivian → 用户：
  「请确认」数据库选型
  线上主库你倾向哪种？
  1. PostgreSQL — 功能全、生态好
  2. MySQL — 团队最熟
  3. MongoDB — 文档模型灵活
  回复序号即可（如 2）；也可直接输入你的答案；回复「跳过」放弃。
用户 → vivian： 1
vivian → 用户： 已记录：PostgreSQL，继续…
        （渠道 POST respond，updated_input.answer = "- 数据库选型 -> PostgreSQL"）
vivian → 用户： 已为你确定 PostgreSQL，下面给出建表方案……（来自 result）
```

**危险操作：**

```
vivian → 用户：
  ⚠️ 需要你确认
  Agent 想执行：删除目录 dist/（Bash: rm -rf dist）
  命中风险规则：Bash(rm:*)
  回复「确认 / y」执行，回复「取消 / n」拒绝。
用户 → vivian： 取消
        （渠道 POST respond，decision=deny, message="user declined"）
vivian → 用户： 已取消该操作，我换个方式继续……
```

---

## 9. 落地检查清单

- [ ] 请求体带 `enable_permission_feedback`：能按本文应答才传 `true`；
      否则传 `false`/不传（不卡死，但没有问答能力）。
- [ ] SSE：忽略 `: keepalive`；按空行切帧。
- [ ] 每个事件刷新 `session_id`；`stream_init` 取 `stream_id`。
- [ ] `permission_request` 按 `kind` 分流；`request_id` 绑定“下一条用户消息”。
- [ ] ask_user：选项编号化；接受 序号 / 原文 / 自由文本 / 跳过；多题一题一问、本地缓存、一次性回传。
- [ ] ask_user 的 `answer` 严格用 `- <header> -> <label>` 行格式；多选英文逗号；`questions` 原样回传。
- [ ] permission：中英文宽松识别 是/否；危险操作偏保守。
- [ ] `/permission/respond` 用同一身份；404 → 最新 id 重试一次。
- [ ] `permission_timeout`：清状态、提示用户、不回传。
- [ ] 用户侧只展示问题卡片与最终 `result`，其余事件静默。
```
