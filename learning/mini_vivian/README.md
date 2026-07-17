# Mini Vivian 学习项目

这是 Vivian 的极简学习版。我们会从一个很小的 FastAPI 服务开始，逐步加上：

1. 普通 API
2. 前后端 JSON 交互
3. SSE 流式输出
4. WebSocket 双向通信
5. Agent 任务事件
6. 权限确认
7. 前端状态管理
8. 历史、日志、审计
9. 调度器、MCP、Skills、Hooks

## 第 1 课：普通 API

当前文件：

- `app.py`

它只有两个接口：

```text
GET  /health
POST /chat
```

这对应 Vivian 里的：

```text
vivian/api/main.py
vivian/api/routers/*.py
vivian/api/models/*.py
```

## 怎么运行

在项目根目录运行：

```powershell
python -m uvicorn learning.mini_vivian.app:app --reload --port 9000
```

然后打开：

```text
http://127.0.0.1:9000/health
http://127.0.0.1:9000/docs
```

## 你要先理解的 3 件事

### 1. `app = FastAPI()`

这相当于创建一个后端应用。

Vivian 真实项目里对应：

```python
app = create_app()
```

在 `vivian/api/main.py` 里。

### 2. `@app.get("/health")`

这表示浏览器访问 `/health` 时，会执行下面这个 Python 函数。

```python
@app.get("/health")
def health():
    return {"status": "ok"}
```

你可以先把它理解成：

```text
URL -> Python 函数 -> JSON 返回值
```

### 3. `BaseModel`

`ChatRequest` 描述前端传给后端的数据长什么样。

```python
class ChatRequest(BaseModel):
    message: str
```

所以前端必须传：

```json
{
  "message": "hello"
}
```

这就是 Vivian 里 `vivian/api/models` 那一堆文件的简化版。

## 试一试

