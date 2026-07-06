# Vivian (TCTP-vivian) — Comprehensive Project Analysis Report

> Analysis date: 2026-06-11 · Codebase: `vivian-agent-sdk-v2` (claude-agent-sdk 0.1.81, FastAPI backend + React 18 WebUI)
> Scope: full source review of `vivian/api` (~80 Python modules), `vivian/web` (~140 JSX modules), `docs/`, `tests/`, deployment scripts, plus public-source research on OpenClaw and Hermes.

---

## 1. Project Purpose

**Vivian is a self-hosted, multi-user enterprise control plane for Claude Code.** It wraps the Claude Agent SDK (which itself drives the Claude Code CLI as a subprocess) in a FastAPI service and exposes the full Claude Code agent — tools, skills, hooks, MCP, subagents, sessions — through three faces that Claude Code itself does not have:

1. **A Web UI** (React 18 + Vite + Zustand, GitHub-Dark "industrial minimalism" design system) — chat with live SSE/WebSocket streaming, a task-progress Canvas (task tree, subagent inspector, todo inspector, plan review, file ops, browser debug), session management (resume / fork / rewind-to-checkpoint / rename / tag), and full self-service management panels for Skills, MCP servers, Hooks, Subagents, and the Scheduler.
2. **IM channels** — first-class WeCom (企业微信) integration via a standalone channels daemon (`aibot` WebSocket SDK), with a carefully engineered **text-only synchronous feedback protocol** so IM users can answer `AskUserQuestion` prompts and approve risky operations mid-run (documented in `docs/im-channel-permission-zh.md`), plus an **OpenClaw bridge** (reverse-engineered Ed25519 v3 gateway protocol) that lets Vivian delegate tasks to OpenClaw-managed agents.
3. **An autonomous scheduler** — a standalone APScheduler daemon running cron / interval / one-shot jobs (agent runs, HTTP calls, user scripts, tool-retry jobs) with run history, plus an in-process MCP server (`vivian_scheduler`) so **the agent can schedule itself** from a conversation.

Around that core, Vivian adds the things an enterprise must have before letting an autonomous agent loose on employees' behalf: JWT/API-key multi-user auth with an admin role, per-user LLM gateway credentials (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` per user), audit logging with charts, an admin-configurable **risky-tool confirmation list** that forces human approval even in `bypassPermissions` mode, PII masking of streamed output, a dangerous-bash blocking hook, Prometheus metrics, and a fully **offline/air-gapped deployment pipeline** (`pack.sh` bundles Python wheels for glibc 2.17 + an npm offline cache + local fonts).

In one sentence: **"Claude Code as the engine, Vivian as the enterprise chassis"** — identity, governance, channels, scheduling, observability, and deployment for environments (Chinese enterprise intranets in particular) where neither claude.ai nor stock Claude Code can be used directly.

---

## 2. Core Architecture — Design Detail & Design Purpose

### 2.1 Process topology: three cooperating daemons

```
                       ┌────────────────────────────────────────────┐
                       │  bin/server.sh  (start/stop/status, PIDs)  │
                       └────────────────────────────────────────────┘
                                │                │               │
        ┌───────────────────────┴──┐   ┌─────────┴────────┐   ┌──┴──────────────────┐
        │ API Server (uvicorn)     │   │ Scheduler daemon │   │ Channels daemon     │
        │ FastAPI: 17 routers      │   │ APScheduler      │   │ WeCom WS (aibot)    │
        │ SSE / WS streaming       │   │ cron/interval/   │   │ OpenClaw bridge     │
        │ Web static (web/dist)    │   │ date triggers    │   │ msg queues/sessions │
        └───────────┬──────────────┘   └─────────┬────────┘   └──┬──────────────────┘
                    │      file-based IPC: commands dir, heartbeat files,
                    │      JSONL job store / run history / sessions / audit
                    ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ services/claude_sdk  — the engine room                          │
        │  options.py   → per-user ClaudeAgentOptions builder             │
        │  service.py   → agent_run / agent_run_events / agent_run_stream │
        │  permission_coordinator.py → human-in-the-loop futures          │
        │  retry.py + session_heal.py → synthetic-error retry & healing   │
        │      │ spawns                                                   │
        │      ▼                                                          │
        │  Claude Code CLI subprocess (per run) → enterprise LLM gateway  │
        └─────────────────────────────────────────────────────────────────┘
```

