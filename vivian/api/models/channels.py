from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# Access policy for 1:1 (single) chats. Group chats are always open — anyone in
# the group can @-trigger the bot — so this only governs direct messages.
SingleChatAccessMode = Literal["all", "allowed_user_ids", "private"]


# --- Channel config (stored in .vivian.user.yml under channels.wecom) ---

class WeComChannelConfig(BaseModel):
    enabled: bool = False
    bot_id: str = ""
    secret: str = ""
    ws_proxy_url: str = ""             # e.g. "ws://127.0.0.1:9443" — local proxy server address
    allowed_user_ids: list[str] = []
    # Who may talk to the bot in a 1:1 (single) chat. Group chats ignore this and
    # are always open. Default "private" locks each bot to its owner.
    #   "all"              → anyone who can DM the bot
    #   "allowed_user_ids" → only senders in `allowed_user_ids` (empty list = allow all)
    #   "private"          → only the owner (WeCom userid == this Vivian account username)
    single_chat_access_mode: SingleChatAccessMode = "private"
    welcome_message: str = "你好！我是 AI 助手，有什么可以帮你的？"
    reject_message: str = "抱歉，您未被授权使用此机器人。"
    model: str | None = None
    max_queue_size: int = 3
    idle_session_timeout_minutes: int = 60
    # When True, AskUserQuestion and admin risky-tool confirms block the run
    # and the user answers via WeCom interactive cards / text replies. Same
    # name as AgentRunRequest.enable_permission_feedback (models/agent.py) for
    # consistency; set False to restore the unattended behaviour (questions
    # stripped, risky tools auto-denied) per bot.
    enable_permission_feedback: bool = True
    # Per-question timeout (seconds) for the user to answer before the daemon
    # default-denies and moves on. Reset whenever the user answers a question.
    feedback_timeout_seconds: int = 180


# --- OpenClaw channel config ---

class OpenClawAgentEntry(BaseModel):
    id: str
    description: str = ""


class OpenClawChannelConfig(BaseModel):
    enabled: bool = False
    gateway_url: str = ""                    # e.g. "ws://localhost:18789"
    auth_token: str = ""                     # shared token for operator auth
    default_agent: str = "main"              # agent_id when none specified
    max_turns: int = 5                       # max delegation turns per cycle
    timeout_seconds: int = 120               # per-delegation timeout
    agents: list[OpenClawAgentEntry] = []    # available agents for prompt injection


# --- API request/response models ---

class UpdateWeComConfigRequest(BaseModel):
    enabled: bool | None = None
    bot_id: str | None = None
    secret: str | None = None
    ws_proxy_url: str | None = None
    allowed_user_ids: list[str] | None = None
    single_chat_access_mode: SingleChatAccessMode | None = None
    welcome_message: str | None = None
    reject_message: str | None = None
    model: str | None = None
    max_queue_size: int | None = None
    idle_session_timeout_minutes: int | None = None
    enable_permission_feedback: bool | None = None
    feedback_timeout_seconds: int | None = None


class WeComConfigResponse(BaseModel):
    enabled: bool
    bot_id: str
    secret_masked: str
    ws_proxy_url: str
    allowed_user_ids: list[str]
    single_chat_access_mode: SingleChatAccessMode
    welcome_message: str
    reject_message: str
    model: str | None
    max_queue_size: int
    idle_session_timeout_minutes: int
    enable_permission_feedback: bool
    feedback_timeout_seconds: int


class UpdateOpenClawConfigRequest(BaseModel):
    enabled: bool | None = None
    gateway_url: str | None = None
    auth_token: str | None = None
    default_agent: str | None = None
    max_turns: int | None = None
    timeout_seconds: int | None = None
    agents: list[OpenClawAgentEntry] | None = None


class OpenClawConfigResponse(BaseModel):
    enabled: bool
    gateway_url: str
    auth_token_masked: str
    default_agent: str
    max_turns: int
    timeout_seconds: int
    agents: list[OpenClawAgentEntry]


class OpenClawConnectionStatusResponse(BaseModel):
    status: Literal["disconnected", "connecting", "connected", "error"]
    connected_at: str | None = None
    error_message: str | None = None
    active_delegations: int = 0


class ActiveSessionInfo(BaseModel):
    session_id: str
    wecom_user_id: str
    last_activity: str | None = None


class ConnectionStatusResponse(BaseModel):
    status: Literal["disconnected", "connecting", "connected", "auth_failed", "error"]
    connected_at: str | None = None
    error_message: str | None = None
    active_sessions: int = 0
    messages_handled: int = 0
    session_details: list[ActiveSessionInfo] = []


class ChannelHealthResponse(BaseModel):
    healthy: bool
    last_heartbeat: str | None = None
    connections: dict[str, ConnectionStatusResponse] = {}
