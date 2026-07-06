# 知识抽取协议

本文档定义了从原始资料（架构文档、运维手册、CMDB 导出、告警规则等）中抽取知识并填充到 ops-knowledge 各文件的标准流程和判断规则。目标是确保不同 agent 面对同一份资料，抽取出一致的结构。

## 核心原则：确认模式

**只录入有依据的信息。模型推断的内容必须先征得用户确认。**

1. **用户明确提供的** → 直接录入，标记 `confidence: confirmed`
2. **从资料中合理推断的** → 列出推断内容，问用户"以下是我从资料中推断的，是否正确？"确认后录入，标记 `confidence: inferred`
3. **不确定的** → 问用户。用户也不确定则标记 `confidence: uncertain` 录入，或直接跳过
4. **用户没提到、资料里也没有的** → **不录入，不猜测**

具体约束：
- 用户说"A 子系统是做交易的"，只建子系统基本信息，不要自动推测它有 MySQL、Redis、Kafka
- 用户没提到的字段一律留空，不要根据子系统名称或常见架构猜测 tier、owner、容量
- 需要补充信息才能完整填写时，**问用户**而不是自己编造
- 如果模型认为某个关系"应该存在"但资料中没有明确依据，必须先向用户确认

### confidence 置信度标签

每条关系必须标注置信度：

| 值 | 含义 | 适用场景 |
|----|------|---------|
| `confirmed` | 已确认 | 用户明确告知、文档中明确写明、生产环境已验证 |
| `inferred` | 推断 | 从资料中合理推断且经用户确认 |
| `uncertain` | 存疑 | 用户也不确定、信息来源可靠性不高 |

不填时默认视为 `confirmed`。推理消费时的使用规则：
- **RCA 根因分析**：优先沿 `confirmed` 路径，`inferred` 作为补充，`uncertain` 在输出中标注不确定性
- **爆炸半径评估**：三种都纳入，但按置信度分级展示
- **故障处理后**：如果某条 `inferred` 关系被故障验证了，应升级为 `confirmed`

## 抽取流程

按以下顺序处理原始资料，每步产出对应文件：

```
Step 1: 识别子系统边界 → 创建子系统目录
Step 2: 抽取实体 → metadata.yaml
Step 3: 抽取功能点 → functions.yaml
Step 4: 抽取业务场景 → business-scenarios.yaml
Step 5: 抽取关系 → relations/*.yaml
Step 6: 补充运维文档 → index/deploy/api/deps/troubleshoot.md
Step 7: 关联 SOP 和 Incident → sop/ 和 is_mitigated_by.yaml
```

严格按此顺序执行——实体必须先于关系存在，功能点和场景依赖实体定义。

## Step 1: 识别子系统边界

**判断标准**：一个子系统是一组共同完成某个业务领域职责、由同一团队维护的组件集合。

**边界信号**：
- 有独立的代码仓库或部署单元
- 有独立的负责人/OnCall 排班
- 有独立的发布窗口
- 在架构图中被框为一个模块

**反面信号**（不应拆分为独立子系统）：
- 只是同一服务的不同实例
- 只是同一数据库的不同表
- 共享同一发布流程和负责人的多个微服务（归为一个子系统）

## Step 2: 抽取实体

### 实体类型判断规则

从原始资料中识别到一个组件时，按以下规则确定 type：

| 如果它是... | type | 典型线索 |
|------------|------|---------|
| 对外提供 API 或处理业务逻辑的进程 | `app` | "服务"、"应用"、端口号、deploy 配置 |
| MySQL/PostgreSQL/MongoDB 等 | `db` | "数据库"、连接串、SQL |
| Redis/Memcached | `cache` | "缓存"、"Redis" |
| Kafka/RabbitMQ/RocketMQ | `mq` | "消息队列"、"topic"、"consumer" |
| 物理机/虚拟机/容器宿主 | `host` | IP 地址、机器规格 |
| 面向用户的业务能力（不是具体进程） | `service` | "业务"、"能力"、SLA 承诺 |
| 配置文件/配置中心 key | `config` | "配置"、"apollo"、"nacos" |
| Nginx/HAProxy/云 LB | `lb` | "负载均衡"、"网关" |
| NFS/对象存储/块存储 | `storage` | "存储"、"挂载" |
| 交换机/防火墙/DNS/LB/代理/专线/证书/服务网格 | `network` | "网络"、"防火墙"、"DNS"、"负载均衡"、"代理"、"专线"、"证书"、"Istio" |
| K8s 集群/云平台 | `platform` | "集群"、"平台" |
| Prometheus 规则/Grafana 面板 | `monitoring` | "告警"、"监控"、"面板" |
| 标准操作流程文档 | `sop` | "SOP"、"操作手册"、"应急流程" |
| 可执行的自动化脚本/命令 | `script` | 脚本路径、cron 任务、自动化工具 |
| 已发生的历史故障记录 | `incident` | "故障"、"事故"、复盘报告、变更回滚 |

