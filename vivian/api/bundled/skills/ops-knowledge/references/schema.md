# 数据 Schema 参考

## 文件结构总览

每个子系统目录包含以下 YAML 数据文件：

| 文件 | 内容 | 加载时机 |
|------|------|---------|
| `metadata.yaml` | 子系统信息 + 实体定义 | 每次涉及该子系统时 |
| `functions.yaml` | 功能点清单 | 分析功能依赖时 |
| `business-scenarios.yaml` | 业务场景 | 评估业务影响时 |
| `relations/{type}.yaml` | 按类型拆分的关系 | 按推理需要按需加载 |

## metadata.yaml

```yaml
subsystem: string       # 子系统标识
version: string         # 最后更新日期 YYYY-MM-DD
description: string
tier: "T1 | T2 | T3"
owner: string
oncall: string

entities:
  - id: string          # 全局唯一: {type}:{subsystem}:{name}
    type: string         # 见实体类型枚举
    name: string
    tier: string         # T1 | T2 | T3（可选）
    owner: string        # 可选
    oncall: string       # 可选
    tags: [string]       # 可选
    meta: object         # 自定义扩展（可选）
```

### 实体 ID 规范

格式: `{type}:{subsystem}:{name}`，全局唯一，跨子系统引用时使用完整 ID。

### 实体类型枚举

| type | 含义 |
|------|------|
| `app` | 应用/服务 |
| `db` | 数据库 |
| `cache` | 缓存 |
| `mq` | 消息队列 |
| `host` | 主机/节点 |
| `service` | 业务服务 |
| `config` | 配置 |
| `lb` | 负载均衡 |
| `storage` | 存储 |
| `network` | 网络设备/服务（通过 `meta.subtype` 细分：dns(DNS解析) / firewall(防火墙) / proxy(代理) / tunnel(跨网通道) / cert(证书) / mesh(服务网格) / switch(网络设备)） |
| `platform` | 平台/集群 |
| `sop` | SOP |
| `script` | 自动化脚本 |
| `incident` | 历史故障 |
| `monitoring` | 监控规则/面板 |

### Ownership 建模约定

负责人信息统一通过 `metadata.yaml` 中实体的 `owner` 和 `oncall` **字符串属性**记录，不将团队/人员建模为图谱实体。原因：团队和人员信息变化频繁，且通常有独立的通讯录/HR 系统，图谱化维护成本高收益低。`owned_by.yaml` 仅在需要记录超出 owner/oncall 的细粒度责任划分时使用。

### meta 扩展字段示例

```yaml
# 应用
meta: { port: 8080, replicas: 3, framework: "spring-boot",
        designed_qps: 5000, safe_qps: 4000, scale_unit: "1 pod / 2min",
        bottleneck: "db connections", degrade_strategy: "关闭非核心查询" }

# 数据库
meta: { engine: "mysql-8.0", mode: "master-slave", ip: "10.0.1.50",
        max_connections: 1000, safe_connections: 800,
        storage_ceiling: "500G", scale_unit: "加从库 / 4h" }

# 主机
meta: { ip: "10.0.1.100", cpu: "64c", memory: "256G", gpu: "A100 x 8", cloud: "tencent" }

# SOP
meta: { file: "sop/sop-xxx.md", severity: "P1", auto_rate: 80 }

# 脚本
meta: { path: "/opt/scripts/xxx.sh", command: "bash xxx.sh", safe_guard: "healthy > 2" }

# Incident
meta:
  file: "incidents/2026/incident-20260215-001.md"
  severity: "P1"
  occurred_at: "2026-02-15T03:20:00+08:00"
  duration_min: 45
  root_cause_category: "变更引发"
  root_cause_chain: ["db:trading:mysql-master", "app:trading:order-service"]
  affected_entities: ["app:trading:order-service", "service:trading:online-trading"]

# 监控
meta: { tool: "prometheus", metric: "http_p99_latency", threshold: "500ms", url: "" }

# 网络 - DNS
meta: { subtype: "dns", endpoint: "10.0.0.53:53", scope: "*.webank.com" }

# 网络 - 防火墙规则
meta: { subtype: "firewall", purpose: "out-to-third-party-api", whitelist: ["api.partner.com"] }

# 网络 - 证书
meta: { subtype: "cert", cn: "*.webank.com", expires_at: "2026-12-31", issuer: "internal-ca" }

# 网络 - 跨云专线
meta: { subtype: "tunnel", bandwidth: "10Gbps", endpoints: ["tencent-vpc-1", "huawei-vpc-2"] }
```

