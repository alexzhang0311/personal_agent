#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx


# 中文化 argparse 内置帮助文案，避免 --help 混入英文模板。
_ARGPARSE_TRANSLATIONS = {
    "usage: ": "用法：",
    "options": "选项",
    "show this help message and exit": "显示帮助信息并退出",
}
argparse._ = lambda text: _ARGPARSE_TRANSLATIONS.get(text, text)

DEFAULT_CHANGE_URL = "http://10.107.98.250:9016/automation/encapsulation/queryChangeListPage"
TEAM_NAME_CHOICES = (
    "大数据平台室",
    "网络运维室",
    "主机运维室",
    "企业应用开发室",
    "一线运营室",
    "数据库运维室",
    "业务系统运营室",
    "中间件平台室",
)
DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
)
BEIJING_TZ = timezone(timedelta(hours=8))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="通过 ApiDesign 封装接口查询 ITSM 变更单。"
    )
    parser.add_argument(
        "--url",
        default=os.getenv("ITSM_QUERY_CHANGE_URL", DEFAULT_CHANGE_URL),
        help="变更单查询接口地址。默认读取 ITSM_QUERY_CHANGE_URL；未设置时使用 ApiDesign 文档中的地址。",
    )
    parser.add_argument("--operator", dest="operator", help="处理人企业微信英文名。")
    parser.add_argument("--itsm-id", "--itsmId", dest="itsm_id", help="ITSM 工单 ID。")
    parser.add_argument("--change-status-name", "--changeStatusName", dest="change_status_name", help="变更状态名称。")
    parser.add_argument("--team-name", "--teamName", dest="team_name", type=team_name_value, help="科室/团队名称，仅支持固定枚举。")
    parser.add_argument("--time-begin", dest="time_begin", help="查询时间区间开始；必须和 --time-end 成对使用。")
    parser.add_argument("--time-end", dest="time_end", help="查询时间区间结束；必须和 --time-begin 成对使用。")
    parser.add_argument("--date", dest="query_date", help="查询指定日期内有时间重叠的变更，格式 yyyy-MM-dd。")
    parser.add_argument("--current-week", action="store_true", help="查询当前周一至周日内有时间重叠的变更。")
    parser.add_argument("--current-page", type=int, default=1, help="起始页码，默认 1。")
    parser.add_argument("--page-size", type=int, default=100, help="每页大小，默认 100；脚本会限制在 1 到 100。")
    parser.add_argument(
        "--scan-all",
        action="store_true",
        help="在本地过滤前分页拉取数据，最多扫描 --max-pages 页。",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=50,
        help="使用 --scan-all 或响应字段过滤时最多扫描的页数。",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP 请求超时时间，单位秒。",
    )
    parser.add_argument(
        "--input-json",
        help="从指定文件读取已有 JSON 响应；传 '-' 时从标准输入读取，并只执行本地过滤。",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印请求参数，不实际调用接口。")
    parser.add_argument("--output", choices=("text", "json"), default="text", help="输出格式，默认为 text。")
    return parser.parse_args()


def clamp_page_size(page_size: int) -> int:
    if page_size < 1:
        return 1
    if page_size > 100:
        return 100
    return page_size


def team_name_value(value: str) -> str:
    if value in TEAM_NAME_CHOICES:
        return value
    choices = "、".join(TEAM_NAME_CHOICES)
    raise argparse.ArgumentTypeError(f"teamName 仅支持：{choices}")


def is_blank(value: Any) -> bool:
    return value is None or value == ""


def clean_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if not is_blank(value)}


def date_only(value: str | None) -> bool:
    return bool(value) and len(value.strip()) == 10


def current_week_range(today: date | None = None) -> tuple[str, str]:
    current = today or date.today()
    week_start = current - timedelta(days=current.weekday())
    week_end = week_start + timedelta(days=6)
    return week_start.isoformat(), week_end.isoformat()


def normalize_time_filters(args: argparse.Namespace) -> None:
    has_time_range = bool(args.time_begin or args.time_end)
    selected_groups = sum([has_time_range, bool(args.query_date), bool(args.current_week)])
    if selected_groups > 1:
        raise SystemExit("--time-begin/--time-end、--date、--current-week 三组时间条件互斥。")

    if has_time_range and not (args.time_begin and args.time_end):
        raise SystemExit("--time-begin 和 --time-end 必须成对使用。")

    if args.query_date:
        args.time_begin = args.query_date
        args.time_end = args.query_date

    if args.current_week:
        args.time_begin, args.time_end = current_week_range()

    if args.time_begin and args.time_end:
        begin = parse_query_bound(args.time_begin, is_end=False)
        end = parse_query_bound(args.time_end, is_end=True)
        if begin and end and begin > end:
            raise SystemExit("--time-begin 不能晚于 --time-end。")

    if args.time_begin and not parse_query_bound(args.time_begin, is_end=False):
        raise SystemExit(f"--time-begin 不是有效时间：{args.time_begin}")
    if args.time_end and not parse_query_bound(args.time_end, is_end=True):
        raise SystemExit(f"--time-end 不是有效时间：{args.time_end}")


