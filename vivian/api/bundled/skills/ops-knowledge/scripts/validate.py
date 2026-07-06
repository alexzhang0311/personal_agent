#!/usr/bin/env python3
"""ops-knowledge 图谱数据校验工具

校验规则:
1. 实体 ID 全局唯一且格式正确
2. 关系中的 from/to 指向已定义的实体（悬空引用检测）
3. T1 实体必须有 owner 和 oncall
4. 关系文件属于已知的 12 种类型
5. 同一关系文件中无重复 from+to
6. 索引文件 index.md 与实际子系统目录一致

依赖: PyYAML (pip install pyyaml)

用法:
    python3 validate.py <ops-knowledge-root>

示例:
    python3 validate.py .
    python3 validate.py /path/to/ops-knowledge
"""

import sys
import os
import glob
from pathlib import Path

try:
    import yaml
except ImportError:
    print("错误: 需要 PyYAML")
    print("安装方式:")
    print("  pip install pyyaml")
    print("  pip install pyyaml --break-system-packages  (如果上面报错)")
    sys.exit(1)


def load_yaml(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        return {"_error": str(e)}


def find_subsystems(data_dir):
    """找到所有子系统目录（含 metadata.yaml 的目录）"""
    subsystems = {}
    for meta_path in glob.glob(os.path.join(data_dir, "*/metadata.yaml")):
        sub_dir = os.path.dirname(meta_path)
        sub_name = os.path.basename(sub_dir)
        subsystems[sub_name] = sub_dir
    return subsystems


def validate(root_dir):
    errors = []
    warnings = []

    # 确定 data 目录
    data_dir = root_dir
    if os.path.isdir(os.path.join(root_dir, "data")):
        data_dir = os.path.join(root_dir, "data")

    subsystems = find_subsystems(data_dir)
    if not subsystems:
        print(f"未找到子系统目录（在 {data_dir} 下查找含 metadata.yaml 的目录）")
        print("如果尚未初始化或创建子系统，这是正常的。")
        return errors, warnings

    # === 收集所有实体 ===
    all_entities = {}  # id -> (subsystem, entity_data)
    entity_ids_per_file = {}  # 用于检测重复

    for sub_name, sub_dir in subsystems.items():
        meta = load_yaml(os.path.join(sub_dir, "metadata.yaml"))
        if "_error" in meta:
            errors.append(f"[{sub_name}] metadata.yaml 解析失败: {meta['_error']}")
            continue

        for entity in meta.get("entities", []) or []:
            eid = entity.get("id", "")
            if not eid:
                errors.append(f"[{sub_name}] metadata.yaml 中有实体缺少 id")
                continue

            # 检查 ID 格式
            parts = eid.split(":")
            if len(parts) < 3:
                errors.append(f"[{sub_name}] 实体 ID 格式错误: '{eid}'（应为 type:subsystem:name）")

            # 检查全局唯一性
            if eid in all_entities:
                prev_sub = all_entities[eid][0]
                errors.append(f"[{sub_name}] 实体 ID 重复: '{eid}'（已在 {prev_sub} 中定义）")
            else:
                all_entities[eid] = (sub_name, entity)

            # 检查 T1 实体的 owner/oncall
            tier = entity.get("tier", "")
            if tier == "T1":
                if not entity.get("owner"):
                    warnings.append(f"[{sub_name}] T1 实体 '{eid}' 缺少 owner")
                if not entity.get("oncall"):
                    warnings.append(f"[{sub_name}] T1 实体 '{eid}' 缺少 oncall")

    # === 校验关系 ===
    RELATION_TYPE_MAP = {
        "depends_on.yaml": "DependsOn",
        "runs_on.yaml": "RunsOn",
        "supports.yaml": "Supports",
        "owned_by.yaml": "OwnedBy",
        "configured_with.yaml": "ConfiguredWith",
        "has_monitoring.yaml": "HasMonitoring",
        "synced_with.yaml": "SyncedWith",
        "has_risk.yaml": "HasRisk",
        "is_mitigated_by.yaml": "IsMitigatedBy",
        "is_automated_by.yaml": "IsAutomatedBy",
        "located_in.yaml": "LocatedIn",
        "was_changed_by.yaml": "WasChangedBy",
    }

    for sub_name, sub_dir in subsystems.items():
        rel_dir = os.path.join(sub_dir, "relations")
        if not os.path.isdir(rel_dir):
            continue

        for rel_file in glob.glob(os.path.join(rel_dir, "*.yaml")):
            fname = os.path.basename(rel_file)
            data = load_yaml(rel_file)
            if "_error" in data:
                errors.append(f"[{sub_name}] {fname} 解析失败: {data['_error']}")
                continue

            # 检查关系文件是否属于已知类型
            if fname not in RELATION_TYPE_MAP:
                warnings.append(f"[{sub_name}] 未知的关系文件: {fname}（已知类型: {', '.join(RELATION_TYPE_MAP.keys())}）")

            relations = data.get("relations", []) or []
            seen_pairs = set()

            for i, rel in enumerate(relations):
                from_id = rel.get("from", "")
                to_id = rel.get("to", "")

                # 检查 from/to 存在性
                if from_id and from_id not in all_entities:
                    errors.append(f"[{sub_name}] {fname} 第{i+1}条: from '{from_id}' 未定义")
                if to_id and to_id not in all_entities:
                    # 允许引用非图谱标识（如 ownership:*, change:*, monitoring:*）
                    if not any(to_id.startswith(p) for p in ("ownership:", "change:", "monitoring:", "location:", "risk:")):
                        warnings.append(f"[{sub_name}] {fname} 第{i+1}条: to '{to_id}' 未在任何子系统中定义（可能是跨子系统引用或尚未录入）")

                # 检查重复关系
                pair = (from_id, to_id)
                if pair in seen_pairs:
                    errors.append(f"[{sub_name}] {fname} 重复关系: {from_id} -> {to_id}")
                seen_pairs.add(pair)

    # === 校验索引一致性 ===
    index_path = os.path.join(data_dir, "index.md")
    if os.path.isfile(index_path):
        with open(index_path, 'r', encoding='utf-8') as f:
            index_content = f.read()
        # 检查实际子系统是否在索引中被提及
        for sub_name in subsystems:
            if sub_name not in index_content:
                warnings.append(f"子系统 '{sub_name}' 存在目录但未在 data/index.md 中登记")

    # === 输出结果 ===
    print(f"\n{'='*60}")
    print(f"ops-knowledge 校验报告")
    print(f"{'='*60}")
    print(f"子系统数量: {len(subsystems)}")
    print(f"实体总数: {len(all_entities)}")
    print()

    if errors:
        print(f"❌ 错误 ({len(errors)}):")
        for e in errors:
            print(f"  - {e}")
        print()

    if warnings:
        print(f"⚠️  警告 ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")
        print()

    if not errors and not warnings:
        print("✅ 全部通过，未发现问题。")

    return errors, warnings


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"用法: python3 {sys.argv[0]} <ops-knowledge-root>")
        sys.exit(1)

    root = sys.argv[1]
    if not os.path.isdir(root):
        print(f"错误: 目录不存在: {root}")
        sys.exit(1)

    errs, warns = validate(root)
    sys.exit(1 if errs else 0)