启动后，可以用 PowerShell 测试：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:9000/health
```

再测试聊天：

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:9000/chat `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"message":"hello"}'
```

你应该看到：

```json
{
  "reply": "你说的是：hello"
}
```

## 第 2 课：前后端 JSON 交互

当前新增文件：

- `web.html`

它是一个不用 React 的最小前端页面，核心只有这一句：

```js
fetch('http://127.0.0.1:9000/chat')
```

这对应 Vivian 里的：

```text
vivian/web/src/api/client.js
vivian/web/src/api/*.js
vivian/web/src/components/chat/ChatInput.jsx
```

### 怎么打开

先保持后端运行：

```powershell
D:\vivian\.venv\Scripts\python.exe -m uvicorn learning.mini_vivian.app:app --reload --port 9000
```

然后直接用浏览器打开：

```text
D:\vivian\learning\mini_vivian\web.html
```

输入一句话，点击发送，你会看到后端返回的 JSON。

### 这一课你要理解

前端调用后端并不神秘，本质就是：

```text
把 JS 对象变成 JSON 字符串
        ↓
POST 到后端 URL
        ↓
后端 Python 函数处理
        ↓
返回 JSON
        ↓
前端把 JSON 显示到页面
```

对应代码：

```js
body: JSON.stringify({
  message: messageInput.value,
})
```

后端收到后，会变成：

```python
request.message
```

所以 Vivian 里的前后端交互，也可以先简化成：

```text
React 组件
  -> src/api 里的 fetch
  -> FastAPI router
  -> service 业务逻辑
  -> JSON 返回
```

### 如果看到 `OPTIONS /chat 405`

这是浏览器的 CORS 预检请求。

因为 `web.html` 是从 `file://` 打开的，但后端在 `http://127.0.0.1:9000`，浏览器会先问后端：

```text
我这个页面能不能跨来源调用你？
```

这个“先问一下”的请求方法就是 `OPTIONS`。

所以 `app.py` 里加了：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Vivian 真实项目里也有类似设置，在 `vivian/api/main.py` 的 `create_app()` 里。

## 第 3 课：SSE 流式输出

当前新增内容：

- `app.py` 里的 `GET /chat/stream`
- `web_sse.html`

SSE 的核心是：后端不是一次性 `return`，而是不断 `yield`。

```python
def events():
    yield "data: 第一条\n\n"
    yield "data: 第二条\n\n"
```

浏览器用 `EventSource` 接收：

```js
const source = new EventSource('http://127.0.0.1:9000/chat/stream')
source.onmessage = (event) => {
  console.log(event.data)
}
```

### 怎么打开

先保持后端运行：

```powershell
D:\vivian\.venv\Scripts\python.exe -m uvicorn learning.mini_vivian.app:app --reload --port 9000
```

然后打开：

```text
D:\vivian\learning\mini_vivian\web_sse.html
```

点击“开始流式任务”，你会看到事件一秒一条出现。

### 这一课对应 Vivian 哪些地方

```text
Mini Vivian:
GET /chat/stream
StreamingResponse
EventSource

Vivian:
vivian/api/routers/agent.py
vivian/api/services/claude_sdk/service.py
vivian/web/src/api/sse.js
vivian/web/src/hooks/useSSE.js
vivian/web/src/components/chat/MessageList.jsx
vivian/web/src/components/layout/CanvasPanel.jsx
```

### 你要理解的模型

```text
普通 HTTP：
前端请求 -> 后端处理很久 -> 一次性返回结果

SSE：
前端请求 -> 后端开始处理 -> 处理过程中不断返回事件
```

Vivian 的 Agent 输出，本质就是一串事件：

```text
start
thinking
tool_call
assistant_message
permission_request
done
```

我们现在的 mini 版本用的是：

```text
start
thinking
tool
message
done
```

## 第 4 课：WebSocket 双向通信

当前新增内容：

- `app.py` 里的 `WebSocket /ws/chat`
- `web_ws.html`

SSE 是单向的：

```text
后端 -> 前端
```

WebSocket 是双向的：

```text
前端 <-> 后端
```

### 后端核心代码

```python
@app.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    await ws.accept()

    while True:
        message = await ws.receive_text()
        await ws.send_json({"type": "assistant", "text": f"后端收到：{message}"})
```

### 前端核心代码

```js
socket = new WebSocket('ws://127.0.0.1:9000/ws/chat')

socket.onmessage = (event) => {
  const data = JSON.parse(event.data)
  addMessage(data)
}

socket.send(messageInput.value)
```

### 怎么打开

先保持后端运行：

```powershell
D:\vivian\.venv\Scripts\python.exe -m uvicorn learning.mini_vivian.app:app --reload --port 9000
```

然后打开：

```text
D:\vivian\learning\mini_vivian\web_ws.html
```

点击“连接”，再点击“发送”。

### 这一课对应 Vivian 哪些地方

```text
Mini Vivian:
/ws/chat
web_ws.html

Vivian:
/api/agent/ws/run
/api/pty/ws
vivian/api/routers/agent.py
vivian/api/routers/pty.py
vivian/web/src/api/terminal.js
vivian/web/src/components/terminal/TerminalSession.jsx
```

### 你要理解的模型

普通 HTTP 像发邮件：

```text
发一次请求，收一次回复
```

SSE 像看直播：

```text
连接一次，后端一直播
```

WebSocket 像打电话：

```text
连接保持着，双方都可以随时说话
```

## Windows 上推荐的稳定启动方式

如果使用 `uvicorn --reload` 后看到类似错误：

```text
Accept failed on a socket
OSError: [WinError 87] 参数错误
```

这是 Windows + uvicorn 自动重载 + asyncio socket 监听之间的兼容问题，不是业务代码错误。

学习这个 mini 项目时，推荐用稳定启动脚本：

```powershell
D:\vivian\.venv\Scripts\python.exe learning\mini_vivian\run.py
```

以后每次改了 `app.py`，手动 `Ctrl+C` 后重新运行这条命令即可。

## 第 4 课补充：更适合理解 Vivian 的 WebSocket 例子

之前的 `web_ws.html` 只是回声聊天，确实容易让人觉得普通 HTTP `return` 也能做到。

更像 Vivian 的例子是：

```text
前端启动任务
  ↓
后端开始运行
  ↓
后端运行到一半，主动发 permission_request
  ↓
前端点击同意/拒绝
  ↓
后端在同一条 WebSocket 连接里收到答复
  ↓
任务继续或停止
```

新增文件：

- `web_ws_agent.html`
- `app.py` 里的 `/ws/agent-task`

这个例子展示了 WebSocket 和普通 `return` 的真正区别：

```text
return：后端只能在一次请求结束时返回一次主要结果
send_json：后端可以在长连接里发很多次，中间还可以等待前端回复
```

### 怎么打开

启动后端：

```powershell
D:\vivian\.venv\Scripts\python.exe learning\mini_vivian\run.py
```

打开：

```text
D:\vivian\learning\mini_vivian\web_ws_agent.html
```

点击“启动任务”，等出现 `permission_request` 后，再点“同意”或“拒绝”。

### 对应 Vivian

```text
Mini:
/ws/agent-task
permission_request
approve / reject

Vivian:
vivian/api/services/claude_sdk/permission_coordinator.py
vivian/api/routers/agent.py
vivian/web/src/components/chat/PermissionRequestCard.jsx
```

## 第 5 课：把一次聊天变成 AgentTask

这一课把任务逻辑从 FastAPI 接口中拆到了 `agent_task.py`。

一个任务包含：

```text
id       唯一编号
prompt   用户要求
status   pending -> running -> completed
events   运行过程中产生的事件历史
```

### 操作步骤

1. 重启学习服务。
2. 打开 `http://127.0.0.1:9000/docs`。
3. 执行 `POST /tasks`，请求内容填写：

```json
{
  "prompt": "帮我分析这个项目"
}
```

4. 从响应中复制 `id`。
5. 在浏览器打开 `http://127.0.0.1:9000/tasks/这里替换成id/stream`，观察 SSE 事件。
6. 回到 `/docs` 执行 `GET /tasks/{task_id}`，查看最终状态和事件历史。

### 这次拆分为什么重要

```text
AgentTask       负责业务：任务状态、执行步骤、事件历史
TaskStore       负责保存和查找任务
FastAPI         负责接收 HTTP 请求
SSE             负责把任务事件传给前端
```

`TaskStore` 现在只是内存字典，所以重启服务后任务会消失。后面接入数据库时，替换的是存储层，`AgentTask` 的核心思路不需要推倒重来。

## 第 6 课：把任务保存到磁盘

上一课的 `TaskStore` 只有一个内存字典：

```python
self.tasks = {}
```

进程停止后，内存会被系统回收，所以任务也会消失。这一课新增
`tasks.json`，在两个时间点同步内存和磁盘：

```text
创建 TaskStore  -> load() -> 从 tasks.json 恢复到内存
任务发生变化    -> save() -> 从内存写入 tasks.json
```

### 新增内容

- `AgentTask.from_dict()`：把字典还原成 `AgentTask`
- `TaskStore.save()`：把所有任务写入 JSON 文件
- `TaskStore.load()`：启动时从 JSON 文件读取任务
- `TaskStore.list()`：返回全部任务
- `GET /tasks`：查看任务历史列表

`to_dict()` 和 `from_dict()` 是方向相反的一对操作：

```text
AgentTask --to_dict()--> dict --json.dumps()--> JSON 文本
AgentTask <--from_dict()-- dict <--json.loads()-- JSON 文本
```

### 试一试

1. 启动服务，通过 `POST /tasks` 创建任务。
2. 打开 `/tasks/{task_id}/stream`，让任务执行完成。
3. 打开 `GET /tasks`，确认任务状态为 `completed`。
4. 停止并重新启动服务。
5. 再次打开 `GET /tasks`，确认之前的任务仍然存在。

### 为什么在 SSE 循环中调用 `save()`

`task.run()` 每次 `yield` 前都可能修改状态或增加事件。应用层收到新事件后调用：

```python
task_store.save()
```

这样磁盘里的快照会跟着任务进度更新。

这一课保存的是任务的**当前快照**。下一课的日志和审计关注的是
“按时间顺序发生过哪些事情”，用途不同。