def build_base_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload = {
        "operator": args.operator,
        "itsmId": args.itsm_id,
        "changeStatusName": args.change_status_name,
        "teamName": args.team_name,
        "pageSize": clamp_page_size(args.page_size),
    }

    return clean_payload(payload)


def client_side_scan_needed(args: argparse.Namespace) -> bool:
    return any(
        [
            args.itsm_id,
            args.change_status_name,
            args.time_begin,
            args.time_end,
        ]
    )


def post_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        response = httpx.post(url, json=payload, timeout=timeout)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"HTTP {exc.response.status_code}: {exc.response.text}") from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"请求失败：{exc}") from exc

    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"接口返回内容不是 JSON：{response.text[:500]}") from exc

    if isinstance(data, dict) and str(data.get("code", "0")) != "0":
        raise RuntimeError(f"接口返回失败：code={data.get('code')!r}, message={data.get('message')!r}")

    if not isinstance(data, dict):
        raise RuntimeError("接口响应必须是 JSON 对象。")

    return data


def load_input_json(path: str) -> Any:
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    return json.loads(text)


def find_records_container(data: dict[str, Any]) -> dict[str, Any]:
    candidates: list[Any] = []

    result = data.get("result")
    if isinstance(result, dict):
        result_data = result.get("data")
        if isinstance(result_data, dict):
            candidates.append(result_data)
        candidates.append(result)

    response_data = data.get("data")
    if isinstance(response_data, dict):
        candidates.append(response_data)

    candidates.append(data)

    for candidate in candidates:
        if isinstance(candidate, dict) and "records" in candidate:
            return candidate

    if isinstance(result, dict):
        return result
    return data


def extract_records(data: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if isinstance(data, list):
        return {}, [record for record in data if isinstance(record, dict)]

    if not isinstance(data, dict):
        raise ValueError("JSON 输入必须是对象，或记录数组。")

    container = find_records_container(data)
    records = container.get("records", [])
    if records is None:
        records = []
    if not isinstance(records, list):
        raise ValueError("JSON records 必须是数组。")

    return container, [record for record in records if isinstance(record, dict)]


def parse_temporal(value: Any) -> datetime | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is not None:
            return parsed.astimezone(BEIJING_TZ).replace(tzinfo=None)
        return parsed
    except ValueError:
        pass

    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text[: len(datetime.now().strftime(fmt))], fmt)
        except ValueError:
            continue
    return None


def parse_query_bound(value: Any, is_end: bool) -> datetime | None:
    parsed = parse_temporal(value)
    if parsed is None:
        return None
    if is_end and isinstance(value, str) and date_only(value):
        return parsed + timedelta(days=1) - timedelta(microseconds=1)
    return parsed


def same_text(record_value: Any, expected: str | None) -> bool:
    if not expected:
        return True
    if record_value is None:
        return False
    return str(record_value).strip() == expected.strip()


def matches_overlap(record: dict[str, Any], args: argparse.Namespace) -> bool:
    if not args.time_begin and not args.time_end:
        return True

    query_begin = parse_query_bound(args.time_begin, is_end=False) if args.time_begin else None
    query_end = parse_query_bound(args.time_end, is_end=True) if args.time_end else None
    record_start = parse_query_bound(record.get("changePlanStartDate"), is_end=False)
    record_end = parse_query_bound(record.get("changePlanEndDate"), is_end=True)

    if record_start is None and record_end is None:
        return False
    if record_start is None:
        record_start = record_end
    if record_end is None:
        record_end = record_start
    if record_start is None or record_end is None:
        return False
    if record_start > record_end:
        return False
    if query_end is not None and record_start > query_end:
        return False
    if query_begin is not None and record_end < query_begin:
        return False
    return True


def record_matches(record: dict[str, Any], args: argparse.Namespace) -> bool:
    return all(
        [
            same_text(record.get("operator"), args.operator),
            same_text(record.get("itsmId"), args.itsm_id),
            same_text(record.get("changeStatusName"), args.change_status_name),
            same_text(record.get("teamName"), args.team_name),
            matches_overlap(record, args),
        ]
    )