**Design purpose:** the channels daemon holds long-lived WebSocket connections and the scheduler holds timers — both must survive API restarts/redeploys, so they are separate OS processes supervised by `server.sh` with heartbeat files. All three share state through `$VIVIAN_HOME/vivian` (JSONL/YAML files), which keeps the deployment dependency-free: no database, no Redis, no message broker — a deliberate fit for offline intranet servers.

### 2.2 The engine room: `services/claude_sdk`

- **`options.py` — per-user option assembly.** Every run rebuilds `ClaudeAgentOptions` from: the user's own gateway credentials (per-user env file), per-user workspace `cwd`, model override (incl. **sticky vision-model routing** — image messages switch to a configured multimodal model and the session stays pinned to it), the per-user **skill allowlist** (`options.skills`), admin runtime config (CLI path override — with a clever Linux `memfd_create` in-memory shebang wrapper for node scripts, appended system prompt, plugins), and three **in-process MCP servers** injected per run: `vivian_scheduler` (self-scheduling), `vivian_File` (FileCanvas registration so produced files appear in the WebUI Canvas), and `vivian_openclaw` (delegation). `BUILTIN_DISALLOWED_TOOLS` strips `WebFetch`/`WebSearch`/`Cron*`/worktree tools — consistent with a no-public-internet enterprise gateway environment.
- **`service.py` — three run modes over one core.** `agent_run` (synchronous REST), `agent_run_events` (callback-driven core used by WS, channels daemon, and scheduler), and `agent_run_stream` (SSE generator). The core pumps SDK messages through a queue, emits keepalives every 2 s, tracks the CLI-assigned session id from `system.init` (critical for retries), audits every tool use, and supports **mid-turn user message injection**: queued messages are flushed at clean tool-result boundaries via `client.interrupt()` — a chat-native feature stock Claude Code only has in its own TUI.
- **`permission_coordinator.py` — the human-in-the-loop kernel.** `can_use_tool` callbacks become `permission_request` events carrying `request_id`/`kind`/`risky`/`matched_rule`; an `asyncio.Future` parks the agent until `/api/agent/permission/respond` resolves it (with owner authorization), or a configurable timeout (600 s default) denies it. A registry remaps coordinator keys when the CLI swaps the temporary uuid for the real session id. The unified callback routes: `AskUserQuestion` → always blocks for an answer; explicit permission modes → everything blocks; `bypassPermissions` + admin risky list → only matched tools block; otherwise auto-allow (still required as a callback because the CLI internally protects `.claude/{skills,commands,agents}/**`).
- **`retry.py` + `session_heal.py` — reliability surgery.** The CLI sometimes ends a turn with a *synthetic error message* after exhausting its own retries; Vivian detects these, **rotates `options.resume` to the live CLI session id**, heals orphan `tool_use` records in the session JSONL, strips the synthetic rows so the model never sees them, and retries with backoff — preserving all work done in the failed attempt. The channels daemon adds one more guard: a stale resume id fails → clear and rerun fresh. This layer is the single most production-hardened part of the codebase.

### 2.3 The IM feedback protocol (the project's most original design)

IM input is plain text — no buttons, no forms. Vivian's protocol (spec'd for any channel implementer in `docs/im-channel-permission-zh.md`) makes synchronous agent↔human dialogue work anyway:

- Options are **numbered**; users answer `2`, or option text, or free text, or「跳过」.
- Multi-question prompts are sent **one question per message**, answers cached channel-side, then submitted as **one** `respond` call.
- Answers are serialized in a locked line format (`- <header> -> <label>`) which `service._askuser_answers_map()` re-parses into the exact `{question_text: answer}` map the CLI's `AskUserQuestion` schema expects — fixing a real CLI footgun where a free-text `answer` field is silently dropped and the model hallucinates a choice.
- `enable_permission_feedback=false` is the **graceful degradation path**: the server strips `AskUserQuestion` from the toolset entirely and denies gated tools by default, so a channel that hasn't implemented the protocol can never hang a connection.
- The WeCom daemon raises the coordinator timeout to 86,400 s and runs its own per-question timers, intercepts the asker's next message as the answer (ignoring non-askers), offers `/reset` as a universal escape hatch, and switches to proactive message delivery once a human exchange makes the original reply stream stale.

This is a complete, thought-through interaction design — the kind of edge-case inventory (timeout semantics, 404-retry on session remap, multi-select comma rules, conservative default on unrecognized yes/no) that only comes from running it in production.

