#!/usr/bin/env python3
"""build_change_timeline 事实层单元测试。直接运行：python3 scripts/tests/test_timeline.py"""
import sys
import traceback
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_change_timeline as t  # noqa: E402

POLICY = t.Policy(
    buffer_minutes=60,
    default_teams=[],
    production_tokens=["生产环境", "云生产环境"],
    nonproduction_tokens=["准生产", "测试", "UAT", "uat", "开发"],
    main_env_classes=["production", "cloud-production"],
    closed_tokens=["已关闭", "已完成", "已取消"],
    component_tokens=["数据库", "TDSQL", "WEMQ", "Redis", "TiDB"],
    operation_tokens=["主备切换", "缩容", "滚动升级", "信创改造"],
)


def _fact(itsm, team, start, end, in_window=True, env="production", status="open", comps=None):
    return t.ChangeFact(
        record={"itsmId": itsm, "teamName": team, "changeTitle": itsm},
        start=start, end=end, in_window=in_window, env_class=env, status_class=status, components=comps or [],
    )


def _millis(y, mo, d, h, mi=0):
    """北京墙钟时间 -> epoch 毫秒（与 parse_epoch_millis 的换算互逆）。"""
    from datetime import timezone, timedelta
    bj = datetime(y, mo, d, h, mi, tzinfo=timezone(timedelta(hours=8)))
    return int(bj.timestamp() * 1000)


def test_classify_env():
    assert t.classify_env("生产环境", POLICY) == "production"
    assert t.classify_env("云生产环境", POLICY) == "cloud-production"
    assert t.classify_env("准生产环境", POLICY) == "non-production"
    assert t.classify_env("测试环境", POLICY) == "non-production"
    # 混合：生产 + 准生产 -> mixed（旧实现会误判为非生产并丢弃）
    assert t.classify_env("生产环境,准生产环境", POLICY) == "mixed"
    assert t.classify_env("生产环境、云生产环境", POLICY) == "production"
    assert t.classify_env("", POLICY) == "unknown"
    assert t.classify_env("未知环境X", POLICY) == "unknown"


def test_component_signals_ignore_team():
    # 团队名含“数据库”但标题/描述无风险词 -> 不应命中（旧实现会误命中）
    rec = {"changeTitle": "例行巡检", "changeDesc": "无变更动作", "teamName": "数据库运维室"}
    assert t.component_signals(rec, POLICY) == []
    # 标题确有 TDSQL -> 命中
    rec2 = {"changeTitle": "TDSQL 主从切换", "changeDesc": "", "teamName": "业务系统运营室"}
    tokens = [c["token"] for c in t.component_signals(rec2, POLICY)]
    assert "TDSQL" in tokens


def test_component_and_operation_signals():
    # TiDB 大版本升级：组件命中 TiDB（之前漏），操作命中 滚动升级
    rec = {"changeTitle": "TiDB 大版本升级", "changeDesc": "tiup 滚动升级集群", "teamName": "数据库运维室"}
    comps = [c["token"] for c in t.component_signals(rec, POLICY)]
    ops = [c["token"] for c in t.operation_signals(rec, POLICY)]
    assert "TiDB" in comps
    assert "滚动升级" in ops
    # 主备切换：操作信号命中，团队名不参与扫描
    rec2 = {"changeTitle": "ADR set 主备切换", "changeDesc": "", "teamName": "数据库运维室"}
    assert "主备切换" in [c["token"] for c in t.operation_signals(rec2, POLICY)]
    # 纯巡检：组件与操作均不命中
    rec3 = {"changeTitle": "例行巡检", "changeDesc": "只读检查", "teamName": "数据库运维室"}
    assert t.component_signals(rec3, POLICY) == [] and t.operation_signals(rec3, POLICY) == []


def test_overlap_and_gap():
    d = datetime
    a0, a1 = d(2026, 5, 18, 9), d(2026, 5, 18, 10)
    b0, b1 = d(2026, 5, 18, 10, 30), d(2026, 5, 18, 11, 30)
    assert t.intervals_overlap(a0, a1, b0, b1) is False
    assert t.gap_minutes(a0, a1, b0, b1) == 30
    c0, c1 = d(2026, 5, 18, 9, 30), d(2026, 5, 18, 10, 30)
    assert t.intervals_overlap(a0, a1, c0, c1) is True
    assert t.overlap_minutes(a0, a1, c0, c1) == 30


def test_buffer_is_not_doubled():
    d = datetime
    # 间隔 90 分钟，> 60 缓冲，不应配对（旧实现两边都扩 buffer，实际阈值变成 120 分钟）
    f1 = _fact("A", "网络运维室", d(2026, 5, 18, 9), d(2026, 5, 18, 10))
    f2 = _fact("B", "业务系统运营室", d(2026, 5, 18, 11, 30), d(2026, 5, 18, 12, 30))
    assert t.build_pairs([f1, f2], POLICY) == []
    # 间隔 30 分钟 -> adjacent
    f3 = _fact("C", "业务系统运营室", d(2026, 5, 18, 10, 30), d(2026, 5, 18, 11, 30))
    pairs = t.build_pairs([f1, f3], POLICY)
    assert len(pairs) == 1 and pairs[0]["relation"] == "adjacent" and pairs[0]["gapMinutes"] == 30


def test_pairs_drop_same_team_by_default():
    d = datetime
    # 两条同团队、真实重叠的变更
    f1 = _fact("A", "业务系统运营室", d(2026, 5, 18, 9), d(2026, 5, 18, 11))
    f2 = _fact("B", "业务系统运营室", d(2026, 5, 18, 10), d(2026, 5, 18, 12))
    assert t.build_pairs([f1, f2], POLICY) == []  # 默认丢弃同团队对
    kept = t.build_pairs([f1, f2], POLICY, include_same_team=True)
    assert len(kept) == 1 and kept[0]["relation"] == "overlap"
    # 跨团队对始终保留
    f3 = _fact("C", "网络运维室", d(2026, 5, 18, 10), d(2026, 5, 18, 12))
    assert len(t.build_pairs([f1, f3], POLICY)) == 1


