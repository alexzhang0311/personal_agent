#!/usr/bin/env python3
"""事实层：基于 ITSM 变更计划时间，产出生产变更重叠时间线与两两时序事实。

只输出确定性事实（重叠/相邻关系、环境/状态标签、组件信号、聚合指标），
不做风险定级。风险等级由 Agent 读取本脚本输出后，按 references/risk_rules
规则集路由判定（见 SKILL.md 的“变更风险分析”）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - depends on runtime image
    yaml = None

from query_changes import (
    DEFAULT_CHANGE_URL,
    TEAM_NAME_CHOICES,
    clean_payload,
    current_week_range,
    extract_records,
    parse_change_steps,
    parse_query_bound,
    pick,
    post_json,
)

# 中文化 argparse 内置帮助文案。
_ARGPARSE_TRANSLATIONS = {
    "usage: ": "用法：",
    "options": "选项",
    "show this help message and exit": "显示帮助信息并退出",
}
argparse._ = lambda text: _ARGPARSE_TRANSLATIONS.get(text, text)

SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_RULES_DIR = SKILL_DIR / "references" / "risk_rules"
ENV_SPLIT = re.compile(r"[,，、;；/|\s]+")
FALLBACK_TEAMS = ["业务系统运营室", "网络运维室", "数据库运维室", "中间件平台室", "主机运维室"]
BEIJING_TZ = timezone(timedelta(hours=8))
# 步骤之间起止时间差超过该阈值，才认为是“分阶段”（如灰度/全量），其余视为等于变更窗口。
PHASE_THRESHOLD_MINUTES = 30


@dataclass
class Policy:
    buffer_minutes: int
    default_teams: list[str]
    production_tokens: list[str]
    nonproduction_tokens: list[str]
    main_env_classes: list[str]
    closed_tokens: list[str]
    component_tokens: list[str]
    operation_tokens: list[str]


@dataclass
class ChangeFact:
    record: dict[str, Any]
    start: datetime
    end: datetime
    in_window: bool
    env_class: str
    status_class: str
    components: list[dict[str, Any]]
    operations: list[dict[str, Any]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    # 步骤的有效时间区间（已合并），用于 --overlap-by-steps；为空时回退到变更窗口。
    step_intervals: list[tuple[datetime, datetime]] = field(default_factory=list)
    # 同一单内步骤起止时间存在明显差异（分阶段，如灰度/全量）。
    phased: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="产出生产变更重叠时间线与时序事实（不含风险定级）。"
    )
    parser.add_argument(
        "--url",
        default=os.getenv("ITSM_QUERY_CHANGE_URL", DEFAULT_CHANGE_URL),
        help="变更单查询接口地址。默认读取 ITSM_QUERY_CHANGE_URL；未设置时使用 ApiDesign 文档地址。",
    )
    parser.add_argument(
        "--rules-dir",
        default=str(DEFAULT_RULES_DIR),
        help="风险规则集目录，默认技能内置 references/risk_rules。脚本只读取其中策略字段。",
    )
    parser.add_argument("--team-name", "--teamName", action="append", choices=TEAM_NAME_CHOICES, help="纳入分析的团队，可重复；不传时使用 _index.yaml 的 defaultTeams。")
    parser.add_argument("--date", dest="query_date", help="分析指定自然日内有重叠的生产变更，格式 yyyy-MM-dd。")
    parser.add_argument("--time-begin", dest="time_begin", help="分析时间区间开始；必须和 --time-end 成对使用。")
    parser.add_argument("--time-end", dest="time_end", help="分析时间区间结束；必须和 --time-begin 成对使用。")
    parser.add_argument("--current-week", action="store_true", help="分析当前自然周内有重叠的生产变更。")
    parser.add_argument("--fault-time", help="故障追因时间点；窗口为故障前 4 小时到故障后 1 小时，并自动纳入已关闭变更。")
    parser.add_argument("--include-closed", action="store_true", help="把已关闭/已完成等状态计入主分析。故障追因默认开启。")
    parser.add_argument("--include-non-production", action="store_true", help="把非生产/混合环境计入主分析。默认仅生产环境和云生产环境。")
    parser.add_argument("--include-same-team-pairs", action="store_true", help="在 pairs 中保留同团队两两关系。默认只输出跨团队 pairs（同团队并发用 peakConcurrency/时间线体现）。")
    parser.add_argument("--overlap-by-steps", action="store_true", help="按变更步骤的有效时间区间逐段计算重叠/相邻；步骤无有效时间时回退到变更窗口。默认关闭（多数变更步骤时间≈变更窗口）。")
    parser.add_argument("--page-size", type=int, default=100, help="每页大小，默认 100；脚本限制在 1 到 100。")
    parser.add_argument("--max-pages-per-team", type=int, default=50, help="每个团队最多扫描页数，默认 50。")
    parser.add_argument("--timeout", type=float, default=45.0, help="单个 HTTP 请求超时时间，单位秒，默认 45。")
    parser.add_argument("--retries", type=int, default=2, help="单个请求失败时的重试次数，默认 2。")
    parser.add_argument("--concurrency", type=int, default=6, help="并发抓取的最大请求数，默认 6。")
    parser.add_argument("--input-json", help="从指定文件读取已有 JSON 响应；传 '-' 时从标准输入读取，并只执行本地分析。")
    parser.add_argument("--output", choices=("text", "json"), default="text", help="输出格式，默认为 text。")
    return parser.parse_args()


def clamp_page_size(page_size: int) -> int:
    return max(1, min(page_size, 100))


# --------------------------------------------------------------------------- #
# 规则集（策略）加载
# --------------------------------------------------------------------------- #
def _load_yaml_or_json(path: Path) -> Any:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(text)
    if yaml is None:
        raise SystemExit(f"读取 {path.name} 需要安装 PyYAML。")
    return yaml.safe_load(text)


def load_policy(rules_dir: str) -> Policy:
    base = Path(rules_dir)
    index = _load_yaml_or_json(base / "_index.yaml") or {}
    components = _load_yaml_or_json(base / "components.yaml") or []
    operations = _load_yaml_or_json(base / "operations.yaml") or []
    if not isinstance(index, dict):
        index = {}

    env_policy = index.get("envPolicy", {}) if isinstance(index.get("envPolicy"), dict) else {}
    status_policy = index.get("statusPolicy", {}) if isinstance(index.get("statusPolicy"), dict) else {}

    def _tokens(items: Any) -> list[str]:
        out: list[str] = []
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    token = str(item.get("keyword", "")).strip()
                    if token:
                        out.append(token)
        return out

    component_tokens = _tokens(components)
    operation_tokens = _tokens(operations)

    default_teams = [t for t in index.get("defaultTeams", []) if isinstance(t, str)]
    return Policy(
        buffer_minutes=int(index.get("bufferMinutes", 60) or 60),
        default_teams=default_teams,
        production_tokens=[str(t) for t in env_policy.get("productionTokens", ["生产环境", "云生产环境"])],
        nonproduction_tokens=[str(t) for t in env_policy.get("nonProductionTokens", ["准生产", "测试", "UAT", "uat", "开发"])],
        main_env_classes=[str(t) for t in env_policy.get("mainAnalysisEnvClasses", ["production", "cloud-production"])],
        closed_tokens=[str(t) for t in status_policy.get("closedTokens", [])],
        component_tokens=component_tokens,
        operation_tokens=operation_tokens,
    )


# --------------------------------------------------------------------------- #
# 标签富集
# --------------------------------------------------------------------------- #
def classify_env(envs: str, policy: Policy) -> str:
    if not envs or not envs.strip():
        return "unknown"
    classes: set[str] = set()
    for part in ENV_SPLIT.split(envs.strip()):
        if not part:
            continue
        # 先判非生产：因为“生产环境”是“准生产环境”的子串。
        if any(tok and tok in part for tok in policy.nonproduction_tokens):
            classes.add("non-production")
        elif "云生产环境" in part:
            classes.add("cloud-production")
        elif any(tok and tok in part for tok in policy.production_tokens):
            classes.add("production")
        else:
            classes.add("unknown")

    has_prod = bool({"production", "cloud-production"} & classes)
    has_nonprod = "non-production" in classes
    if has_prod and has_nonprod:
        return "mixed"
    if has_prod:
        return "cloud-production" if classes == {"cloud-production"} else "production"
    if has_nonprod:
        return "non-production"
    return "unknown"


def classify_status(record: dict[str, Any], policy: Policy) -> str:
    text = f"{pick(record, 'changeStatusName')} {pick(record, 'changeStatus')}".strip()
    if not text:
        return "unknown"
    if any(tok and tok in text for tok in policy.closed_tokens):
        return "closed"
    return "open"


def step_signal_text(record: dict[str, Any]) -> str:
    """步骤可搜索文本：只取步骤名和步骤描述，不取团队名/处理人，避免误命中。"""
    steps, raw = parse_change_steps(record)
    if raw:
        return raw
    parts: list[str] = []
    for step in steps:
        parts.append(pick(step, "stepName"))
        parts.append(pick(step, "stepDesc"))
    return " ".join(p for p in parts if p)


def _scan_text_signals(record: dict[str, Any], tokens: list[str]) -> list[dict[str, Any]]:
    """中性信号扫描：只扫标题、描述、步骤名/描述；不扫团队名。不赋等级。"""
    fields = {
        "title": pick(record, "changeTitle"),
        "desc": pick(record, "changeDesc"),
        "steps": step_signal_text(record),
    }
    lowered = {key: value.lower() for key, value in fields.items()}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for token in tokens:
        low = token.lower()
        if not low or low in seen:
            continue
        matched = [field for field, value in lowered.items() if low in value]
        if matched:
            seen.add(low)
            out.append({"token": token, "matchedIn": matched})
    return out


def component_signals(record: dict[str, Any], policy: Policy) -> list[dict[str, Any]]:
    """组件信号：动了什么组件（TiDB/WEMQ/防火墙…）。"""
    return _scan_text_signals(record, policy.component_tokens)


def operation_signals(record: dict[str, Any], policy: Policy) -> list[dict[str, Any]]:
    """操作动作信号：做了什么动作（主备切换/缩容/割接/滚动升级…）。"""
    return _scan_text_signals(record, policy.operation_tokens)


# --------------------------------------------------------------------------- #
# 时间区间工具
# --------------------------------------------------------------------------- #
def record_window(record: dict[str, Any]) -> tuple[datetime, datetime] | None:
    start = parse_query_bound(record.get("changePlanStartDate"), is_end=False)
    end = parse_query_bound(record.get("changePlanEndDate"), is_end=True)
    if start is None and end is None:
        return None
    start = start or end
    end = end or start
    if start is None or end is None or start > end:
        return None
    return start, end


def intervals_overlap(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 <= b1 and b0 <= a1


def overlap_minutes(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> int:
    if not intervals_overlap(a0, a1, b0, b1):
        return 0
    return max(int((min(a1, b1) - max(a0, b0)).total_seconds() // 60), 0)


def gap_minutes(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> int:
    if intervals_overlap(a0, a1, b0, b1):
        return 0
    if a1 < b0:
        return int((b0 - a1).total_seconds() // 60)
    return int((a0 - b1).total_seconds() // 60)


def merge_intervals(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged: list[list[datetime]] = [list(ordered[0])]
    for start, end in ordered[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def intervals_set_relation(
    a_intervals: list[tuple[datetime, datetime]],
    b_intervals: list[tuple[datetime, datetime]],
) -> tuple[bool, int, int]:
    """两个区间集合的关系：是否重叠、总重叠分钟、最近间隔分钟（不重叠时）。"""
    any_overlap = False
    overlap_total = 0
    min_gap: int | None = None
    for a0, a1 in a_intervals:
        for b0, b1 in b_intervals:
            if intervals_overlap(a0, a1, b0, b1):
                any_overlap = True
                overlap_total += overlap_minutes(a0, a1, b0, b1)
            else:
                gap = gap_minutes(a0, a1, b0, b1)
                min_gap = gap if min_gap is None else min(min_gap, gap)
    return any_overlap, overlap_total, (0 if any_overlap else (min_gap or 0))


def parse_epoch_millis(value: Any) -> datetime | None:
    if value in (None, "", 0, "0"):
        return None
    try:
        seconds = float(value) / 1000
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).astimezone(BEIJING_TZ).replace(tzinfo=None)


def extract_steps(record: dict[str, Any]) -> tuple[list[dict[str, Any]], list[tuple[datetime, datetime]], bool]:
    """解析变更步骤：返回 (可展示步骤列表, 有效时间区间, 是否分阶段)。"""
    raw_steps, raw_text = parse_change_steps(record)
    if raw_text or not raw_steps:
        return [], [], False

    steps: list[dict[str, Any]] = []
    intervals: list[tuple[datetime, datetime]] = []
    for step in raw_steps:
        start = parse_epoch_millis(step.get("startTime"))
        end = parse_epoch_millis(step.get("endTime"))
        steps.append(
            {
                "stepName": pick(step, "stepName"),
                "teamName": pick(step, "teamName"),
                "status": pick(step, "stepStatusName") or pick(step, "stepStatus"),
                "start": start.strftime("%Y-%m-%d %H:%M:%S") if start else "",
                "end": end.strftime("%Y-%m-%d %H:%M:%S") if end else "",
                "desc": pick(step, "stepDesc"),
            }
        )
        if start and end and start <= end:
            intervals.append((start, end))

    phased = False
    if len(intervals) >= 2:
        threshold = timedelta(minutes=PHASE_THRESHOLD_MINUTES)
        starts = sorted(s for s, _ in intervals)
        ends = sorted(e for _, e in intervals)
        if (starts[-1] - starts[0]) > threshold or (ends[-1] - ends[0]) > threshold:
            phased = True
    return steps, merge_intervals(intervals), phased


def fact_active_intervals(fact: ChangeFact, by_steps: bool) -> list[tuple[datetime, datetime]]:
    if by_steps and fact.step_intervals:
        return fact.step_intervals
    return [(fact.start, fact.end)]


# --------------------------------------------------------------------------- #
# 时间过滤 / 团队范围
# --------------------------------------------------------------------------- #
def normalize_time_filters(args: argparse.Namespace) -> tuple[datetime, datetime, bool]:
    has_time_range = bool(args.time_begin or args.time_end)
    selected = sum([has_time_range, bool(args.query_date), bool(args.current_week), bool(args.fault_time)])
    if selected > 1:
        raise SystemExit("--time-begin/--time-end、--date、--current-week、--fault-time 四组时间条件互斥。")

    if args.fault_time:
        fault_at = parse_query_bound(args.fault_time, is_end=False)
        if fault_at is None:
            raise SystemExit(f"--fault-time 不是有效时间：{args.fault_time}")
        return fault_at - timedelta(hours=4), fault_at + timedelta(hours=1), True

    if has_time_range and not (args.time_begin and args.time_end):
        raise SystemExit("--time-begin 和 --time-end 必须成对使用。")

    if args.query_date:
        args.time_begin = args.query_date
        args.time_end = args.query_date
    if args.current_week:
        args.time_begin, args.time_end = current_week_range()
    if not args.time_begin and not args.time_end:
        today = date.today().isoformat()
        args.time_begin = today
        args.time_end = today

    begin = parse_query_bound(args.time_begin, is_end=False)
    end = parse_query_bound(args.time_end, is_end=True)
    if begin is None:
        raise SystemExit(f"--time-begin 不是有效时间：{args.time_begin}")
    if end is None:
        raise SystemExit(f"--time-end 不是有效时间：{args.time_end}")
    if begin > end:
        raise SystemExit("--time-begin 不能晚于 --time-end。")
    return begin, end, bool(args.include_closed)


def team_scope(args: argparse.Namespace, policy: Policy) -> list[str]:
    teams = args.team_name or policy.default_teams or FALLBACK_TEAMS
    unique: list[str] = []
    for team in teams:
        if isinstance(team, str) and team in TEAM_NAME_CHOICES and team not in unique:
            unique.append(team)
    return unique or FALLBACK_TEAMS


# --------------------------------------------------------------------------- #
# 取数
# --------------------------------------------------------------------------- #
def _post_with_retry(url: str, payload: dict[str, Any], timeout: float, retries: int) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(max(retries, 0) + 1):
        try:
            return post_json(url, payload, timeout)
        except RuntimeError as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(2 ** attempt, 5))
    raise last_error if last_error else RuntimeError("请求失败")


def _fetch_page(args: argparse.Namespace, team: str, page: int, plan_end_date: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = clean_payload(
        {
            "teamName": team,
            "pageSize": clamp_page_size(args.page_size),
            "currentPage": page,
            # 服务端无损上限：开始时间晚于（窗口末 + 缓冲）的变更不可能与窗口重叠/相邻。
            "planStartDateEnd": plan_end_date,
        }
    )
    data = _post_with_retry(args.url, payload, args.timeout, args.retries)
    return extract_records(data)


def fetch_all_records(args: argparse.Namespace, teams: list[str], plan_end_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    max_pages = max(args.max_pages_per_team, 1)
    workers = max(args.concurrency, 1)

    # 第一阶段：并发拉每个团队第 1 页，拿到 totalPage。
    first_page: dict[str, tuple[dict[str, Any], list[dict[str, Any]], int, str | None]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_page, args, team, 1, plan_end_date): team for team in teams}
        for future in as_completed(futures):
            team = futures[future]
            try:
                result, records = future.result()
                try:
                    total_page = int(result.get("totalPage", 1))
                except (TypeError, ValueError):
                    total_page = 1
                first_page[team] = (result, records, total_page, None)
            except Exception as exc:  # noqa: BLE001 - 单团队失败不拖垮全局
                first_page[team] = ({}, [], 0, str(exc))

    # 第二阶段：并发拉所有团队剩余页。
    tasks: list[tuple[str, int]] = []
    for team, (_, _, total_page, error) in first_page.items():
        if error:
            continue
        capped = min(total_page, max_pages)
        tasks.extend((team, page) for page in range(2, capped + 1))

    extra: dict[str, list[dict[str, Any]]] = {team: [] for team in teams}
    page_errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_page, args, team, page, plan_end_date): (team, page) for team, page in tasks}
        for future in as_completed(futures):
            team, page = futures[future]
            try:
                _, records = future.result()
                extra[team].extend(records)
            except Exception as exc:  # noqa: BLE001 - 单页失败不拖垮全局，标记 truncated
                page_errors[team] = str(exc)

    records: list[dict[str, Any]] = []
    metadata: list[dict[str, Any]] = []
    for team in teams:
        result, page1_records, total_page, error = first_page[team]
        records.extend(page1_records + extra[team])
        capped = min(total_page, max_pages) if total_page else 0
        truncated = bool(error) or team in page_errors or total_page > capped
        meta: dict[str, Any] = {
            "teamName": team,
            "scannedPages": 0 if error else capped,
            "truncated": truncated,
            "sourceTotalCount": result.get("totalCount"),
            "sourceTotalPage": result.get("totalPage"),
        }
        if error or page_errors.get(team):
            meta["error"] = error or page_errors.get(team)
        metadata.append(meta)
    return records, metadata


def load_source_records(args: argparse.Namespace, teams: list[str], plan_end_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if args.input_json:
        text = sys.stdin.read() if args.input_json == "-" else Path(args.input_json).read_text(encoding="utf-8")
        source_metadata, records = extract_records(json.loads(text))
        return records, [
            {
                "teamName": "input-json",
                "scannedPages": 0,
                "truncated": False,
                "sourceTotalCount": source_metadata.get("totalCount"),
                "sourceTotalPage": source_metadata.get("totalPage"),
            }
        ]
    return fetch_all_records(args, teams, plan_end_date)


# --------------------------------------------------------------------------- #
# 事实构建
# --------------------------------------------------------------------------- #
def build_facts(
    records: list[dict[str, Any]],
    begin: datetime,
    end: datetime,
    policy: Policy,
    include_closed: bool,
    include_non_production: bool,
) -> tuple[list[ChangeFact], list[dict[str, Any]]]:
    buffer = timedelta(minutes=policy.buffer_minutes)
    cand_begin, cand_end = begin - buffer, end + buffer

    facts: list[ChangeFact] = []
    excluded: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for record in records:
        itsm_id = pick(record, "itsmId")
        if itsm_id and itsm_id in seen_ids:
            continue
        if itsm_id:
            seen_ids.add(itsm_id)

        window = record_window(record)
        if window is None:
            continue
        start, finish = window
        if not intervals_overlap(start, finish, cand_begin, cand_end):
            continue
        in_window = intervals_overlap(start, finish, begin, end)

        env_class = classify_env(pick(record, "envs"), policy)
        status_class = classify_status(record, policy)
        env_ok = include_non_production or env_class in policy.main_env_classes
        status_ok = include_closed or status_class != "closed"

        if not (env_ok and status_ok):
            if in_window:  # 只把窗口内被排除的列出来，窗口外的不算 excluded
                reasons: list[str] = []
                if not env_ok:
                    reasons.append(f"envClass={env_class}（{pick(record, 'envs') or '空'}）")
                if not status_ok:
                    reasons.append(f"statusClass=closed（{pick(record, 'changeStatusName') or pick(record, 'changeStatus')}）")
                excluded.append(
                    {
                        "itsmId": itsm_id,
                        "teamName": pick(record, "teamName"),
                        "title": pick(record, "changeTitle"),
                        "reason": "；".join(reasons),
                    }
                )
            continue

        steps, step_intervals, phased = extract_steps(record)
        facts.append(
            ChangeFact(
                record=record,
                start=start,
                end=finish,
                in_window=in_window,
                env_class=env_class,
                status_class=status_class,
                components=component_signals(record, policy),
                operations=operation_signals(record, policy),
                steps=steps,
                step_intervals=step_intervals,
                phased=phased,
            )
        )

    facts.sort(key=lambda f: (f.start, f.end, pick(f.record, "itsmId")))
    return facts, excluded


def build_pairs(
    facts: list[ChangeFact],
    policy: Policy,
    include_same_team: bool = False,
    by_steps: bool = False,
) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    for index, first in enumerate(facts):
        first_intervals = fact_active_intervals(first, by_steps)
        for second in facts[index + 1:]:
            if not (first.in_window or second.in_window):
                continue
            # 默认只保留跨团队对：同团队对在 pairs.yaml 无规则可路由，是噪声。
            if not include_same_team and pick(first.record, "teamName") == pick(second.record, "teamName"):
                continue
            second_intervals = fact_active_intervals(second, by_steps)
            overlapped, overlap_total, gap = intervals_set_relation(first_intervals, second_intervals)
            if overlapped:
                relation = "overlap"
            elif gap <= policy.buffer_minutes:
                relation = "adjacent"
            else:
                continue
            pair: dict[str, Any] = {
                "a": pick(first.record, "itsmId"),
                "b": pick(second.record, "itsmId"),
                "teams": [pick(first.record, "teamName"), pick(second.record, "teamName")],
                "relation": relation,
                "overlapMinutes": overlap_total,
                "gapMinutes": gap,
            }
            if by_steps:
                pair["basis"] = "steps" if (first.step_intervals or second.step_intervals) else "changeWindow"
            pairs.append(pair)
    pairs.sort(key=lambda p: (0 if p["relation"] == "overlap" else 1, -p["overlapMinutes"], p["gapMinutes"]))
    return pairs


def peak_concurrency(core: list[ChangeFact], begin: datetime, end: datetime) -> int:
    events: list[tuple[datetime, int]] = []
    for fact in core:
        start = max(fact.start, begin)
        finish = min(fact.end, end)
        if start > finish:
            continue
        events.append((start, 1))
        events.append((finish, -1))
    # 同一时刻先处理结束(-1)再处理开始(+1)，首尾相接不计为并发。
    events.sort(key=lambda item: (item[0], item[1]))
    current = peak = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def build_aggregate(core: list[ChangeFact], pairs: list[dict[str, Any]], begin: datetime, end: datetime) -> dict[str, Any]:
    by_team: dict[str, int] = {}
    for fact in core:
        team = pick(fact.record, "teamName") or "(未知)"
        by_team[team] = by_team.get(team, 0) + 1
    return {
        "changeCount": len(core),
        "byTeam": by_team,
        "overlapPairs": sum(1 for p in pairs if p["relation"] == "overlap"),
        "adjacentPairs": sum(1 for p in pairs if p["relation"] == "adjacent"),
        "peakConcurrency": peak_concurrency(core, begin, end),
    }


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #
def fact_to_dict(fact: ChangeFact) -> dict[str, Any]:
    record = fact.record
    return {
        "itsmId": pick(record, "itsmId"),
        "title": pick(record, "changeTitle"),
        "teamName": pick(record, "teamName"),
        "operator": pick(record, "operator"),
        "operatorName": pick(record, "operatorName"),
        "owner": pick(record, "changeOwner"),
        "ownerName": pick(record, "changeOwnerName"),
        "status": pick(record, "changeStatusName") or pick(record, "changeStatus"),
        "statusClass": fact.status_class,
        "envs": pick(record, "envs"),
        "envClass": fact.env_class,
        "planStart": fact.start.strftime("%Y-%m-%d %H:%M:%S"),
        "planEnd": fact.end.strftime("%Y-%m-%d %H:%M:%S"),
        "durationMinutes": int((fact.end - fact.start).total_seconds() // 60),
        "inWindow": fact.in_window,
        "componentSignals": fact.components,
        "operationSignals": fact.operations,
        "stepsPhased": fact.phased,
        "steps": fact.steps,
        "desc": pick(record, "changeDesc"),
    }


def print_text(
    begin: datetime,
    end: datetime,
    teams: list[str],
    facts: list[ChangeFact],
    pairs: list[dict[str, Any]],
    aggregate: dict[str, Any],
    excluded: list[dict[str, Any]],
    metadata: list[dict[str, Any]],
    policy: Policy,
    include_closed: bool,
    include_non_production: bool,
    overlap_by_steps: bool = False,
) -> None:
    core = [f for f in facts if f.in_window]
    boundary = [f for f in facts if not f.in_window]

    print("事实层输出（不含风险结论；风险等级由 Agent 依据 references/risk_rules 判定）")
    print(f"时间窗口：{begin:%Y-%m-%d %H:%M:%S} -> {end:%Y-%m-%d %H:%M:%S}；缓冲：{policy.buffer_minutes} 分钟")
    print(f"团队范围：{'、'.join(teams)}")
    print(
        "窗口内生产变更：{count} 条；实际重叠：{ov} 组；缓冲相邻：{adj} 组；峰值并发：{peak}".format(
            count=aggregate["changeCount"],
            ov=aggregate["overlapPairs"],
            adj=aggregate["adjacentPairs"],
            peak=aggregate["peakConcurrency"],
        )
    )
    print(
        "过滤规则：{closed}；{prod}（被排除项见 excluded 段）".format(
            closed="含已关闭" if include_closed else "排除已关闭/已完成类",
            prod="含非生产/混合" if include_non_production else "仅生产环境/云生产环境",
        )
    )
    print(f"overlap 口径：{'按步骤有效时间逐段（无步骤时间回退变更窗口）' if overlap_by_steps else '变更窗口'}")
    errored = [f"{m['teamName']}({m['error']})" for m in metadata if m.get("error")]
    if errored:
        print(f"数据提醒：以下团队抓取出错，结果可能不完整：{'、'.join(errored)}")
    truncated = [m["teamName"] for m in metadata if m.get("truncated") and not m.get("error")]
    if truncated:
        print(f"数据提醒：以下团队扫描达到上限，结果可能不完整：{'、'.join(truncated)}")

    if pairs:
        print("\n时序关系（事实，未定级）：")
        for index, pair in enumerate(pairs[:12], start=1):
            detail = f"重叠 {pair['overlapMinutes']} 分钟" if pair["relation"] == "overlap" else f"间隔 {pair['gapMinutes']} 分钟"
            print(f"{index}. [{pair['relation']}] {detail}：{pair['a']} [{pair['teams'][0]}] / {pair['b']} [{pair['teams'][1]}]")

    signal_facts = [f for f in core if f.components]
    if signal_facts:
        print("\n组件信号（中性，需结合内容确认是否确有变更动作）：")
        for fact in signal_facts[:12]:
            tokens = "、".join(f"{c['token']}({'/'.join(c['matchedIn'])})" for c in fact.components)
            print(f"- {pick(fact.record, 'itsmId')} [{pick(fact.record, 'teamName')}] {pick(fact.record, 'changeTitle') or '(无标题)'} → {tokens}")

    op_facts = [f for f in core if f.operations]
    if op_facts:
        print("\n操作动作信号（中性，需结合内容确认）：")
        for fact in op_facts[:12]:
            tokens = "、".join(f"{c['token']}({'/'.join(c['matchedIn'])})" for c in fact.operations)
            print(f"- {pick(fact.record, 'itsmId')} [{pick(fact.record, 'teamName')}] {pick(fact.record, 'changeTitle') or '(无标题)'} → {tokens}")

    if core:
        print("\n时间线：")
        for fact in core[:25]:
            print(
                "- {start} -> {end} [{team}] {itsm_id} {title} ({envc}/{statusc}){phased}".format(
                    start=fact.start.strftime("%m-%d %H:%M"),
                    end=fact.end.strftime("%m-%d %H:%M"),
                    team=pick(fact.record, "teamName"),
                    itsm_id=pick(fact.record, "itsmId"),
                    title=pick(fact.record, "changeTitle") or "(无标题)",
                    envc=fact.env_class,
                    statusc=fact.status_class,
                    phased=" [分阶段]" if fact.phased else "",
                )
            )
        if len(core) > 25:
            print(f"- 还有 {len(core) - 25} 条未展示。")

    if boundary:
        print("\n窗口边缘（缓冲区内、与窗口内变更相邻，供参考）：")
        for fact in boundary[:10]:
            print(
                "- {start} -> {end} [{team}] {itsm_id} {title}".format(
                    start=fact.start.strftime("%m-%d %H:%M"),
                    end=fact.end.strftime("%m-%d %H:%M"),
                    team=pick(fact.record, "teamName"),
                    itsm_id=pick(fact.record, "itsmId"),
                    title=pick(fact.record, "changeTitle") or "(无标题)",
                )
            )

    if excluded:
        print("\n被排除（未计入主分析，供判断参考）：")
        for item in excluded[:15]:
            print(f"- {item['itsmId']} [{item['teamName']}] {item['title'] or '(无标题)'}：{item['reason']}")
        if len(excluded) > 15:
            print(f"- 还有 {len(excluded) - 15} 条未展示。")


def main() -> int:
    args = parse_args()
    policy = load_policy(args.rules_dir)
    begin, end, include_closed = normalize_time_filters(args)
    teams = team_scope(args, policy)
    plan_end_date = (end + timedelta(minutes=policy.buffer_minutes)).strftime("%Y-%m-%d")

    try:
        records, metadata = load_source_records(args, teams, plan_end_date)
        facts, excluded = build_facts(records, begin, end, policy, include_closed, args.include_non_production)
        pairs = build_pairs(facts, policy, args.include_same_team_pairs, args.overlap_by_steps)
        # 仅保留窗口内变更，以及确实与窗口内变更配对的边缘变更，避免时间线噪声。
        paired_ids = {pid for pair in pairs for pid in (pair["a"], pair["b"])}
        facts = [f for f in facts if f.in_window or pick(f.record, "itsmId") in paired_ids]
        core = [f for f in facts if f.in_window]
        aggregate = build_aggregate(core, pairs, begin, end)
    except Exception as exc:  # noqa: BLE001 - 顶层统一报错
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    if args.output == "json":
        print(
            json.dumps(
                {
                    "window": {
                        "begin": begin.strftime("%Y-%m-%d %H:%M:%S"),
                        "end": end.strftime("%Y-%m-%d %H:%M:%S"),
                        "bufferMinutes": policy.buffer_minutes,
                    },
                    "teamsQueried": teams,
                    "filters": {
                        "includeClosed": include_closed,
                        "includeNonProduction": args.include_non_production,
                        "mainAnalysisEnvClasses": policy.main_env_classes,
                        "overlapBasis": "steps" if args.overlap_by_steps else "changeWindow",
                    },
                    "metadata": metadata,
                    "changes": [fact_to_dict(f) for f in facts],
                    "pairs": pairs,
                    "aggregate": aggregate,
                    "excluded": excluded,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print_text(begin, end, teams, facts, pairs, aggregate, excluded, metadata, policy, include_closed, args.include_non_production, args.overlap_by_steps)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
