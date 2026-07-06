---
name: ops-knowledge
description: 生产子系统运维知识图谱框架。两大核心用例：(1) 消费——处理生产问题、排查故障、执行发布、查询依赖/接口/配置、评估变更影响、定位告警根因时，加载已有子系统的图谱和文档；(2) 抽取——从架构文档、运维手册、CMDB 导出等原始资料中抽取新子系统画像并沉淀为结构化知识图谱。当提到已注册的子系统名称、运维场景、或用户要求"抽取/构建/录入子系统画像"时自动触发。
---

# 生产运维知识库（知识图谱增强版）

## 定位

本 Skill 是**个人运维工作台**：每个 SRE/开发基于此模板建立自己的 skill 实例，为所负责的 1-3 个子系统沉淀知识图谱和运维文档，配合 agent 处理告警、变更、故障排查。

**不是**：全公司统一的知识库。本 skill 实例的范围 = 使用者负责的子系统集合。

## 概述

本 Skill 为使用者负责的每个子系统维护两类知识：

1. **知识图谱数据**（YAML 文件）— 实体定义、功能点、业务场景、按类型拆分的关系文件
2. **运维文档**（Markdown 文件）— 发布窗口、接口规范、依赖说明、故障排查

SOP 存放在子系统目录内，Incident 在本实例内按年份归档。

**确认模式**：抽取和录入数据时，模型只录入有依据的信息。推断内容必须先征得用户确认。每条关系标注置信度：`confirmed`（已确认）| `inferred`（推断）| `uncertain`（存疑）。详见 `references/extraction-protocol.md`。

## 目录结构总览

```
ops-knowledge/                   # Skill 根目录
├── SKILL.md                     # 本文件（升级时直接覆盖）
├── scripts/
│   └── validate.py              # 校验脚本（升级时直接覆盖）
├── references/                  # 规范与模板（升级时直接覆盖）
│   ├── schema.md
│   ├── extraction-protocol.md
│   ├── maintenance-guide.md
│   ├── cross-subsystem-query.md
│   ├── sop-guide.md
│   └── templates/               # 各类文件的空模板
│       ├── index.md
│       ├── subsystem/
│       ├── sop/sop.md
│       └── incident/incident.md
└── data/                        # 用户数据（升级时保留，不覆盖）
    ├── README.md
    ├── index.md                 # 本实例子系统索引
    ├── {subsystem}/             # 各子系统数据
    └── incidents/{year}/        # 历史故障记录
```

**关键约定**：升级 skill 时只覆盖 `SKILL.md`、`references/`、`scripts/`，**绝不覆盖 `data/`**。详见 `data/README.md`。

## 快速上手

**第一次使用**（初始化实例）：
1. 读 `references/extraction-protocol.md` 了解抽取规则和确认模式
2. 创建数据目录骨架：`mkdir -p data/incidents && cp references/templates/index.md data/index.md`
3. 为第一个子系统复制模板：`cp -r references/templates/subsystem/ data/{name}/`
4. 向 agent 提供子系统资料（架构文档、运维手册），按确认模式逐步录入
5. 更新 `data/index.md` 登记新子系统
6. 运行 `python3 scripts/validate.py .` 验证

**日常使用**：
- 告警/故障 → agent 加载 `data/{subsystem}/metadata.yaml` + 相关 `relations/*.yaml` 做 RCA
- 变更评估 → agent 读 `depends_on.yaml` + `supports.yaml` 评估爆炸半径
- 故障恢复后 → 按 `references/extraction-protocol.md` 末尾的"图谱回写检查清单"更新图谱
- 周期性 → `python3 scripts/validate.py .` 检查数据一致性

**升级 skill**：
- 使用 `rsync -av --exclude='data/' new-version/ ./` 升级，避免覆盖用户数据
- 升级后重新运行 `python3 scripts/validate.py .` 确保数据与新规范兼容

## 使用流程

### 1. 定位子系统

根据用户提到的子系统名称，在索引表中查找对应目录。全局索引见 `data/index.md`。

### 2. 加载知识

- **推理场景**（告警、故障、变更评估）→ 读 `metadata.yaml` + 按需读相关 `relations/*.yaml`
- **操作场景**（发布、配置、接口调用）→ 读对应运维文档
- **抽取场景**（从原始资料构建/补充图谱）→ 先读 `references/extraction-protocol.md`，按协议执行
- **复合场景** → 按需组合

