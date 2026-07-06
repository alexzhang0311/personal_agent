---
name: prod-agent-gateway
description: >
  通过 vivian 网关（SSE 流式接口）向生产环境 AI Agent 发送任务并展示结果。
  仅在用户明确表示要操作生产环境时使用此技能——识别关键词如
  "production"、"prod"、"生产环境"、"生产"、"线上环境"、"线上"、"prod agent"。
  如果用户只是询问一般性的运维或服务器问题，但没有明确指向生产环境，则不要触发。
  一旦生产会话已建立，同一上下文中的后续消息应继续使用此技能。
  此技能自动管理多轮会话。
metadata:
  icon: Server
  icon_color: "#f85149"
---

# 生产环境 Agent 网关

此技能让你通过 vivian 网关与部署在生产环境的 AI Agent 对话。
你用自然语言下达指令，生产 Agent 执行（运维操作、数据查询等），
结果以 SSE `result` 事件的形式返回。

## 首次使用配置

调用脚本前必须确保 **`<当前工作目录>/.prod-agent-gateway/auth`** 文件存在，
文件内容为生产环境的 **Bearer token**（明文、单行、不要带引号、不要带多余换行）。

脚本以**当前工作目录**（`Path.cwd()`）为基准定位 `auth` 文件——
也就是说，每个工作目录下独立维护一份 token，与本技能的安装目录解耦。

如果该文件不存在：

1. 向用户索取生产环境的 Bearer token。
2. 使用以下命令写入（**必须用 `printf`，不要用 `echo`**，避免追加换行；
   也不要把 token 直接写在 shell history 里）：

   ```bash
   mkdir -p ./.prod-agent-gateway
   printf '%s' "$TOKEN" > ./.prod-agent-gateway/auth
   ```

3. 写入成功后再调用脚本。

> 由于 `auth` 文件位于工作目录而非技能安装目录，通过 Skill Hub 重新安装
> 本技能不会影响它。但切换到新的工作目录时需要重新写入。

脚本启动时会自动从 `./.prod-agent-gateway/auth` 读取 token 并放入
`Authorization: Bearer ...` 请求头，Agent 本身永远看不到 token 明文。

## 关键约束 — 同一 session 禁止并发调用

**同一个 `session_id` 在同一时刻只能有一个进行中的调用。**
切勿在一次调用尚未返回时，再发起另一次使用相同 `session_id` 的调用
（包括：并行的 Bash 工具调用、后台任务、循环中未 await 的重复调用等）。

**原因**：远端 vivian 基于 `session_id` 维护会话上下文与状态文件。
并发调用会造成会话状态覆盖、消息顺序错乱、`session.json` 写入竞争，
最终导致**数据损坏（data corruption）**，后续追问将拿到不一致的上下文。

**如何遵守**：
- 对同一 `session_id` 的调用必须**严格串行**：等待上一次调用返回（脚本退出、
  stdout JSON 解析完成、`session.json` 写入完成）后，再发起下一次调用。
- 如果确实需要并行处理多个独立任务，请为每个任务使用**不同的新会话**
  （即不传 `--session-id`，让远端各自创建新 session），而不是共享同一个。
- 永远不要把同一次 `prod_call.py` 调用放到多个并行的 tool call 里。

**脚本会强制 fail-fast**：传入 `--session-id` 时，脚本会用 `fcntl.flock`
在 `./.prod-agent-gateway/<session_id>.lock` 上取**非阻塞**独占锁。
如果同一 session 已有进行中的调用，第二次调用会立即以 **退出码 4** 失败、
不发送 HTTP 请求。Agent 看到 exit 4 后应该等当前调用返回再串行重试，
而不是立刻重发。新会话（不传 `--session-id`）不加锁——它们彼此独立。

## 工作原理

1. 用户下达一条针对生产环境的指令。
2. 通过 python3 运行 `scripts/prod_call.py`，传入用户的 prompt。
3. 脚本读取 `./.prod-agent-gateway/auth`、构建 vivian 风格 payload、
   以 SSE 形式调用网关、流式读取响应。
4. 中间事件（`assistant` / `tool_use` / `tool_result` / `task_*` 等）全部丢弃，
   只留下终态 `result` 事件的 `data` JSON 输出到 stdout。
5. 向用户展示结果。

## 详细流程

### 第一步 — 判断是新会话还是继续上一轮

> ⚠️ **默认行为是新建会话，不是继续。** 只有当本轮请求与上一轮存在**明确的、文本可验证的延续关系**时，才传 `--session-id`。
> 仅仅因为 `session.json` 存在就复用 `session_id` 是**错误**的——会把无关话题塞进同一会话，污染远端 Agent 的上下文。

脚本本身不维护会话状态——会话状态由 Agent 在
`<当前工作目录>/.prod-agent-gateway/session.json` 中管理，结构如下：