### 2.4 Governance & extensibility surfaces

- **Hooks:** a decorator registry of built-in hooks (`block-dangerous-bash`, `audit-tool-use`, `lint-on-write`, `notify-slack`, `retry-failed-tools`, `require-permission-risky-tools`) plus admin-managed custom hooks, with a WebUI for config, testing, and logs.
- **Skills:** global/project levels, a central **Skill Hub** for upload→review→deliver distribution, bundled seeds re-synced at boot (Anthropic office skills docx/xlsx/pptx/pdf plus in-house ones: `itsm-workflow-query`, `ops-knowledge`, `prod-agent-gateway`, `rota-schedule`, `mermaid-visualizer`, `skill-creator` with an eval harness…).
- **MCP:** CRUD + validation + capability probing per user/level, `--strict-mcp-config` discipline so the admin's intent always wins over `.mcp.json` discovery.
- **Plugins:** a server-side plugin manager (e.g. `enterprise_user_info` injects employee context into the system prompt per run).
- **Observability:** Prometheus multiprocess metrics with a written ADR justifying cardinality choices; loguru rotating/compressed logs split by concern (access/server/app/scheduler/channels); audit JSONL with admin analytics charts; scalar API docs.

---

## 3. Why & How — the reasoning chain behind the design

| Constraint (why) | Design response (how) |
|---|---|
| Employees can't reach Anthropic directly; LLM access goes through an internal gateway with per-user tokens | Per-user env files (`ANTHROPIC_BASE_URL`/`AUTH_TOKEN`), validated before every run; model list served from config; `NO_PROXY` handling for IP-allowlisted gateways |
| Servers are air-gapped / behind strict egress | `pack.sh` offline tarball (manylinux wheels, npm offline cache, local fonts); `WebFetch`/`WebSearch` disallowed; forward-proxy CONNECT monkey-patch for the WeCom SDK |
| Non-developers must be able to use the agent | WebUI chat + Canvas; WeCom channel where the agent lives inside the chat app employees already use |
| Compliance: who did what, with what tool, at what cost | Audit JSONL on every tool use / skill invocation / run completion (token usage), admin charts, access logs, Prometheus counters |
| Autonomous agents are dangerous by default | Layered safety: dangerous-bash regex hook (deny), admin risky-tool list → synchronous human confirmation even in bypass mode, PII masking of streamed output, permission timeouts defaulting to deny, audit of everything |
| The CLI/gateway combo fails in ugly ways (synthetic errors, dropped tool_use, session swaps) | The retry/heal/strip/resume-rotation layer in §2.2 — failures recover *with work preserved* |
| One team's agent platform should compose with others | OpenClaw bridge: Vivian's agent can `delegate_to_openclaw(...)` specialist agents over a persistent Ed25519-authenticated WebSocket |
| Ops automation must run unattended 7×24 | Scheduler daemon + agent-facing scheduler MCP tools (with prompt-engineering guardrails distinguishing "schedule a job" from "delegate to a subagent now") |

The consistent meta-decision: **never re-implement what Claude Code already does** (agent loop, tools, session JSONL, skills, hooks, MCP, checkpointing) — instead, wrap it, govern it, and transport it. Where the CLI has gaps (AskUserQuestion answer schema, synthetic errors, session-id swaps), patch around them at the boundary rather than forking.

---

## 4. Trade-offs & Benefits

### 4.1 Build on the Claude Agent SDK / CLI subprocess

- ✅ **Benefit:** full Claude Code fidelity for free — every CLI upgrade brings new tools, the session format, file checkpointing/rewind, skills/plugins ecosystem compatibility. Tiny engine-room code (~2.5 k lines) for an enormous capability surface.
- ⚠️ **Cost:** process-per-run overhead; version coupling (SDK pinned at 0.1.81; CLI path override + statsig flag override in `server.sh` betray sensitivity to CLI internals); the heal/strip logic does **surgery on the CLI's private JSONL session format** — an unstable contract; `await asyncio.sleep(1)` flush grace periods are timing-based hacks.

### 4.2 File-based state, no database

- ✅ Zero external dependencies → trivially packable for offline installs; state is greppable/debuggable; `VIVIAN_HOME` isolation enables multi-instance on one host.
- ⚠️ Single-host ceiling: no HA, no horizontal scaling; SSE/WS streams and the permission registry are in-process (a second uvicorn worker would break permission respond routing); concurrency safety rests on the single-worker default.