**关键区分**：
- `app` vs `service`: app 是具体可部署的进程，service 是面向用户的业务能力。一个 service 通常由多个 app 支撑。
- `app` vs `lb`: 如果它既做路由又做业务逻辑，按主要职责判断。纯路由转发用 `lb`。
- `network` vs `lb`: 七层应用负载均衡（Nginx/HAProxy/云 LB）用 `lb`；底层网络组件（DNS、防火墙、专线、证书等）用 `network` 并通过 `meta.subtype` 细分。
- 不确定时：优先选更具体的类型，避免滥用 `app`。

### network 实体的子类型规范

`network` 实体在 meta 中通过 `subtype` 字段细分具体类型。**字段值统一用英文 enum**，中文名仅用于在文档和 `name` 字段中显示。

| subtype（英文值） | 中文名 | 含义 | 典型实例 |
|------------------|--------|------|---------|
| `dns` | DNS 解析 | 域名解析服务 | 内网 DNS、公网 DNS、私有解析域 |
| `firewall` | 防火墙 | 防火墙规则/网段隔离 | 网段隔离、白名单条目 |
| `proxy` | 代理 | 代理服务/NAT 网关 | 出网代理、NAT 网关 |
| `tunnel` | 跨网通道 | 专线/VPN | 跨云专线、VPN |
| `cert` | 证书 | TLS/mTLS 证书 | mTLS、Let's Encrypt |
| `mesh` | 服务网格 | 服务网格配置 | Istio、Linkerd |
| `switch` | 网络设备 | 物理网络设备 | 交换机、路由器 |

示例：
```yaml
- id: "network:trading:internal-dns"
  type: "network"
  name: "内网 DNS 服务"
  meta:
    subtype: "dns"
    endpoint: "10.0.0.53:53"
    scope: "*.webank.com"

- id: "network:trading:tencent-huawei-tunnel"
  type: "network"
  name: "腾讯云-华为云专线"
  meta:
    subtype: "tunnel"
    bandwidth: "10Gbps"
    endpoints: ["tencent-vpc-1", "huawei-vpc-2"]
```

**网络层依赖建模注意事项**：
- DNS 故障常引发连锁问题，T1 应用应在 `depends_on.yaml` 中显式记录对 DNS 的依赖
- 防火墙规则不是单一实体，建议按"用途"聚合（如"out-to-third-party-api"代表一组出网白名单）
- 证书有过期时间，建议在 meta 中记录 `expires_at` 字段

### 实体属性填充规则

| 字段 | 规则 |
|------|------|
| `id` | 必填。格式 `{type}:{subsystem}:{name}`，name 用小写英文和连字符 |
| `name` | 必填。用中文显示名，简明扼要 |
| `tier` | 资料中有明确业务等级时填。无法判断时留空，不要猜 |
| `owner/oncall` | 资料中有明确信息时填字符串。无信息时留空 |
| `meta` | 资料中提到的技术细节（端口、版本、规格等）放这里。只填资料中明确提到的，不要推测 |

### 容量基线字段

| 字段 | 填充条件 |
|------|---------|
| `designed_qps` / `safe_qps` | 资料中有压测数据或设计文档时填 |
| `max_connections` / `safe_connections` | 资料中有 DB 配置或容量规划时填 |
| `scale_unit` | 资料中有扩容方案时填 |
| `bottleneck` / `degrade_strategy` | 资料中有性能分析或降级方案时填 |

**信息不足时**：留空或注释掉。不要编造数据。宁可少填也不要填错。

## Step 3: 抽取功能点

**什么算一个功能点**：子系统对外提供的一个可独立描述的能力。

**判断信号**：
- 有独立的 API 端点
- 在用户文档中被单独描述
- 有独立的开关或配置

**不是功能点**：
- 纯内部实现细节（"用了连接池"不是功能点）
- 非功能性需求（"支持高可用"不是功能点，但"主从切换"是）

**填充规则**：
- `depends_on_entities` 只填该功能直接依赖的实体，不要填间接依赖
- `criticality` 根据资料判断。无法判断时用 `normal`

