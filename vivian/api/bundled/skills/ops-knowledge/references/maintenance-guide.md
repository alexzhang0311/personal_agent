# 知识图谱维护指南

## 新增子系统

从原始资料抽取数据时，先读 `references/extraction-protocol.md` 了解完整抽取规则。

1. 复制模板: `cp -r references/templates/subsystem/ data/{name}/`
2. 按抽取协议填充 `metadata.yaml`（实体定义）
3. 填写 `functions.yaml` 和 `business-scenarios.yaml`
4. 按需填充 `relations/` 下的关系文件（无数据的文件保留空模板即可）
6. 填写运维文档（index/deploy/api/deps/troubleshoot）
7. 更新 `data/index.md` 全局索引

### 实体录入顺序建议

1. 基础设施层: host, network, storage, platform
2. 数据层: db, cache, mq
3. 应用层: app, lb
4. 业务层: service
5. 配置层: config
6. 监控层: monitoring

关系录入顺序: runs_on → depends_on → supports → owned_by → 其他

## 新增实体

在 `metadata.yaml` 的 `entities` 列表中追加。检查清单:
- [ ] ID 格式 `{type}:{subsystem}:{name}` 且全局唯一
- [ ] type 在枚举范围内
- [ ] T1 实体有 owner 和 oncall

## 新增关系

在对应 `relations/{type}.yaml` 文件中追加。检查清单:
- [ ] from/to 指向已存在的实体
- [ ] 放入正确的关系类型文件
- [ ] 无重复（相同 from + to）

## 跨子系统关系

关系定义在**发起方**的关系文件中：

```yaml
# 在 subsystem-a/relations/depends_on.yaml 中
relations:
  - from: "app:subsystem-a:order-service"
    to: "mq:subsystem-b:kafka-cluster"
```

反向查询需扫描所有子系统的对应关系文件。建议在被依赖方的 `deps.md` 中注明外部依赖方。

## 新增 SOP

1. 复制 `references/templates/sop/sop.md` 到 `data/{subsystem}/sop/sop-{topic}.md`
2. 填写 SOP 内容
3. 在子系统 `metadata.yaml` 中注册 sop 实体
4. 在 `relations/is_mitigated_by.yaml` 中添加关系
5. 如有自动化脚本，注册 script 实体并在 `is_automated_by.yaml` 中添加关系

## 故障复盘录入

1. 复制 `references/templates/incident/incident.md` 到 `data/incidents/{year}/incident-{YYYYMMDD}-{seq}.md`
2. 填写故障报告
3. 在相关子系统 `metadata.yaml` 中注册 incident 实体（含 root_cause_chain 和 affected_entities）
4. 在 `relations/was_changed_by.yaml` 中添加变更关联
5. 在 `relations/is_mitigated_by.yaml` 中添加 SOP 关联
6. 如现有 SOP 无法覆盖，新建 SOP

### Incident 跨子系统归属规则

一个 Incident 可能涉及多个子系统。归属规则遵循"关系定义在 from 所在子系统"的统一原则：

- **Incident 实体注册在根因所在子系统**的 `metadata.yaml` 中，ID 使用根因子系统名：`incident:{root_cause_subsystem}:{YYYYMMDD}-{seq}`
- **Incident 的所有关系（→变更、→SOP）统一在根因子系统**的关系文件中记录，不在其他受影响子系统中重复
- Incident 报告文件（md）放在全局 `data/incidents/{year}/`
- 跨子系统影响通过 `meta.affected_entities` 记录（实体 ID 列表），查询时扫描此字段即可

这与"关系定义在 from 所在子系统"的规则完全一致——incident 实体在根因子系统，它的所有出向关系自然也在根因子系统。

示例：根因在 infra，影响了 order 和 payment：
- 实体注册在 `references/infra/metadata.yaml`：`incident:infra:20260315-001`
- `infra/relations/was_changed_by.yaml`：incident→change 关系
- `infra/relations/is_mitigated_by.yaml`：incident→sop 关系
- `meta.affected_entities`: `["app:order:order-service", "app:payment:pay-gateway"]`
- 报告文件：`data/incidents/2026/incident-20260315-001.md`

查询"order 子系统历史上受过哪些故障影响"时，扫描所有子系统 incident 实体的 `meta.affected_entities` 字段。

## 图谱一致性校验

修改后运行校验脚本: `python3 scripts/validate.py .`

脚本自动检查:
1. 实体 ID 全局唯一
2. 关系中的 from/to 指向已定义的实体
3. 同一关系文件中无重复 from+to
4. T1 实体有 owner 和 oncall

人工自检补充:
5. 关系放在了正确类型的文件中
6. 监控覆盖: T1 实体在 has_monitoring.yaml 中有记录

修改后更新对应文件的 `version` 字段。

## 场景 7: 故障处理后图谱回写

每次故障处理、SOP 执行后，按 `references/extraction-protocol.md` 末尾的"图谱回写检查清单"执行。核心检查项：

1. 是否需要新建 incident
2. 是否发现缺失的依赖关系
3. 现有关系的 confidence 是否需要升级（如 `inferred` → `confirmed`）
4. 是否需要新建/更新 SOP
5. 实体信息是否需要修正

回写同样遵循确认模式：列出变更让用户确认后再执行。完成后运行 `python3 scripts/validate.py .`。
