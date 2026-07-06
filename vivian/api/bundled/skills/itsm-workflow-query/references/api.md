# ITSM 流程 ApiDesign 接口参考

## 变更单分页查询

接口：

```text
POST http://10.107.98.250:9016/automation/encapsulation/queryChangeListPage
Content-Type: application/json
```

文档中的请求对象：`ChangeListQueryRequest`。

文档中的请求字段：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---:|---|
| `teamName` | String | 否 | 科室/团队名称 |
| `changeStatus` | String | 否 | 变更状态编码 |
| `changeTitle` | String | 否 | 变更标题关键字 |
| `changeOwner` | String | 否 | 申请人 |
| `operator` | String | 否 | 处理人企业微信英文名 |
| `planStartDateBegin` | String | 否 | 计划开始时间下限，格式 `yyyy-MM-dd` |
| `planStartDateEnd` | String | 否 | 计划开始时间上限，格式 `yyyy-MM-dd` |
| `currentPage` | Integer | 否 | 当前页码，默认 `1` |
| `pageSize` | Integer | 否 | 每页大小，默认 `10`，最大 `100` |

技能额外支持的用户查询条件：

| 用户查询条件 | 请求体字段 | 本地过滤使用的响应字段 |
|---|---|---|
| operator | `operator` | `operator` |
| itsmId | `itsmId` | `itsmId` |
| changeStatusName | `changeStatusName` | `changeStatusName` |
| teamName | `teamName` | `teamName` |
| 指定日期/时间范围 | 不进入请求体，脚本拉取候选记录后本地过滤 | `changePlanStartDate` 和 `changePlanEndDate` |

`teamName` 固定枚举：

- 大数据平台室
- 网络运维室
- 主机运维室
- 企业应用开发室
- 一线运营室
- 数据库运维室
- 业务系统运营室
- 中间件平台室

常见资源域对应 `teamName`：

- 主机：`主机运维室`
- 网络：`网络运维室`
- DB/数据库：`数据库运维室`
- 中间件：`中间件平台室`
- 业务系统：`业务系统运营室`

做时间线综合分析时，把这些团队在查询时间范围内有重叠的变更放到同一条时间线上比较，并按用户问题补充其他相关团队。

用户查询日期或时间范围时，技能默认使用时间区间重叠语义：

```text
changePlanStartDate <= 查询结束时间
且
changePlanEndDate >= 查询开始时间
```

因此，变更开始时间不在查询范围内，但变更持续时间覆盖或跨过查询范围时，也应该返回。

接口返回 `2026-05-12T17:00:00.000+00:00` 这类带时区时间时，脚本按北京时间转换后再做日期/区间过滤和文本展示。

脚本只暴露三种时间查询入口，且互斥使用：`--date`、`--time-begin/--time-end`、`--current-week`。

响应包装结构：

```json
{
  "code": "0",
  "message": "success",
  "result": {
    "data": {
      "currentPage": 1,
      "pageSize": 10,
      "totalCount": 100,
      "totalPage": 10,
      "records": []
    }
  }
}
```

实际记录路径为 `result.data.records`。脚本也兼容 `result.records`、`data.records` 和顶层 `records`。

`records` 条目类型：`ItsmsChangeDetailEntity`。

已知字段：`id`、`itsmId`、`changeStatus`、`changeStatusName`、`changeTitle`、`changeDesc`、`risk`、`riskName`、`teamName`、`teamId`、`operator`、`operatorName`、`changeOwner`、`changeOwnerName`、`changeUrgent`、`changeModel`、`envs`、`changePlanStartDate`、`changePlanEndDate`、`changeCreateDate`、`changeStepList`、`syncTime`。

`changeStepList` 通常是 JSON 字符串数组。步骤内常见字段包括：`stepName`、`stepStatus`、`stepStatusName`、`teamName`、`stepUserId`、`stepUserName`、`startTime`、`endTime`、`stepDesc`。`startTime` 和 `endTime` 是毫秒时间戳，脚本按北京时间展示。

## 变更风险分析（事实层 + 规则集）

脚本：

```text
scripts/build_change_timeline.py
```

规则集目录：

```text
references/risk_rules/
  _index.yaml        # 缓冲分钟、默认团队、环境/状态策略、整体定级指引
  pairs.yaml         # 团队组合，区分 overlap/adjacent
  components.yaml    # 重要组件目录（动了什么组件：TiDB/WEMQ/防火墙…）
  operations.yaml    # 高危操作动作目录（做了什么动作：主备切换/缩容/割接/滚动升级…）
  teams/<科室>.yaml  # 各科室自有风险规则
```

脚本只产出确定性事实，不再输出风险等级：

- `changes`：窗口内变更，带 `envClass`（production/cloud-production/non-production/mixed/unknown）、`statusClass`（open/closed/unknown）、`componentSignals`（动了什么组件）、`operationSignals`（做了什么动作）、`inWindow`、`steps`（每步 `stepName`/`teamName`/`status`/`start`/`end`/`desc`，毫秒时间戳转北京时间）、`stepsPhased`（步骤是否分阶段）。组件/操作信号都只扫标题/描述/步骤、不扫团队名、中性不带等级。

  说明：实测变更步骤的时间戳基本都等于变更窗口（步骤包络从不更窄），仅约 16% 的单步骤间起止有差异、极少数是干净的灰度/全量分阶段。因此 overlap 默认按变更窗口计算；`--overlap-by-steps` 可按步骤有效区间逐段算（有空档才会收窄，步骤无有效时间时回退变更窗口），输出 `filters.overlapBasis` 与每个 pair 的 `basis` 标明口径。步骤的主要价值是给 Agent 当**证据**。