### 4.3 Three daemons with file IPC

- ✅ Channel WS connections and cron timers survive API restarts; failure isolation; independently restartable.
- ⚠️ Operational complexity (3 PIDs, heartbeats, command-file queues with crash recovery); config changes propagate eventually, not transactionally; monkey-patching the `aibot` SDK (SSL for `ws://`, CONNECT proxy) is fragile against SDK upgrades.

### 4.4 `bypassPermissions` by default + risky-list overlay

- ✅ Low-friction UX (the agent doesn't nag for every `ls`), while the admin centrally decides what *always* needs a human ("Bash(rm:*)"), uniformly across WebUI, WS, and IM.
- ⚠️ Safety quality depends entirely on the admin's pattern list; the regex dangerous-bash hook is a backstop, not a sandbox — there is **no OS-level isolation** (containers/seccomp) around tool execution; a clever prompt injection could still act within the allowed toolset.

### 4.5 Reverse-engineered OpenClaw protocol

- ✅ Real interop today: Vivian agents can delegate to a whole second ecosystem of agents.
- ⚠️ Built from disassembled `dist/*.js` of the installed package — any upstream protocol bump breaks it silently; it's a one-way bridge (Vivian → OpenClaw), not channel reuse.

### 4.6 Security posture honesty

- ✅ Real mechanisms: bcrypt passwords, JWT + per-user API keys, owner checks on permission respond, encrypted secrets utils, 0600 device keys, admin-gated PTY terminal, documented unauthenticated-`/metrics` trade-off (ADR-0002).
- ⚠️ Risky defaults shipped in code: `jwt_secret: "sk-vivian"`, `default_password: "vivian"`, CORS `allow_origins=["*"]` with credentials, web terminal = remote shell on the host (admin-gated, but still). Fine on a trusted intranet; dangerous anywhere else.

---

## 5. Multi-Dimension Score

| Dimension | Score | Rationale |
|---|---:|---|
| Architecture & separation of concerns | **8.5/10** | Clean layering (routers→services→SDK), three-process topology fits the constraints, in-process MCP injection is elegant. Docked for file-IPC sprawl and singletons that complicate testing. |
| Reliability engineering | **9/10** | The retry/heal/resume-rotation layer, graceful IM degradation, queue-full backpressure, crash-recovery command processing — unusually mature for a project this age. |
| Security & governance design | **7.5/10** | Layered controls (hooks, risky list, audit, masking, owner checks) are genuinely good; insecure defaults (JWT secret, CORS `*`, default password) and no execution sandbox hold it back. |
| Scalability | **5.5/10** | Deliberately single-host; in-memory permission registry and file state preclude horizontal scale without rework. Acceptable for the target deployment, a ceiling for growth. |
| Code quality & maintainability | **8/10** | Consistent style, explanatory comments that state *why* (the AskUserQuestion answers-map docstring is exemplary), typed Pydantic models everywhere. Some very long functions (`agent_run_events`, channels daemon handlers). |
| Testing | **6/10** | 20 focused backend test modules covering the tricky bits (retry/resume, permission coordinator, answers map, risky matcher, PII hook) — well-chosen targets, but thin overall; no frontend tests; no integration tests against a real CLI. |
| Documentation | **7.5/10** | The IM protocol guide is excellent (production-grade spec); two thoughtful ADRs; CLAUDE.md/design-spec lock the design system. Missing: top-level README/architecture overview for newcomers. |
| Frontend / UX | **8.5/10** | Disciplined design system (locked palette, skeletons, status borders, no AI-slop), deep agent-native UI (canvas, plan review, checkpoints, queued messages, permission cards). |
| Deployability (enterprise/offline) | **9/10** | `pack.sh` with glibc targeting and offline wheel/npm bundling, `VIVIAN_HOME`, log rotation, health endpoint — better offline story than any open-source competitor. |
| Observability | **8/10** | Prometheus with a written cardinality rationale, structured rotating logs per subsystem, audit analytics. Missing distributed tracing (OTel is a dep but unused for spans). |
| Ecosystem & extensibility | **8/10** | Skills + Hub, hooks registry, MCP manager, plugins, subagents, OpenClaw delegation. Internal-only network effects (no community marketplace). |
| **Overall** | **7.9/10** | A production-hardened, sharply-scoped enterprise agent platform; its ceilings (scale, security defaults, channel breadth) are conscious trade-offs rather than oversights. |

---

## 6. Competitive Product & Landscape Analysis (vs OpenClaw / Hermes)

### 6.1 The landscape

By mid-2026 the "self-hosted personal/team agent host" category has three reference points, and Vivian sits in a fourth position they don't occupy:

| | **Vivian (this project)** | **OpenClaw** | **Hermes Agent (Nous Research)** | **Claude Code (stock)** |
|---|---|---|---|---|
| Positioning | **Enterprise multi-user control plane** for Claude Code | Personal AI assistant gateway ("your own assistant on every chat app") | Open-source autonomous agent platform with memory & self-improving skills | Single-user agentic coding CLI |
| Runtime | Python (FastAPI) + Claude Code CLI subprocess | Node/TypeScript Gateway, hub-and-spoke control plane | Python | Node CLI |
| Engine | Claude Agent SDK → Claude Code CLI (full fidelity) | Own agent runtime (RPC to Pi-based agent), multi-model | Own loop, Hermes/other models | Claude Code itself |
| Multi-user / tenancy | ✅ JWT + admin + per-user creds, workspaces, quotas-ready | ❌ effectively single-owner (pairing/allowlists for contacts) | ❌ single-operator | ❌ single user |
| Channels | WeCom (deep, with sync feedback protocol); OpenClaw bridge (delegation); documented SSE spec for adding Feishu/DingTalk/Telegram | ✅ 20+ channels (WhatsApp, Telegram, Slack, Discord, iMessage, Feishu, WeChat, QQ…) — its core strength | Telegram, Discord, Slack, WhatsApp | ❌ none (terminal/IDE/web app) |
| Human-in-the-loop over IM | ✅ **Synchronous AskUserQuestion + risky-tool approval mid-run** (unique) | Partial (exec approvals exist, not a general blocking Q&A protocol) | Limited | TUI prompts only |
| Governance / compliance | ✅ audit + charts, risky-list confirmations, PII masking, hooks, admin console | Minimal (personal tool); pairing codes, allowlists | Minimal | Enterprise managed-settings exist but no central server |
| Scheduling | ✅ daemon + agent-facing scheduler tools + run history UI | ✅ cron jobs | ✅ cron scheduling | Cloud `/schedule` (needs Anthropic cloud) |
| Persistent memory | ❌ session resume only | Partial (session/workspace files) | ✅ **cross-session memory + self-improving skills** — its core strength | Per-project CLAUDE.md/auto-memory |
| Skills ecosystem | Internal Skill Hub (curated, enterprise) | **ClawHub community marketplace** | Auto-learned skills | Plugin/skill marketplaces |
| Offline / air-gapped deploy | ✅ **best-in-class** (`pack.sh`, no external services) | ❌ assumes internet (npm, APIs) | Partial (self-host but online models typical) | ❌ needs Anthropic/gateway online; no server mode |
| License / community | Proprietary/in-house | MIT, large community | Open source (Nous) | Proprietary (free CLI) |

### 6.2 Where Vivian wins

1. **Multi-tenancy with governance is the moat.** Neither OpenClaw nor Hermes has a credible answer to "give 200 employees an agent, each with their own gateway token, with audit and admin-enforced approval rules." That's Vivian's entire reason to exist, and it's executed deeply (owner checks on permission respond, per-user skill allowlists, admin inspection of any user's skills/MCP/jobs).
2. **The synchronous IM approval protocol.** OpenClaw treats channels mostly as transport; Vivian makes the channel a *control surface* — the agent can pause mid-run and negotiate with a human over plain text. The spec quality (timeout semantics, degradation switch, answer-map rebuilding) is ahead of anything comparable.
3. **Claude Code engine fidelity.** Hermes and OpenClaw run their own loops; Vivian inherits Anthropic's — including checkpoint/rewind, plan mode, subagents, and the skills format — and exposes them in a UI (rewind banner, plan review panel) that even Anthropic's own web app doesn't fully match.
4. **Air-gapped deployment.** Unique in this set.

