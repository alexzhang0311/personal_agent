---
name: itsm-workflow-query
description: 查询 ITSM 变更单和服务请求单，并基于变更计划时间做生产变更交叉风险分析。变更单支持按处理人企业微信英文名、ITSM 工单 ID、变更状态名称、科室/团队、计划变更时间重叠范围查询；服务请求支持按处理人、申请人、状态、标题、ITSM 工单 ID 和创建时间查询；风险分析分两层：脚本产出确定性时间线事实（重叠、缓冲相邻、环境/状态标签、组件信号、聚合指标），再由 Agent 依据按科室组织的规则集路由判定风险等级。
---

# ITSM 流程查询

## 概览

使用此技能查询内部 ITSM 流程记录。当前支持变更单查询、服务请求单查询和生产变更时间线风险分析。

## 查询变更单

使用 `scripts/query_changes.py` 查询变更单。脚本会调用 ApiDesign 中的变更列表接口：

```bash
python3 <skill-dir>/scripts/query_changes.py --operator zhangsan
```

脚本使用 `httpx` 发起 JSON POST 请求。

当用户没有明确给出查询条件时，直接使用上下文中的当前用户信息查询：

- `operator`：当前用户的企业微信英文名。
- `teamName`：当前用户所在团队，必须是下方固定枚举之一。
- 查询时间范围：当前自然周，周一到周日；只要变更计划时间区间与本周有重叠，就需要返回。

默认查询调用方式：

```bash
python3 <skill-dir>/scripts/query_changes.py --operator <上下文当前用户企业微信英文名> --team-name <上下文当前用户团队> --current-week
```

用户给出日期或时间范围时，优先使用重叠查询语义：只要变更的 `changePlanStartDate` 到 `changePlanEndDate` 与用户给定区间有交集，就算匹配。不要让用户区分“按开始时间查”或“按结束时间查”。接口返回带时区的时间时，脚本会转换为北京时间后再过滤和展示。

文本输出每条记录必须展示标题、ITSM 工单 ID、状态、科室、处理人、负责人、计划时间、环境 `envs`、变更描述 `changeDesc` 和变更步骤 `changeStepList`。变更步骤要解析为可读列表，展示步骤名、状态、团队、处理人、步骤时间和步骤描述。

支持的变更查询条件：

- `--operator`：处理人企业微信英文名。
- `--itsm-id` / `--itsmId`：ITSM 工单 ID。
- `--change-status-name` / `--changeStatusName`：变更状态名称。
- `--team-name` / `--teamName`：科室/团队名称，仅支持固定枚举。
- `--date`：查询指定日期内与变更计划时间有重叠的记录。
- `--time-begin` 和 `--time-end`：查询指定时间范围内与变更计划时间有重叠的记录，两个参数必须成对使用。
- `--current-week`：查询当前自然周内与变更计划时间有重叠的记录。

时间条件三选一，互斥使用：`--date`、`--time-begin/--time-end`、`--current-week`。

`--team-name` 固定枚举：

- 大数据平台室
- 网络运维室
- 主机运维室
- 企业应用开发室
- 一线运营室
- 数据库运维室
- 业务系统运营室
- 中间件平台室

常见资源域按团队查询：

- 主机相关变更：`--team-name 主机运维室`
- 网络相关变更：`--team-name 网络运维室`
- DB/数据库相关变更：`--team-name 数据库运维室`
- 中间件相关变更：`--team-name 中间件平台室`
- 业务系统相关变更：`--team-name 业务系统运营室`

需要按时间线综合分析时，把用户给定时间范围内有重叠的变更放到同一条时间线上比较。除主机、网络、DB、中间件团队外，还要按用户问题纳入 `业务系统运营室` 等相关团队的变更，再结合上下文回答。

示例：

```bash
python3 <skill-dir>/scripts/query_changes.py --operator lisi --team-name 一线运营室
python3 <skill-dir>/scripts/query_changes.py --operator lisi --team-name 一线运营室 --date 2025-05-24
python3 <skill-dir>/scripts/query_changes.py --operator lisi --team-name 一线运营室 --time-begin 2025-05-24T10:00 --time-end 2025-05-26T16:00
python3 <skill-dir>/scripts/query_changes.py --team-name 主机运维室 --current-week
python3 <skill-dir>/scripts/query_changes.py --team-name 网络运维室 --date 2025-05-24
python3 <skill-dir>/scripts/query_changes.py --team-name 数据库运维室 --time-begin 2025-05-24T10:00 --time-end 2025-05-26T16:00
python3 <skill-dir>/scripts/query_changes.py --team-name 中间件平台室 --current-week
python3 <skill-dir>/scripts/query_changes.py --team-name 业务系统运营室 --current-week
python3 <skill-dir>/scripts/query_changes.py --itsm-id 12345 --output json
python3 <skill-dir>/scripts/query_changes.py --change-status-name 执行中 --scan-all
```