- `pairs`：两两时序关系，`relation` 为 `overlap` 或 `adjacent`，附真实 `overlapMinutes`/`gapMinutes`。默认只输出跨团队对（同团队对无团队组合规则可路由），`--include-same-team-pairs` 可保留全量。
- `aggregate`：`changeCount`、`byTeam`、`overlapPairs`、`adjacentPairs`、`peakConcurrency`。
- `excluded`：默认被排除（非生产、混合环境、已关闭）的变更及原因，不静默丢弃。

默认分析范围（`_index.yaml` 的 `defaultTeams`）：业务系统运营室、网络运维室、数据库运维室、中间件平台室、主机运维室。默认只把 `生产环境`/`云生产环境` 且未关闭的变更计入主分析。故障追因 `--fault-time` 时窗口为故障前 4 小时到故障后 1 小时，并纳入已关闭变更。

时间/重叠规则（由脚本确定性计算）：

- 两个变更计划时间相交 = `overlap`。
- 未相交但间隔 ≤ `bufferMinutes`（默认 60 分钟）= `adjacent`。
- 重叠/相邻分钟数基于变更真实区间计算（不再按窗口裁剪）。

取数性能：脚本按团队并发分页拉取（`--concurrency`，默认 6），单请求失败自动重试（`--retries`，默认 2，超时默认 45s），并向后端附加 `planStartDateEnd = 窗口末 + 缓冲`（无损上限——开始时间晚于此的变更不可能与窗口重叠或相邻）。单个团队/单页抓取失败不拖垮全局，会在 `metadata[].error` 与文本"数据提醒"中标记。

风险等级由 Agent 读取事实后按规则集路由判定：科室规则集（`teams/<科室>.yaml` 的 `when` 条件）+ 团队组合（`pairs.yaml` 的 overlap/adjacent 档位）+ 组件目录（`components.yaml`）+ 整体定级指引（`_index.yaml` 的 `overallLevelGuidance`）。完整流程见 `SKILL.md` 的"变更风险分析（事实层 + 判断层）"。

分析结论的去噪方法与输出编排（多周窗口下 `overlapPairs`/`peakConcurrency` 视为噪声、用步骤时间去噪、用步骤内容兜底；以及"口径说明→高风险分组→降级清单→跨科室重点→一句话总结"的五段输出结构）见 `SKILL.md` 的"分析输出范式"一节。

规则维护：直接编辑 `references/risk_rules/` 下的 YAML 文件。

## 服务请求分页查询

```text
POST http://10.107.98.250:9016/automation/encapsulation/queryRequestListPage
Content-Type: application/json
```

文档中的请求对象：`RequestListQueryRequest`。

文档中的请求字段：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---:|---|
| `requestOwner` | String | 否 | 申请人企业微信英文名 |
| `requestHandler` | String | 否 | 处理人企业微信英文名 |
| `requestStatus` | Integer | 否 | 请求状态 |
| `requestTitle` | String | 否 | 请求标题关键字 |
| `startDate` | String | 否 | 创建时间下限，格式 `yyyy-MM-dd` |
| `endDate` | String | 否 | 创建时间上限，格式 `yyyy-MM-dd` |
| `currentPage` | Integer | 否 | 当前页码，默认 `1` |
| `pageSize` | Integer | 否 | 每页大小，默认 `10`，最大 `100` |

技能额外支持的用户查询条件：

| 用户查询条件 | 请求体字段 | 本地过滤使用的响应字段 |
|---|---|---|
| requestHandler | `requestHandler` | `requestHandler` |
| requestOwner | `requestOwner` | `requestOwner` |
| requestStatus | `requestStatus` | `requestStatus` |
| requestTitle | `requestTitle` | `requestTitle` |
| itsmId | 不进入请求体，脚本拉取候选记录后本地过滤 | `itsmId` |
| 指定日期/时间范围 | `startDate` / `endDate` 使用日期边界，脚本再按精确时间本地过滤 | `requestCreatedate` |

服务请求没有计划开始/结束区间；用户查询日期或时间范围时，按创建时间 `requestCreatedate` 落在该范围内查询。

接口返回带时区时间时，脚本按北京时间转换后再做日期/区间过滤和文本展示。

脚本只暴露三种时间查询入口，且互斥使用：`--date`、`--time-begin/--time-end`、`--current-week`。

`records` 条目类型：`ItsmsRequestDetailEntity`。

已知字段：`id`、`itsmId`、`requestStatus`、`requestTitle`、`requestOwner`、`requestHandler`、`requestHandlerName`、`requestDesc`、`requestCreatedate`、`requestRatifyFinishTime`、`deadLineDate`、`requestRealEndTime`、`currentHandlers`、`jbpmId`、`syncTime`。