def filter_records(records: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    return [record for record in records if record_matches(record, args)]


def build_client_filters(args: argparse.Namespace) -> dict[str, Any]:
    filters = {
        "timeBegin": args.time_begin,
        "timeEnd": args.time_end,
    }
    return clean_payload(filters)


def fetch_records(args: argparse.Namespace, base_payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    should_scan = args.scan_all or client_side_scan_needed(args)
    current_page = max(args.current_page, 1)
    max_pages = max(args.max_pages, 1)
    all_records: list[dict[str, Any]] = []
    last_result: dict[str, Any] = {}
    scanned_pages = 0
    truncated = False

    while True:
        payload = dict(base_payload)
        payload["currentPage"] = current_page
        data = post_json(args.url, payload, args.timeout)
        result, records = extract_records(data)
        last_result = result
        all_records.extend(records)
        scanned_pages += 1

        total_page_raw = result.get("totalPage", current_page)
        try:
            total_page = int(total_page_raw)
        except (TypeError, ValueError):
            total_page = current_page

        if not should_scan:
            break
        if current_page >= total_page:
            break
        if scanned_pages >= max_pages:
            truncated = current_page < total_page
            break
        current_page += 1

    metadata = {
        "scannedPages": scanned_pages,
        "truncated": truncated,
        "sourceTotalCount": last_result.get("totalCount"),
        "sourceTotalPage": last_result.get("totalPage"),
    }
    return all_records, metadata


def pick(record: dict[str, Any], key: str) -> str:
    value = record.get(key)
    return "" if value is None else str(value)


def pick_time(record: dict[str, Any], key: str) -> str:
    value = record.get(key)
    parsed = parse_temporal(value)
    if parsed is None:
        return pick(record, key)
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def format_epoch_millis(value: Any) -> str:
    if value is None or value == "":
        return ""

    try:
        timestamp = float(value) / 1000
    except (TypeError, ValueError):
        parsed = parse_temporal(value)
        return parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed else str(value)

    return datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")


def parse_change_steps(record: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    raw_steps = record.get("changeStepList")
    if raw_steps is None or raw_steps == "":
        return [], ""

    if isinstance(raw_steps, str):
        try:
            parsed_steps = json.loads(raw_steps)
        except json.JSONDecodeError:
            return [], raw_steps
    else:
        parsed_steps = raw_steps

    if not isinstance(parsed_steps, list):
        return [], str(raw_steps)

    return [step for step in parsed_steps if isinstance(step, dict)], ""


def print_change_steps(record: dict[str, Any]) -> None:
    steps, raw_steps = parse_change_steps(record)
    if not steps and not raw_steps:
        print("   变更步骤: ")
        return

    print("   变更步骤:")
    if raw_steps:
        print(f"      {raw_steps}")
        return

    for index, step in enumerate(steps, start=1):
        title = pick(step, "stepName") or f"步骤 {index}"
        status = pick(step, "stepStatusName") or pick(step, "stepStatus")
        team = pick(step, "teamName")
        user = f"{pick(step, 'stepUserId')} {pick(step, 'stepUserName')}".strip()
        time_range = f"{format_epoch_millis(step.get('startTime'))} -> {format_epoch_millis(step.get('endTime'))}"
        desc = pick(step, "stepDesc")

        print(f"      {index}. {title}")
        if status:
            print(f"         状态: {status}")
        if team:
            print(f"         团队: {team}")
        if user:
            print(f"         处理人: {user}")
        if time_range.strip(" ->"):
            print(f"         时间: {time_range}")
        if desc:
            print(f"         描述: {desc}")


def print_text(records: list[dict[str, Any]], metadata: dict[str, Any]) -> None:
    print(f"匹配到 {len(records)} 条变更单记录。")
    print(
        "扫描页数：{scannedPages}；接口总数：{sourceTotalCount}；是否截断：{truncated}".format(
            **metadata
        )
    )
    if not records:
        return

    for index, record in enumerate(records, start=1):
        print()
        print(f"{index}. {pick(record, 'changeTitle') or '(无标题)'}")
        print(f"   itsmId: {pick(record, 'itsmId')}")
        print(f"   状态: {pick(record, 'changeStatusName') or pick(record, 'changeStatus')}")
        print(f"   科室: {pick(record, 'teamName')}")
        print(f"   处理人: {pick(record, 'operator')} {pick(record, 'operatorName')}".rstrip())
        print(f"   负责人: {pick(record, 'changeOwner')} {pick(record, 'changeOwnerName')}".rstrip())
        print(f"   计划时间: {pick_time(record, 'changePlanStartDate')} -> {pick_time(record, 'changePlanEndDate')}")
        print(f"   环境: {pick(record, 'envs')}")
        print(f"   变更描述: {pick(record, 'changeDesc')}")
        print_change_steps(record)


def main() -> int:
    args = parse_args()
    normalize_time_filters(args)
    base_payload = build_base_payload(args)

    if args.dry_run:
        dry_run = {
            "url": args.url,
            "payload": {**base_payload, "currentPage": max(args.current_page, 1)},
            "clientFilters": build_client_filters(args),
            "autoScanPages": args.scan_all or client_side_scan_needed(args),
            "maxPages": max(args.max_pages, 1),
            "clientSideFiltersApplied": True,
        }
        print(json.dumps(dry_run, ensure_ascii=False, indent=2))
        return 0

    try:
        if args.input_json:
            source_metadata, source_records = extract_records(load_input_json(args.input_json))
            metadata = {
                "scannedPages": 0,
                "truncated": False,
                "sourceTotalCount": source_metadata.get("totalCount"),
                "sourceTotalPage": source_metadata.get("totalPage"),
            }
            records = source_records
        else:
            records, metadata = fetch_records(args, base_payload)
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    filtered = filter_records(records, args)

    if args.output == "json":
        print(
            json.dumps(
                {
                    "url": args.url,
                    "payload": base_payload,
                    "clientFilters": build_client_filters(args),
                    "matchedCount": len(filtered),
                    "metadata": metadata,
                    "records": filtered,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print_text(filtered, metadata)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