```json
{
  "session_id": "6776417b-8339-403d-820c-6a1b0a7e453a",
  "last_used": "2026-03-03T10:30:00Z",
  "topic": "重启 qwen2.5-vl 服务"
}
```

#### 决策流程（按顺序，任一条不满足就**新建**）

1. **用户是否明确指令？**
   - "新会话" / "new session" / "重开" / "重新开始" → **强制新建**（不传 `--session-id`）
   - "继续上次" / "接着刚才" / "用之前那个会话" → **强制继续**（前提：`session.json` 存在）
   - 没有明确指令 → 进入下一步

2. **`session.json` 是否存在？**
   - 不存在 → **新建**
   - 存在 → 进入下一步

3. **`last_used` 是否在 10 分钟以内？**
   - 超过 10 分钟 → **新建**（视为会话过期）
   - 10 分钟内 → 进入下一步

4. **本轮请求与 `topic` 是否同主题？**
   - 主题不同（关键词、对象、领域均无重叠）→ **新建**
   - 同主题 → 进入下一步

5. **请求中是否包含可指认的延续信号？必须命中以下之一：**
   - 指代词回指上轮输出："它"、"这个"、"刚才那个"、"上面的"、"上一条"
   - 顺承/递进词："继续"、"再"、"接着"、"然后"、"那现在"
   - 隐含引用上轮结果（动作作用于上轮发现的对象）：上轮"检查 qwen 服务" + 本轮"重启一下" ✅
   - 明确状态追问："怎么样了"、"好了吗"、"还在跑吗"
   - 命中 → **继续**（传 `--session-id`）
   - 未命中 → **新建**

> **拿不准时一律新建**——污染上下文比多建一个会话代价大得多。
> 不要用"省 token / 省资源 / 保持上下文"作为复用 session 的理由。

#### 反例（不要这么做）

| 上轮 topic | 本轮请求 | 错误判断 | 正确判断 | 原因 |
|------------|----------|----------|----------|------|
| 重启 qwen 服务 | 查一下昨天的 API 报表 | 复用 session_id | 新建 | 主题完全不同 |
| 检查 nginx 日志 | 帮我看下磁盘空间 | 复用 session_id | 新建 | 主题不同（虽然都是运维） |
| 任何 | （`last_used` 是昨天） | 复用 session_id | 新建 | 已过期 |
| 重启 qwen 服务 | 帮我查 redis 服务状态 | 复用 session_id | 新建 | 对象不同（qwen ≠ redis） |
| 重启 qwen 服务 | 现在怎么样了？ | 新建 | 复用 | "怎么样了"是状态追问，明确回指 |
| 检查 qwen 服务状态 | 重启一下 | 新建 | 复用 | "一下"隐含上轮发现的对象 |

### 第二步 — 调用脚本

```bash
python3 <skill-path>/scripts/prod_call.py \
  --prompt "用户的指令内容" \
  [--session-id "之前的session_id"] \
  [--verbose]
```

脚本会：
- 从 `./.prod-agent-gateway/auth` 读取 Bearer token
- 构建 vivian `AgentRunRequest` 形态的 JSON body：
  - 始终包含 `message`（即 prompt）
  - 传入了 `--session-id` 时才包含 `session_id` 字段（否则字段省略 = 新会话）
- 用 `Authorization: Bearer <token>` 调用 SSE 网关
- 流式读取 SSE 事件，捕获终态 `result` 事件
- 将 `result` 事件的 `data` JSON **原样**输出到 stdout
- 成功返回 0，失败返回非 0

#### `--verbose` 中间过程日志

加上 `--verbose` 后，脚本会把所有非 `keepalive` 的 SSE 事件实时（每个事件一行、`flush` 落盘）
写入到 `./.prod-agent-gateway/<session_id>.jsonl`：

- **继续会话**（传了 `--session-id`）：直接 append 到 `<session_id>.jsonl`，
  多轮调用形成同一文件里递增的事件流。
- **新会话**（未传 `--session-id`）：先写到 `_pending.<pid>.jsonl`，
  收到 `result` 事件后自动重命名为 `<返回的 session_id>.jsonl`。

每行格式：

```json
{"ts": "2026-05-11T03:42:17.123Z", "event": "assistant", "data": { ... 原始 SSE payload ... }}
```

事件类型涵盖 `stream_init / assistant / tool_use / tool_result / user_message / system /
task_started / task_progress / task_notification / rate_limit_status / queue_flush /
retry_attempt / retry_exhausted / stream_error / result`。

**何时启用 `--verbose`**：
- 复杂运维任务、用户希望看到 Agent 的中间步骤（"它具体做了什么？"、"展示一下过程"）
- 调试远端 Agent 的失败或异常行为
- 需要回过头查看历史会话每一步执行细节时