按需加载关系文件是核心优化——做 RCA 只需读 `depends_on.yaml` + `runs_on.yaml`，不必加载全部关系。

### 3. 图谱查询

给定实体，沿关系链查找关联实体。跨子系统查询见 `references/cross-subsystem-query.md`。

## 本实例子系统

使用者负责的子系统列表见 `data/index.md`。新增子系统时只需更新该文件。

典型规模：1-3 个子系统（按使用者实际负责范围）。

## 子系统目录结构

```
data/{subsystem}/
├── metadata.yaml               # 实体定义 + 基本信息
├── functions.yaml              # 功能点清单
├── business-scenarios.yaml     # 业务场景
├── relations/                  # 关系文件（按类型拆分）
│   ├── depends_on.yaml         # 上下游依赖
│   ├── runs_on.yaml            # 部署关系
│   ├── supports.yaml           # 业务支撑
│   ├── owned_by.yaml           # 负责人
│   ├── configured_with.yaml    # 配置关系
│   ├── has_monitoring.yaml     # 监控覆盖
│   ├── synced_with.yaml        # 数据一致性
│   ├── has_risk.yaml           # 风险项
│   ├── is_mitigated_by.yaml    # SOP 缓解
│   ├── is_automated_by.yaml    # 自动化脚本
│   ├── located_in.yaml         # 位置关系
│   └── was_changed_by.yaml     # 变更记录
├── sop/                        # 本子系统的 SOP
│   └── sop-{topic}.md
├── index.md                    # 子系统概览
├── deploy.md                   # 发布与变更
├── api.md                      # 关键接口
├── deps.md                     # 依赖说明
└── troubleshoot.md             # 故障排查
```

### 推理场景的关系文件选择

| 场景 | 需要加载的关系文件 |
|------|------------------|
| RCA 根因分析 | `depends_on.yaml` + `runs_on.yaml` |
| 爆炸半径评估 | `depends_on.yaml` + `supports.yaml` |
| 故障定级 | `supports.yaml` |
| 告警→SOP 匹配 | `is_mitigated_by.yaml` + `is_automated_by.yaml` |
| 变更回溯 | `was_changed_by.yaml` |
| 监控覆盖检查 | `has_monitoring.yaml` |
| 数据一致性检查 | `synced_with.yaml` |
| 关联故障/位置分析 | `located_in.yaml` + `runs_on.yaml` |
| 容量评估 | `metadata.yaml`(容量基线) + `has_monitoring.yaml`(容量面板) |

## 全局资源

### SOP

SOP 存放在各子系统目录下 `data/{subsystem}/sop/sop-{topic}.md`，与该子系统的实体和关系数据就近管理。在 `relations/is_mitigated_by.yaml` 中通过 SOP 实体 ID 关联。

少量跨子系统通用 SOP（如基础设施层通用操作）可放在 `references/sops/shared/`。

**SOP vs troubleshoot.md**: troubleshoot 排查定位未知问题，SOP 执行已知故障的标准处理。详见 `references/sop-guide.md`。

### Incident（全局）

```
data/incidents/{year}/incident-{YYYYMMDD}-{seq}.md
```

按年份归档。一个故障可能涉及多个子系统，因此 Incident 保持全局存放。通过 `was_changed_by.yaml`（触发变更）和 `is_mitigated_by.yaml`（处理 SOP）关联到图谱。

## Schema、维护和工具

- 完整数据 schema: `references/schema.md`
- 知识抽取协议: `references/extraction-protocol.md`
- 图谱维护指引: `references/maintenance-guide.md`
- 跨子系统查询: `references/cross-subsystem-query.md`
- SOP 使用指南: `references/sop-guide.md`
- 数据校验: `python3 scripts/validate.py .`（检查 ID 唯一性、悬空引用、T1 完整性）

## 模板

新建子系统: 复制 `references/templates/subsystem/` 到 `data/{name}/`
新建 SOP: 复制 `references/templates/sop/sop.md` 到 `data/{subsystem}/sop/`
新建 Incident: 复制 `references/templates/incident/incident.md` 到 `data/incidents/{year}/`