### 6.3 Where Vivian loses

1. **Channel breadth.** One deep channel (WeCom) vs OpenClaw's 20+. The OpenClaw *bridge* is delegation, not channel reuse — Vivian cannot today answer on WhatsApp/Telegram/Feishu without new daemon work.
2. **No persistent memory.** Hermes' cross-session memory + self-learned skills make an assistant that *gets better*; Vivian's agent forgets everything between sessions unless the user resumes one.
3. **Ecosystem gravity.** MIT communities (ClawHub, Hermes' GitHub) compound; an internal Skill Hub doesn't.
4. **Single-host scale ceiling** — fine for one department, a problem for company-wide rollout.

---

## 7. Why Not Just Use Claude Code Directly?

Vivian *does* use Claude Code — every run is a Claude Code CLI subprocess. The question is really "why not hand employees the CLI?" The codebase itself answers it:

1. **Identity & credentials.** Stock Claude Code is one user, one `~/.claude`, one credential. Vivian binds every run to a JWT-authenticated user with their *own* gateway base-url/token (`options.py` refuses to run without them) — central provisioning, revocation, and per-user cost attribution. (A known real-world failure mode is recorded in project memory: a user-level `~/.claude.json` env block silently overriding the injected gateway URL — exactly the class of problem central injection eliminates.)
2. **Non-developer access.** The CLI assumes a terminal and git literacy. Vivian's consumers chat in WeCom or a browser; files the agent produces are surfaced in a Canvas (via the injected `FileCanvas` MCP tool), not left in a directory.
3. **Governance that the user can't switch off.** A CLI user picks their own permission mode and can edit their own settings. Vivian's risky-tool list, dangerous-bash hook, PII masking, disallowed tools, and audit log are enforced **server-side**, uniformly, per admin policy — the user never owns the process.
4. **Synchronous approvals from anywhere.** Claude Code's permission prompts live in the TUI. Vivian externalizes them as `permission_request` events answerable from a browser tab or a WeCom message — the agent run and the approving human no longer need to share a terminal.
5. **Always-on autonomy without Anthropic cloud.** Claude Code's scheduled/cloud agents require Anthropic's cloud, unusable behind an enterprise gateway. Vivian's scheduler daemon runs cron agent jobs entirely on-prem, with history and a management UI.
6. **Fleet operations.** Session storage on a server (list/search/delete any user's sessions), usage statistics, Prometheus metrics, hot-swappable CLI binary path (admin can roll the CLI version for everyone at once), offline packaging — none of which exists when 200 laptops each run their own CLI.
7. **Failure-mode hardening at scale.** Individual CLI users just retry by hand when a gateway hiccups; a platform can't — hence the synthetic-error retry/heal/resume layer, which is effectively *operational SRE work encoded around the CLI*.

The honest corollary: for a single developer at a terminal with direct API access, stock Claude Code is strictly better — Vivian's value begins exactly where "one user, one terminal, one key" ends.

---

## 8. Key Competitive Optimizations for Future Product Evolution

Ordered by leverage (impact ÷ effort), informed by the competitive gaps in §6:

1. **Persistent memory layer (close the Hermes gap).** Per-user and per-chat memory files injected into the system prompt (the plugin system in `vivian_plugin/` is the natural mount point — `enterprise_user_info` already proves the pattern). Start with: rolling conversation summaries per WeCom chat key, user preference memory, and write-back hooks after each run. This converts Vivian from "a fresh agent every session" into "an assistant that knows you," the single biggest perceived-quality jump available.
2. **Channel SPI + 2–3 more channels (close the OpenClaw gap).** The WeCom daemon hard-codes channel logic; extract the proven abstractions (message queue per chat key, pending-feedback state machine, session map, access gate, proactive delivery) into a channel interface, then ship **Feishu/Lark and DingTalk** adapters — the documented SSE protocol in `docs/im-channel-permission-zh.md` is already the contract. Alternatively/additionally: run OpenClaw *as* the channel fan-out (it speaks 20+ channels, including Feishu/WeChat) while keeping Vivian as the governed engine — the bridge already exists, inverting it may be cheaper than five adapters.
3. **Horizontal-scale escape hatch.** Replace the in-memory permission registry + file queues with SQLite→Postgres + Redis pub/sub behind thin repository interfaces, so SSE streams and permission responds can cross worker boundaries. Even if single-host remains the default, removing the architectural ceiling de-risks larger rollouts.
4. **Security hardening for the next deployment tier.** Forced JWT-secret/password rotation at setup, CORS allowlist from config, optional `METRICS_TOKEN` (already anticipated in ADR-0002), and — most importantly — **sandboxed tool execution** (per-run container or bubblewrap with the user workspace bind-mounted). That last item is the difference between "governed" and "contained," and no competitor in this set has it either: first mover wins enterprise security reviews.
5. **CLI-contract test suite.** The heal/strip/resume logic depends on Claude Code's private session JSONL format and synthetic-error shape. A small integration suite that runs the *bundled* CLI through scripted failures (and runs in CI against each CLI upgrade candidate) turns the riskiest coupling in the codebase into a managed one, enabling faster SDK upgrades than competitors can safely do.
6. **Cost & quota plane.** Token usage is already audited per run; add per-user/per-team budgets, soft/hard quota enforcement at run start, and cost dashboards. Enterprise buyers ask for this immediately after audit, and neither OpenClaw nor Hermes has it.
7. **Skill Hub network effects, internally.** Add versioning, signing, an approval workflow, and automated evals (the bundled `skill-creator` already contains an eval harness — wire it into Hub delivery as a quality gate). The pitch becomes "a governed internal marketplace," contrasting with ClawHub's ungoverned community model in exactly the way enterprises prefer.
8. **Deterministic multi-agent orchestration.** Subagents exist; the next step is reusable, schedulable pipelines (review → verify → synthesize) with per-stage audit — the scheduler's `AgentRunConfig` is a natural base. This matches where the frontier harnesses are heading and would differentiate against both competitors' single-loop designs.
9. **Group-chat-native operation.** Current WeCom integration is strongest in 1:1 (group history is push-only per the SDK's limits; full history needs the separate msgaudit product). Design for "agent as a group member" — mention-triggered runs, per-group memory, thread-scoped sessions — which is where Chinese enterprise IM usage actually lives.
10. **Observability completion.** OpenTelemetry is already a dependency; emit spans per run/tool/retry and link them to audit entries, giving ops a trace view of "why was this answer slow" — cheap to add, high trust payoff.

---

## Appendix A — Key file map

| Area | Files |
|---|---|
| Engine | `vivian/api/services/claude_sdk/{options,service,permission_coordinator,retry,session_heal,serialization}.py` |
| Channels | `vivian/api/services/channels/{daemon,wecom_feedback,openclaw_bridge,openclaw_mcp_tools,config_store}.py` |
| Scheduler | `vivian/api/services/scheduler/{daemon,job_store,run_history,mcp_tools,builtin_tasks,tool_retry}.py` |
| Governance | `vivian/api/services/hooks/*`, `services/audit_log.py`, `utils/sensitive_mask.py`, `services/user_store.py` |
| API surface | `vivian/api/routers/*` (17 routers, ~120 endpoints incl. `/api/agent/ws/run`, `/api/agent/run/stream`, `/api/pty/ws`) |
| Frontend | `vivian/web/src/{components,stores,api}` (21 Zustand stores; chat/canvas/admin/scheduler/skills/mcp/hooks/subagents/terminal) |
| Deployment | `pack.sh`, `vivian/bin/server.sh`, `requirements.txt` |
| Specs | `docs/im-channel-permission-zh.md`, `docs/adr/000{1,2}-*.md`, `vivian/web/design-spec.md`, `CLAUDE.md`/`AGENTS.md` |

## Appendix B — Competitive sources

- [OpenClaw GitHub](https://github.com/openclaw/openclaw) · [OpenClaw docs](https://docs.openclaw.ai/) · [OpenClaw architecture overview (ppaolo)](https://ppaolo.substack.com/p/openclaw-system-architecture-overview) · [Multi-channel gateway guide (Bill WANG)](https://medium.com/@ozbillwang/understanding-openclaw-a-comprehensive-guide-to-the-multi-channel-ai-gateway-ad8857cd1121)
- [Hermes Agent (NousResearch) — Web UI gateway issue #501](https://github.com/NousResearch/hermes-agent/issues/501) · [Hermes vs OpenClaw comparison (hostadvice)](https://hostadvice.com/blog/ai/hermes-agent-vs-openclaw/) · [Hermes alternatives 2026 (Composio)](https://composio.dev/content/hermes-agent-alternatives) · [Hermes WebUI vs alternatives (BSWEN)](https://docs.bswen.com/blog/2026-06-02-hermes-webui-vs-alternatives/)
- In-repo evidence for the OpenClaw protocol bridge: `vivian/api/services/channels/openclaw_bridge.py` (Ed25519 device-identity handshake, gateway protocol v3).
