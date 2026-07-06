from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json
import time

from learning.mini_vivian.agent_task import task_store


app = FastAPI(title="Mini Vivian")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


class TaskRequest(BaseModel):
    prompt: str


@app.get("/health")
def health():
    return {"status": "ok", "app": "mini-vivian"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    return ChatResponse(reply=f"你说的是：{request.message}")


@app.post("/tasks")
def create_task(request: TaskRequest):
    task = task_store.create(request.prompt)
    return task.to_dict()


@app.get("/tasks")
def list_tasks():
    return [task.to_dict() for task in task_store.list()]


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task.to_dict()


def sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/tasks/{task_id}/stream")
def stream_task(task_id: str):
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    async def events():
        async for event in task.run():
            task_store.save()
            yield sse_event(event)

    return StreamingResponse(events(), media_type="text/event-stream")


@app.get("/chat/stream")
def chat_stream(message: str = "hello"):
    def events():
        steps = [
            {"type": "start", "text": "任务开始"},
            {"type": "thinking", "text": f"正在分析：{message}"},
            {"type": "tool", "name": "fake_search", "text": "模拟调用工具"},
            {"type": "message", "text": f"处理完成：{message}"},
            {"type": "done", "text": "任务结束"},
        ]

        for step in steps:
            yield sse_event(step)
            time.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream")


@app.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    await ws.accept()
    await ws.send_json({"type": "system", "text": "WebSocket 已连接"})

    try:
        while True:
            message = await ws.receive_text()
            await ws.send_json({"type": "user", "text": message})
            await ws.send_json({"type": "assistant", "text": f"后端收到：{message}"})
    except WebSocketDisconnect:
        print("WebSocket disconnected")


@app.websocket("/ws/agent-task")
async def websocket_agent_task(ws: WebSocket):
    await ws.accept()

    try:
        start_message = await ws.receive_text()
        await ws.send_json({"type": "start", "text": f"任务开始：{start_message}"})
        await asyncio.sleep(1)

        await ws.send_json({"type": "thinking", "text": "我准备执行一个有风险的操作"})
        await asyncio.sleep(1)

        await ws.send_json({
            "type": "permission_request",
            "text": "是否允许我继续执行模拟删除操作？请回复 approve 或 reject",
        })

        answer = await ws.receive_text()
        if answer != "approve":
            await ws.send_json({"type": "rejected", "text": "用户拒绝，任务停止"})
            await ws.close()
            return

        await ws.send_json({"type": "approved", "text": "用户同意，继续执行"})
        await asyncio.sleep(1)
        await ws.send_json({"type": "tool", "text": "正在执行 fake_delete_file"})
        await asyncio.sleep(1)
        await ws.send_json({"type": "done", "text": "任务完成"})
        await ws.close()
    except WebSocketDisconnect:
        print("Agent task websocket disconnected")