默认使用 ApiDesign 页面中的接口地址。可通过 `ITSM_QUERY_CHANGE_URL` 或 `--url` 覆盖：

```bash
ITSM_QUERY_CHANGE_URL=http://host/automation/encapsulation/queryChangeListPage \
python3 <skill-dir>/scripts/query_changes.py --operator lisi
```

## 过滤说明

ApiDesign 页面明确记录了 `operator`、`teamName` 等请求参数。用户要求的 `itsmId`、`changeStatusName`，以及时间区间重叠查询，是响应字段或组合条件；脚本会尽量把字段作为请求体字段透传给后端，同时对返回记录做本地过滤。

使用响应字段过滤时，如果需要尽量查全，使用 `--scan-all` 或调大 `--max-pages`。脚本遇到响应字段过滤会自动分页扫描，扫描上限由 `--max-pages` 控制。

时间区间重叠查询规则：

```text
changePlanStartDate <= 查询结束时间
且
changePlanEndDate >= 查询开始时间
```

## 变更风险分析（事实层 + 判断层）

风险分析分两层：

- **事实层**：脚本 `scripts/build_change_timeline.py` 只产出确定性事实——重叠时间线、两两时序关系、环境/状态标签、组件信号、聚合指标。**脚本不再输出风险等级。**
- **判断层**：你（Agent）读取事实后，按 `references/risk_rules/` 规则集路由判定风险等级。

绝不要让脚本帮你算重叠以外的"风险高低"，也绝不要绕过脚本自己从原始时间戳推算重叠——时间区间计算交给脚本，风险判断交给规则集 + 你。

### 1. 用脚本取事实

```bash
python3 <skill-dir>/scripts/build_change_timeline.py --date 2026-05-18 --output json
```

默认团队范围取自 `references/risk_rules/_index.yaml` 的 `defaultTeams`：业务系统运营室、网络运维室、数据库运维室、中间件平台室、主机运维室。

脚本按团队并发分页取数（`--concurrency` 默认 6、`--retries` 默认 2、`--timeout` 默认 45s），并向后端附加 `planStartDateEnd`（无损上限）加速。单团队/单页失败不拖垮全局，会在 `metadata[].error` 标记。

默认只把 `生产环境`、`云生产环境` 且未关闭的变更计入主分析；被排除的（非生产、混合环境、已关闭）会全部列在 `excluded` 段并附原因，**不会静默丢弃**，供你判断时参考。故障追因用 `--fault-time`，窗口为故障前 4 小时到故障后 1 小时，并自动纳入已关闭变更。

JSON 事实输出包含：

- `changes`：窗口内变更，带 `envClass`(production/cloud-production/non-production/mixed/unknown)、`statusClass`(open/closed/unknown)、`componentSignals`(动了什么组件，如 TiDB/WEMQ)、`operationSignals`(做了什么动作，如 主备切换/缩容/滚动升级)、`inWindow`，以及 `steps`(每步 `stepName`/`teamName`/`status`/`start`/`end`/`desc`，时间由毫秒时间戳转北京时间) 和 `stepsPhased`(同一单内步骤时间是否分阶段，如灰度/全量)。组件/操作信号都只扫标题/描述/步骤，不扫团队名，均为中性、不带等级。
- `pairs`：两两时序关系，`relation` 为 `overlap` 或 `adjacent`，附真实 `overlapMinutes`/`gapMinutes`。**默认只输出跨团队对**（同团队对在 `pairs.yaml` 无规则可路由，其并发情况由 `peakConcurrency` 和时间线体现）；需要全量时加 `--include-same-team-pairs`。做交叉风险建议用 `--date` 或具体时间窗，`--current-week` 粒度过粗时 pairs 会很多。
- `aggregate`：`changeCount`、`byTeam`、`overlapPairs`、`adjacentPairs`、`peakConcurrency`。
- `excluded`：被排除的变更及原因。

### 2. 路由 + 判定（Agent 流程）