def test_parse_epoch_millis_roundtrip():
    assert t.parse_epoch_millis(_millis(2026, 5, 19, 12)) == datetime(2026, 5, 19, 12, 0, 0)
    assert t.parse_epoch_millis(0) is None
    assert t.parse_epoch_millis("") is None
    assert t.parse_epoch_millis(None) is None


def test_extract_steps_phased_and_intervals():
    # 灰度/全量两阶段（连续）-> 分阶段，合并为 1 段
    rec = {"changeStepList": [
        {"stepName": "灰度", "stepDesc": "灰度发布", "teamName": "T", "startTime": _millis(2026, 5, 19, 12), "endTime": _millis(2026, 5, 21, 12)},
        {"stepName": "全量", "stepDesc": "全量", "teamName": "T", "startTime": _millis(2026, 5, 21, 12), "endTime": _millis(2026, 5, 29, 23)},
    ]}
    steps, intervals, phased = t.extract_steps(rec)
    assert len(steps) == 2 and steps[0]["start"] == "2026-05-19 12:00:00"
    assert phased is True and len(intervals) == 1
    # 所有步骤等于变更窗口 -> 不分阶段
    rec2 = {"changeStepList": [
        {"stepName": "a", "startTime": _millis(2026, 5, 20, 0), "endTime": _millis(2026, 6, 3, 0)},
        {"stepName": "b", "startTime": _millis(2026, 5, 20, 0), "endTime": _millis(2026, 6, 3, 0)},
    ]}
    _, ivs2, phased2 = t.extract_steps(rec2)
    assert phased2 is False and len(ivs2) == 1
    # 无有效步骤时间 -> 空区间、不分阶段
    rec3 = {"changeStepList": [{"stepName": "x", "startTime": 0, "endTime": 0}]}
    steps3, ivs3, phased3 = t.extract_steps(rec3)
    assert len(steps3) == 1 and ivs3 == [] and phased3 is False


def test_overlap_by_steps_respects_gaps():
    d = datetime
    # A 变更窗口 09-22，但实际只在 09-10 和 21-22 活跃（中间有空档）
    a = _fact("A", "数据库运维室", d(2026, 5, 18, 9), d(2026, 5, 18, 22))
    a.step_intervals = [(d(2026, 5, 18, 9), d(2026, 5, 18, 10)), (d(2026, 5, 18, 21), d(2026, 5, 18, 22))]
    b = _fact("B", "业务系统运营室", d(2026, 5, 18, 12), d(2026, 5, 18, 13))
    # 默认按变更窗口：A 09-22 覆盖 B 12-13 -> overlap
    assert t.build_pairs([a, b], POLICY)[0]["relation"] == "overlap"
    # 按步骤：A 活跃段不含 12-13，最近间隔 120 分钟 > 60 -> 无配对
    assert t.build_pairs([a, b], POLICY, by_steps=True) == []


def test_peak_concurrency():
    d = datetime
    begin, end = d(2026, 5, 18, 0, 0), d(2026, 5, 18, 23, 59, 59)
    core = [
        _fact("A", "网络运维室", d(2026, 5, 18, 9), d(2026, 5, 18, 11)),
        _fact("B", "数据库运维室", d(2026, 5, 18, 10), d(2026, 5, 18, 12)),
        _fact("C", "主机运维室", d(2026, 5, 18, 10, 30), d(2026, 5, 18, 10, 45)),
    ]
    assert t.peak_concurrency(core, begin, end) == 3
    # 首尾相接不计为并发
    seq = [
        _fact("A", "网络运维室", d(2026, 5, 18, 9), d(2026, 5, 18, 10)),
        _fact("B", "数据库运维室", d(2026, 5, 18, 10), d(2026, 5, 18, 11)),
    ]
    assert t.peak_concurrency(seq, begin, end) == 1


def test_build_facts_excludes_but_reports():
    d = datetime
    begin, end = d(2026, 5, 18, 0, 0), d(2026, 5, 18, 23, 59, 59)
    records = [
        {"itsmId": "P", "teamName": "主机运维室", "changeTitle": "生产变更", "envs": "生产环境",
         "changeStatusName": "执行中", "changePlanStartDate": "2026-05-18 10:00:00", "changePlanEndDate": "2026-05-18 11:00:00"},
        {"itsmId": "M", "teamName": "主机运维室", "changeTitle": "混合环境变更", "envs": "生产环境,准生产环境",
         "changeStatusName": "执行中", "changePlanStartDate": "2026-05-18 10:00:00", "changePlanEndDate": "2026-05-18 11:00:00"},
        {"itsmId": "D", "teamName": "主机运维室", "changeTitle": "已完成变更", "envs": "生产环境",
         "changeStatusName": "已完成", "changePlanStartDate": "2026-05-18 10:00:00", "changePlanEndDate": "2026-05-18 11:00:00"},
    ]
    facts, excluded = t.build_facts(records, begin, end, POLICY, include_closed=False, include_non_production=False)
    ids = {t.pick(f.record, "itsmId") for f in facts}
    assert ids == {"P"}
    excluded_ids = {e["itsmId"] for e in excluded}
    assert excluded_ids == {"M", "D"}  # 混合环境与已完成都被排除但报告，未静默丢弃


def run() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}")
                traceback.print_exc()
    print(f"\n{'OK' if not failed else 'FAILED'}：{failed} 个用例失败")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