**如何把中间过程展示给用户**：
完成后，从 stdout 拿到的 `result` JSON 里取出 `session_id`，
然后读取 `./.prod-agent-gateway/<session_id>.jsonl`（JSON Lines 格式，每行独立解析）。
对用户呈现时建议按时间顺序概述关键 `tool_use` / `tool_result` / `task_*` 事件。

### 第三步 — 解析并展示响应

stdout 上的 JSON 直接来自 vivian 的 `result` SSE 事件，结构形如：

```json
{
  "type": "result",
  "session_id": "6776417b-…",
  "is_error": false,
  "num_turns": 3,
  "duration_ms": 4821,
  "duration_api_ms": 3120,
  "stop_reason": "end_turn",
  "total_cost_usd": 0.0125,
  "usage": { "input_tokens": …, "output_tokens": … },
  "result": "…Agent 的 markdown 回答…"
}
```

关键字段：

| 字段 | 含义 |
|------|------|
| `result` | Agent 的回答，markdown 字符串，可直接渲染 |
| `session_id` | 后续追问需要传回的 Session ID |
| `is_error` | Agent 执行过程中是否遇到错误 |
| `num_turns` | Agent 执行的轮数 |
| `duration_ms` | 总耗时（毫秒） |
| `usage` | token 使用量 |

**向用户展示结果的方式：**

1. 将 `result` 字段作为主要内容展示（markdown，直接渲染）。
2. 附加简短的元信息：
   - 耗时：`duration_ms` 毫秒转换为秒
   - 轮次：`num_turns`
3. 如果 `is_error` 为 `true`，提醒用户并展示错误详情（通常 `result` 中已包含）。
4. **务必**将新的 `session_id` 和简短的话题摘要写入会话状态文件，
   以便后续判断是否继续会话。

### 第四步 — 更新会话状态

调用成功后，写入会话状态（与 `auth` 文件位于同一目录）：

```bash
mkdir -p ./.prod-agent-gateway
cat > ./.prod-agent-gateway/session.json << 'EOF'
{
  "session_id": "<从响应中提取>",
  "last_used": "<当前 ISO 时间戳>",
  "topic": "<用户请求的简短摘要>"
}
EOF
```

## 错误处理

- **`auth` 文件缺失或为空**：脚本以退出码 1 失败。先按"首次使用配置"
  小节在当前工作目录下写入 `./.prod-agent-gateway/auth`，再重试。
- **网络错误 / SSE 读取中断**：退出码 2。告知用户生产网关无法访问。
- **API 返回非 2xx**：退出码 3。展示 HTTP 状态码和响应体（stderr 内容）。
- **SSE 流结束但未收到 `result` 事件**：退出码 3。可能远端异常。
- **收到 `stream_error` 或 `retry_exhausted` 事件**：退出码 3。
  脚本会把该事件的 payload 写到 stderr。
- **`is_error` 为 true**：远端 Agent 执行了但遇到问题。展示 `result` 内容
  （通常包含错误详情），建议用户换个方式描述。
- **退出码 4（并发冲突）**：同一 `session_id` 已有其他进行中的调用。脚本不会
  发送 HTTP 请求，stderr 会指出冲突的 lock 文件路径。等当前调用结束后**串行重试**，
  不要立刻重发——并发会损坏远端 agent 状态。
- **超时**：复杂运维任务可能需要 2 分钟以上。脚本设置了 **5 分钟整体硬超时**
  （wall-clock，按每个 SSE 事件检查累计耗时强制中止，退出码 2），
  与 socket 级超时叠加。如果超时，告知用户并建议拆分为更小的步骤。

## 安全说明

- Bearer token 是敏感生产凭据：**不要**在响应中回显其内容、**不要**提交到
  代码仓库、**不要**写入日志。脚本只把它放在 `Authorization` 请求头里发往
  网关，不会打印到 stdout/stderr。
- 生产 Agent 拥有对生产基础设施的真实访问权限。执行破坏性操作（重启、删除、缩容）前，
  必须先向用户确认："即将在生产环境执行[操作]，是否继续？"，
  只有在用户明确确认后才调用 API。
- 只读操作（状态检查、查看日志、数据查询）无需确认，直接执行。

## 示例

**用户**："帮我检查一下生产环境 qwen 服务的状态"

→ 新话题，不传 session_id：
```bash
python3 <skill-path>/scripts/prod_call.py \
  --prompt "检查 qwen2.5-vl-72b-instruct 服务的运行状态，包括容器状态和接口可用性"
```

**用户**（追问）："重启一下这个服务"

→ 继续上一轮会话。读取会话状态，先向用户确认（破坏性操作），然后：
```bash
python3 <skill-path>/scripts/prod_call.py \
  --prompt "重启 qwen2.5-vl-72b-instruct 服务" \
  --session-id "6776417b-..."
```

**用户**："查一下线上昨天的 API 调用量报表"

→ 新话题，只读操作，无需确认：
```bash
python3 <skill-path>/scripts/prod_call.py \
  --prompt "查询昨天的 API 调用量统计报表"
```