1. 取事实：运行上面的脚本（`--output json`）。
2. 路由：根据 `changes[].teamName` 与 `pairs[].teams`，只加载相关的 `references/risk_rules/teams/<科室>.yaml`、`pairs.yaml` 中命中的团队组合、`components.yaml` 中被 `componentSignals` 命中的条目、`operations.yaml` 中被 `operationSignals` 命中的条目。
3. 单条定级：对每条变更，用所属科室 `riskPatterns` 的 `when` 条件判定。**必须逐条阅读并评估该变更的步骤操作内容（`changes[].steps`），不能只凭标题/描述定级**：步骤仅例行/巡检/只读的判低，不要因团队名就判高；步骤出现破坏性操作（主备切换、滚动升级、扩缩容、割接、停机、数据/表结构迁移等）即使标题平淡也要相应提级。混合环境的 `excluded` 项也要结合内容判断是否其实触及生产。注意：多数变更步骤时间≈变更窗口，只有 `stepsPhased=true` 的单才有真正的分阶段执行时段；需要按步骤实际活跃时段收窄重叠时，用脚本的 `--overlap-by-steps`（步骤无有效时间时自动回退变更窗口）。
4. 交叉定级：对每个 `pair`，按 `relation`（`overlap`/`adjacent`）取 `pairs.yaml` 对应档位，`adjacent` 通常比 `overlap` 低一档。
5. 整体结论：按 `_index.yaml` 的 `overallLevelGuidance`，结合 `aggregate`（尤其 `peakConcurrency`）综合给出高/中/低。
6. 输出（保持高信息密度）：结论；时间窗口、团队范围、过滤规则；数量统计；主要交叉风险及原因；重要组件；时间线；建议动作；不确定项（含 `excluded` 与未接入 CMDB 的说明）。
   **凡是列出的具体变更（主要交叉风险、重要组件、时间线、被排除项），都必须带上这三项**（字段取自 `changes[].teamName`/`planStart`/`planEnd`/`steps`）：
   1. 科室 `teamName`；
   2. 计划起止时间 `planStart -> planEnd`；
   3. 当定级依据了某个具体步骤（如"主备切换"步骤、灰度/全量阶段）时，引用该步骤的**操作内容与时间**作为证据。
   交叉风险每条还要给出两张单各自的科室与计划时间，以及它们的重叠/间隔分钟。

### 3. 分析输出范式

事实层会给出 `overlapPairs`、`peakConcurrency` 等数字，但**不要直接照搬当结论**。按下面的方法去噪后再编排输出。

**判断方法（四步）**

1. **先读 `aggregate` 定口径，但不信表面数字**：`aggregate` 既是统计也是**诊断信号**。当 `peakConcurrency` 接近 `changeCount`、`overlapPairs` 很大而 `adjacentPairs≈0` 时，说明变更计划窗口多为全天或多周区间，并发指标只是宽窗口互相覆盖产生的噪声，**不能按重叠数量或并发峰值定级**。此时先向用户说明这个口径，改按信号与步骤逐条判断；`byTeam` 仍可报（看哪个科室变更集中），但不作为风险驱动。只有窗口足够窄（多数变更几小时级、`peakConcurrency` 明显小于 `changeCount`、出现 `adjacentPairs`）时，并发峰值与重叠/相邻对才真正有定级意义。
2. **四维度逐条判断**：组件信号 + 操作信号 + 步骤内容（`changes[].steps`）+ 科室 `riskPatterns`，不要只看标题。
3. **用步骤时间去噪**：区分"窗口内真正在执行"与"高危动作已过、只剩观察/回收"，后者降级（看 `stepsPhased` 与各步 `start`/`end`——例如"主备切换"步骤昨天已结束、今天只剩"检查"，就不该再当高风险盯）。
4. **步骤内容兜底**：抓信号漏掉的隐藏动作——例如操作信号只标"版本升级"，但步骤写"主节点先降级切换再升级"实为主备切换动作，应提级。这正是步骤 6 强制评估步骤内容的价值所在。

**输出结构（五段）**

1. **口径说明**：本次为什么不直接信原始数字、按什么维度判定。
2. **高风险清单，按风险类型分组**（如 信创/大版本/机型替换、主从/主备切换、关键中间件停机…），每条遵循步骤 6 的单条格式（科室 + `planStart -> planEnd` + 步骤证据 + 命中规则）。
3. **降级清单**：高危动作已过、只剩观察/回收的变更，明确写出为什么不当高风险盯。
4. **跨科室联动重点**：只挑真正有依赖耦合的一两处（而非罗列所有 `pair`），给出两张单各自的科室、计划时间与重叠/间隔分钟。
5. **一句话总结 + 下一步**可做的事（展开某条、导出清单等）。