## Step 4: 抽取业务场景

**什么算一个业务场景**：从用户视角出发的一次完整交互流程。

**判断信号**：
- 有明确的触发动作（用户点击、定时任务、外部回调）
- 有可描述的端到端流程
- 有业务价值（"用户下单"是场景，"数据库建连"不是）

**填充规则**：
- `flow` 中的实体 ID 按调用顺序排列
- `sla` 和 `peak_qps` 只在资料中有明确数据时填
- `business_impact` 必须从用户视角描述，不要用技术术语

## Step 5: 抽取关系

### 关系方向判断

关系方向容易搞混。核心规则是**从依赖方指向被依赖方**：

| 关系 | from 是谁 | to 是谁 | 记忆口诀 |
|------|----------|---------|---------|
| DependsOn | 需要别人的 | 被需要的 | "我依赖你" |
| RunsOn | 运行着的 | 承载的 | "我跑在你上面" |
| Supports | 支撑者 | 被支撑的业务 | "我支撑你" |
| OwnedBy | 被管的 | 管它的人/团队 | "我归你管" |
| ConfiguredWith | 用配置的 | 配置本身 | "我用你的配置" |
| HasMonitoring | 被监控的 | 监控规则/面板 | "我被你监控" |
| SyncedWith | 数据源 | 同步目标 | "我的数据同步到你" |
| HasRisk | 有风险的 | 风险项 | "我有这个风险" |
| IsMitigatedBy | 被缓解的 | SOP | "我被你缓解" |
| IsAutomatedBy | SOP | 脚本 | "我被你自动化" |
| LocatedIn | 在某处的 | 位置 | "我在你里面" |
| WasChangedBy | 被改的 | 变更单 | "我被你改过" |

### 关系文件归属

一条关系放在哪个文件，由**关系类型**决定，不由实体类型决定。"app 依赖 db" 放 `depends_on.yaml`，不要因为涉及 db 就放 `runs_on.yaml`。

### critical 判断

`critical: true` 的唯一标准：from 实体在 to 实体不可用时**完全无法工作**。如果有降级方案（即使降级后功能受损），则 `critical: false` 并在 `meta.fallback` 中写明降级方案。

### 关系抽取中的常见错误

- **错误**：把同一条依赖同时放在 `depends_on.yaml` 和 `runs_on.yaml` 里。每条依赖只放在最准确的一个关系文件中。
- **错误**：把"A 被 B 调用"建成 A DependsOn B。调用方向和依赖方向可能不同——如果 B 调用 A，但 A 不需要 B 就能工作，则不存在 DependsOn 关系。
- **错误**：跨子系统关系放在两边各一份。只放在 from 所在子系统的关系文件中。

## Step 6: 运维文档

运维文档用于补充图谱无法表达的信息。填充规则：

| 文件 | 从哪类资料抽取 | 注意事项 |
|------|-------------|---------|
| `index.md` | 架构文档、系统概述 | 简述即可，不要重复 metadata.yaml 的内容 |
| `deploy.md` | 发布流程文档、变更管理规范 | 重点是时间窗口和回滚方案 |
| `api.md` | API 文档、接口规范 | 只记录关键接口，不要列全部 |
| `deps.md` | 架构文档、调用链文档 | 补充 depends_on.yaml 无法表达的上下文 |
| `troubleshoot.md` | 故障复盘、运维经验 | 排查结论应指向具体 SOP |

**关键原则**：文档补充图谱，不重复图谱。如果信息已经在 YAML 中结构化了，文档里用一句话引用即可，不要复制粘贴。

## Step 7: SOP、Script 和 Incident

这三类实体不是从架构文档中抽取的，而是从运维实践中逐步沉淀的。

### SOP 抽取规则

**什么时候建 sop 实体**：当存在一份可重复执行的标准操作流程时。

**来源信号**：
- 运维手册中的"故障处理流程"
- 已有的应急预案文档
- 故障复盘中的"后续改进：编写 SOP"

**抽取步骤**：
1. 从模板创建 SOP 文件：`sop/sop-{topic}.md`
2. 在 `metadata.yaml` 中注册 sop 实体，meta 中填写 `file`（文件路径）、`severity`、`auto_rate`（自动化覆盖度百分比）
3. 在 `is_mitigated_by.yaml` 中建立关系：被缓解的实体 → sop，meta.trigger 写明触发条件
4. trigger 写法要具体可匹配（如 `"active_connections > 90%"`），不要模糊（如 `"数据库有问题"`）

