# SOP 使用指南

## SOP 与 troubleshoot.md 的边界

| 维度 | troubleshoot.md | SOP |
|------|----------------|-----|
| 定位 | 排查定位未知问题 | 执行已知故障的标准处理 |
| 触发 | 现象不明确，需诊断 | 故障模式已识别 |
| 内容 | 现象→原因→排查命令→判断 | 触发条件→分步操作→回滚→升级 |
| 图谱 | 无关联 | 注册为实体，通过 `is_mitigated_by.yaml` 连接 |

选择原则：不知道什么问题 → troubleshoot.md；已定位 → SOP。troubleshoot 的排查结论应指向具体 SOP。

## 告警到 SOP 的匹配机制

**第一步：精确匹配**
从告警提取实体 ID，查对应子系统的 `relations/is_mitigated_by.yaml`，找该实体的 IsMitigatedBy 关系。多个 SOP 时用 `meta.trigger` 缩小范围。

**第二步：语义匹配**
无精确结果时，遍历 `is_mitigated_by.yaml` 中所有 `meta.trigger`，语义比对告警现象。

trigger 写法建议：
- 好: `"active_connections > 90%"`, `"P99 > 500ms 持续 5min"`
- 差: `"数据库有问题"`（过于模糊）

**第三步：降级**
无匹配 SOP → 转入 `troubleshoot.md` 排查。定位后考虑新建 SOP。

## SOP 的图谱关系链

```
实体 --[IsMitigatedBy]--> SOP --[IsAutomatedBy]--> Script
```

- 告警匹配: 沿 IsMitigatedBy 找 SOP
- 自动化判断: 沿 IsAutomatedBy 找 Script，检查 safe_guard
- 历史关联: Incident 也通过 IsMitigatedBy 连接到 SOP（记录"用了哪个 SOP 处理"）

## SOP 存放说明

SOP 文件存放在各子系统目录下 `data/{subsystem}/sop/` 中，与该子系统的实体、关系数据就近管理。优势：
- 定位子系统后所有相关资源在同一目录内，查找路径最短
- 图谱关联通过实体 ID 完成，与文件位置无关
- 少量跨子系统通用 SOP 放在 `references/sops/shared/`