## functions.yaml

```yaml
subsystem: string
version: string
functions:
  - id: string                    # func-001
    name: string
    description: string
    entry_point: string           # API 路径/页面/消息主题
    depends_on_entities: [string] # 依赖的实体 ID
    criticality: "core | important | normal"
```

## business-scenarios.yaml

```yaml
subsystem: string
version: string
scenarios:
  - id: string                   # scenario-001
    name: string
    description: string          # 用户视角
    trigger: string              # 触发条件
    flow: [string]               # 调用链路（实体 ID 序列）
    sla: string
    peak_qps: number
    peak_concurrency: number     # 峰值并发数
    business_impact: string      # 不可用时的影响
    related_functions: [string]  # 关联 function ID
```

## relations/{type}.yaml

所有关系文件共享相同的顶层结构：

```yaml
subsystem: string
relations:
  - from: string        # 源实体 ID
    to: string          # 目标实体 ID
    critical: boolean   # 可选，是否关键（默认 false）
    confidence: string  # 可选，置信度: confirmed（已确认）| inferred（推断）| uncertain（存疑），默认 confirmed
    meta: object        # 可选，关系附加信息
```

### 12 种关系类型

| 文件 | 类型 | 方向语义 | 推理用途 |
|------|------|---------|---------|
| `depends_on.yaml` | DependsOn | A 功能依赖 B | RCA、爆炸半径 |
| `runs_on.yaml` | RunsOn | A 运行在 B 上 | 基础设施故障分析 |
| `supports.yaml` | Supports | A 支撑业务 B | 故障定级 |
| `owned_by.yaml` | OwnedBy | A 归属 B | 升级通知（优先用 metadata.yaml 的 owner/oncall 字段） |
| `configured_with.yaml` | ConfiguredWith | A 使用配置 B | 配置漂移 |
| `has_monitoring.yaml` | HasMonitoring | A 被监控 B 覆盖 | 监控盲区检查 |
| `synced_with.yaml` | SyncedWith | A 与 B 数据同步 | 数据一致性排查 |
| `has_risk.yaml` | HasRisk | A 存在风险 B | 风险盘点 |
| `is_mitigated_by.yaml` | IsMitigatedBy | A 被 SOP B 缓解 | 告警→SOP 匹配 |
| `is_automated_by.yaml` | IsAutomatedBy | SOP A 可由脚本 B 执行 | 自动修复判断 |
| `located_in.yaml` | LocatedIn | A 位于 B | 关联故障 |
| `was_changed_by.yaml` | WasChangedBy | A 被变更 B 修改 | 变更回溯 |

### 关键 meta 字段参考

```yaml
# depends_on
meta: { protocol: "tcp", port: 3306, timeout_ms: 3000, fallback: "" }

# has_monitoring
meta: { type: "alert", tool: "prometheus", metric: "", threshold: "", url: "" }

# synced_with
meta: { sync_mode: "realtime", sync_tool: "canal", lag_threshold: "5s" }

# is_mitigated_by
meta: { trigger: "active_connections > 90%" }

# is_automated_by
meta: { covers_steps: "1,2,3", safe_guard: "healthy > 2", approval_required: false }

# was_changed_by
meta: { change_time: "", change_desc: "", rollback_plan: "" }
```

## graph.md 生成格式

需要生成可读视图时，汇总 `metadata.yaml` + 所有 `relations/*.yaml` 生成：

```markdown
# {子系统} 知识图谱

> 数据版本: {version}

## 实体清单
（表格：ID | 类型 | 名称 | 等级 | 负责人）

## 关系图谱
（按关系类型分组列出，跳过无数据的类型）

## 拓扑视图（Mermaid）
（核心 DependsOn + RunsOn 关系的 flowchart）
```

## 校验规则

1. 每个实体 `id` 全局唯一
2. 关系中的 `from`/`to` 必须指向已定义的实体
3. 跨子系统引用需目标子系统中存在该实体
4. T1 实体必须填写 owner 和 oncall
5. `critical: true` 的 DependsOn 意味着强依赖
6. 每个关系文件中只存放对应类型的关系