**不要建 sop 实体的情况**：
- 只是一段口头经验，没有形成可执行步骤
- 处理流程因情况不同差异很大，无法标准化

### Script 抽取规则

**什么时候建 script 实体**：当 SOP 中的某些步骤有对应的可直接执行的脚本或命令时。

**抽取步骤**：
1. 在 `metadata.yaml` 中注册 script 实体，meta 中填写 `path`（脚本路径）、`command`（执行命令）、`safe_guard`（安全约束条件）
2. 在 `is_automated_by.yaml` 中建立关系：sop → script，meta 中填写 `covers_steps`（覆盖哪些步骤）、`approval_required`（是否需要人工审批）
3. 更新对应 sop 实体的 `meta.auto_rate`

**不要建 script 实体的情况**：
- 脚本只是一行简单命令（直接写在 SOP 步骤里即可）
- 脚本尚未验证过，无法保证安全执行

### Incident 抽取规则

**什么时候建 incident 实体**：当有一次已完成复盘的历史故障记录时。

**来源信号**：
- 故障复盘文档
- 变更回滚记录
- 事故报告邮件

**抽取步骤**：
1. 从模板创建 Incident 文件：`data/incidents/{year}/incident-{YYYYMMDD}-{seq}.md`
2. 在**根因所在子系统**的 `metadata.yaml` 中注册 incident 实体
3. meta 必填字段：`file`、`severity`、`occurred_at`、`duration_min`、`root_cause_category`
4. meta 中 `root_cause_chain` 按因果顺序列出实体 ID，`affected_entities` 列出所有受影响实体
5. 在根因子系统的 `was_changed_by.yaml` 中建立 incident→change 关系（如果是变更引发）
6. 在根因子系统的 `is_mitigated_by.yaml` 中建立 incident→sop 关系（如果使用了 SOP 处理）
7. 跨子系统影响不在其他子系统中重复注册，统一通过 `meta.affected_entities` 记录

**不要建 incident 实体的情况**：
- 故障尚未恢复或尚未完成复盘
- 只是一次小告警，没有实际业务影响

## 信息不足时的处理

| 情况 | 处理方式 |
|------|---------|
| 确定实体存在但细节不清 | 创建实体，meta 留空，加注释 `# TODO: 待补充` |
| 不确定是否存在某个实体 | 不创建。宁缺毋滥 |
| 知道有依赖但不确定具体类型 | 放 `depends_on.yaml`，meta 中注明 `# TODO: 确认具体交互方式` |
| 知道有关系但不确定方向 | 不创建。方向错误比缺失更有害 |
| 资料中有矛盾信息 | 不填入。在对应 md 文档中记录矛盾点，标记 `# CONFLICT: ...` |

## 图谱回写：故障处理后的更新检查

每次故障处理、SOP 执行或运维操作后，按以下清单检查图谱是否需要更新。这是知识沉淀的闭环——使用图谱解决问题后，将新发现反哺回图谱。

### 回写检查清单

| # | 检查项 | 操作 |
|---|--------|------|
| 1 | 这次故障是否需要新建 incident？ | 有业务影响 → 按 Step 7 的 Incident 抽取规则新建 |
| 2 | 是否发现了图谱中缺失的依赖关系？ | 排查中发现 A 实际依赖 B 但图谱没有 → 补到对应关系文件，标 `confirmed` |
| 3 | 现有关系的 confidence 是否需要升级？ | 之前标 `inferred` 的关系被故障验证了 → 改为 `confirmed` |
| 4 | 是否有关系被证实不存在或不准确？ | 排查中发现某条关系实际不成立 → 删除或标 `uncertain` 并加注释 |
| 5 | 是否需要新建或更新 SOP？ | 现有 SOP 不覆盖此故障 → 新建；SOP 步骤有误 → 更新 |
| 6 | 现有实体信息是否需要修正？ | 发现 metadata 里的容量基线过时 → 更新；实体属性有误 → 修正 |
| 7 | 是否需要补充监控覆盖？ | 排查中发现某实体无监控 → 补到 `has_monitoring.yaml` |

### 执行时机

- **故障恢复后**：立即执行检查项 1-4（趁记忆新鲜）
- **故障复盘会后**：执行检查项 5-7（复盘产出改进措施后）
- **SOP 执行后**：检查 SOP 是否有效，自动化覆盖度是否需要更新

### 原则

- 回写同样遵循确认模式：agent 发现需要更新时，列出变更内容让用户确认后再执行
- 每次回写后运行 `python3 scripts/validate.py .` 确保一致性
- 更新对应文件的 `version` 字段
