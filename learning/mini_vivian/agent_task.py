from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class AgentEvent:
    type: str
    text: str


@dataclass
class AgentTask:
    prompt: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "pending"
    events: list[AgentEvent] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "prompt": self.prompt,
            "status": self.status,
            "events": [asdict(event) for event in self.events],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AgentTask":
        return cls(
            id=data["id"],
            prompt=data["prompt"],
            status=data["status"],
            events=[AgentEvent(**event) for event in data.get("events", [])],
        )

    def add_event(self, event_type: str, text: str) -> dict:
        event = AgentEvent(type=event_type, text=text)
        self.events.append(event)
        return {
            "task_id": self.id,
            "status": self.status,
            **asdict(event),
        }

    async def run(self):
        if self.status != "pending":
            yield self.add_event("error", "这个任务已经运行过了")
            return

        self.status = "running"
        yield self.add_event("start", f"开始执行任务：{self.prompt}")

        await asyncio.sleep(1)
        yield self.add_event("thinking", "正在分析任务需要哪些步骤")

        await asyncio.sleep(1)
        yield self.add_event("tool", "模拟读取项目文件")

        await asyncio.sleep(1)
        self.status = "completed"
        yield self.add_event("done", "任务执行完成")


class TaskStore:
    def __init__(self, path: Path):
        self.path = path
        self.tasks: dict[str, AgentTask] = {}
        self.load()

    def create(self, prompt: str) -> AgentTask:
        task = AgentTask(prompt=prompt)
        self.tasks[task.id] = task
        self.save()
        return task

    def get(self, task_id: str) -> AgentTask | None:
        return self.tasks.get(task_id)

    def list(self) -> list[AgentTask]:
        return list(self.tasks.values())

    def save(self) -> None:
        data = [task.to_dict() for task in self.tasks.values()]
        self.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def load(self) -> None:
        if not self.path.exists():
            return

        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.tasks = {
            item["id"]: AgentTask.from_dict(item)
            for item in data
        }


task_store = TaskStore(Path(__file__).with_name("tasks.json"))