数据量小、窗口窄、风险点单一时可适当精简，但"先讲口径、再分组、每条可溯源（科室+计划时间+步骤证据）"的核心不变。

### 4. 维护规则集

规则集是普通 YAML，直接编辑对应文件即可（不再用脚本写入）：

- `references/risk_rules/_index.yaml`：缓冲分钟、默认团队、环境/状态策略、整体定级指引。
- `references/risk_rules/pairs.yaml`：团队组合，区分 `overlap`/`adjacent` 两档。
- `references/risk_rules/components.yaml`：重要组件目录（关键度 + 归属科室）。
- `references/risk_rules/operations.yaml`：高危操作动作目录（主备切换/缩容/割接/滚动升级等）。
- `references/risk_rules/teams/<科室>.yaml`：各科室自有风险规则。

示例：

```bash
python3 <skill-dir>/scripts/build_change_timeline.py --date 2026-05-18
python3 <skill-dir>/scripts/build_change_timeline.py --time-begin 2026-05-18T20:00:00 --time-end 2026-05-18T23:00:00
python3 <skill-dir>/scripts/build_change_timeline.py --current-week
python3 <skill-dir>/scripts/build_change_timeline.py --fault-time 2026-05-18T22:15:00
python3 <skill-dir>/scripts/build_change_timeline.py --team-name 业务系统运营室 --team-name 网络运维室 --date 2026-05-18 --output json
```

当前未接入 CMDB/拓扑。若有 CMDB 技能或上下文可用，先查看业务系统、主机、数据库、中间件的关联关系，再结合时间线事实判定。

## 查询服务请求单

使用 `scripts/query_requests.py` 查询服务请求单。脚本会调用 ApiDesign 中的服务请求列表接口：

```bash
python3 <skill-dir>/scripts/query_requests.py --request-handler zhangsan
```

脚本使用 `httpx` 发起 JSON POST 请求。

当用户没有明确给出查询条件时，直接使用上下文中的当前用户信息查询：

- `requestHandler`：当前用户的企业微信英文名。
- 查询时间范围：当前自然周，周一到周日，按服务请求创建时间 `requestCreatedate` 查询。

默认查询调用方式：

```bash
python3 <skill-dir>/scripts/query_requests.py --request-handler <上下文当前用户企业微信英文名> --current-week
```

服务请求没有计划开始/结束区间；用户给出日期或时间范围时，按创建时间 `requestCreatedate` 落在该范围内查询。接口返回带时区的时间时，脚本会转换为北京时间后再过滤和展示。

文本输出每条记录必须展示标题、ITSM 工单 ID、状态、申请人、处理人、创建时间、审批完成时间、截止时间、实际完成时间、当前处理人、流程实例 ID 和请求描述 `requestDesc`。

支持的服务请求查询条件：

- `--request-handler` / `--handler`：处理人企业微信英文名。
- `--request-owner` / `--owner`：申请人企业微信英文名。
- `--itsm-id` / `--itsmId`：ITSM 工单 ID。
- `--request-status` / `--status`：请求状态。
- `--request-title` / `--title`：请求标题关键字。
- `--date`：查询指定日期创建的服务请求。
- `--time-begin` 和 `--time-end`：查询指定时间范围内创建的服务请求，两个参数必须成对使用。
- `--current-week`：查询当前自然周创建的服务请求。

时间条件三选一，互斥使用：`--date`、`--time-begin/--time-end`、`--current-week`。

示例：

```bash
python3 <skill-dir>/scripts/query_requests.py --request-handler lisi --current-week
python3 <skill-dir>/scripts/query_requests.py --request-owner zhangsan --date 2025-05-24
python3 <skill-dir>/scripts/query_requests.py --request-handler lisi --time-begin 2025-05-24T10:00 --time-end 2025-05-26T16:00
python3 <skill-dir>/scripts/query_requests.py --itsm-id 67890 --output json
python3 <skill-dir>/scripts/query_requests.py --request-status 1001 --request-title 服务器维护
```

默认使用 ApiDesign 页面中的接口地址。可通过 `ITSM_QUERY_REQUEST_URL` 或 `--url` 覆盖：

```bash
ITSM_QUERY_REQUEST_URL=http://host/automation/encapsulation/queryRequestListPage \
python3 <skill-dir>/scripts/query_requests.py --request-handler lisi
```

## 参考资料

修改请求/响应字段映射，或继续扩展查询能力时，读取 `references/api.md`。
