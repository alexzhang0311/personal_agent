---
name: rota-schedule
description: 查询和修改子系统 AB 角和发布窗口。在运维场景中，当用户提到查看/查询 AB 角、值班人员、发布窗口、调度时间、系统责任人、first_principal、second_principal、schedule_start、schedule_end 等关键词时，使用此技能。适用于业务系统运营室的日常运维工作。
---

# 子系统 AB 角和发布窗口管理

本技能用于查询和修改子系统 AB 角（值班人员）和发布窗口时间。

## 数据源

- 数据库：`pros_monitor`
- 表：`auto_rota_operation_scheduling`

### 表结构

| 字段 | 说明 |
|------|------|
| `domain` | 子系统域 |
| `system_name` | 子系统名称 |
| `first_principal` | A 角（主要负责人） |
| `second_principal` | B 角（备用负责人） |
| `schedule_start` | 发布窗口开始时间 |
| `schedule_end` | 发布窗口结束时间 |
| `schedule_user` | 排班用户 |
| `ops_group` | 运维组 |

## 功能

### 1. 查询功能

支持以下查询方式：

- **按子系统查询**：查看指定子系统的 AB 角和发布窗口
- **按人员查询**：查看指定人员负责的子系统（作为 A 角或 B 角）

### 2. 修改功能

- **按系统修改发布窗口时间**：更新指定子系统的 `schedule_start` 和 `schedule_end`

## 使用脚本

使用 `/home/app/vivian_workspace/jorgenchen/db_executor.py` 工具执行数据库操作。

### 查询子系统 AB 角

```bash
python /home/app/vivian_workspace/jorgenchen/db_executor.py \
  --db pros_monitor \
  --sql "SELECT system_name, first_principal, second_principal, schedule_start, schedule_end, ops_group FROM auto_rota_operation_scheduling WHERE system_name LIKE '%子系统名%';"
```

### 查询人员负责的子系统

```bash
python /home/app/vivian_workspace/jorgenchen/db_executor.py \
  --db pros_monitor \
  --sql "SELECT system_name, first_principal, second_principal, schedule_start, schedule_end FROM auto_rota_operation_scheduling WHERE first_principal LIKE '%人员名%' OR second_principal LIKE '%人员名%';"
```

### 修改发布窗口时间

```bash
python /home/app/vivian_workspace/jorgenchen/db_executor.py \
  --db pros_monitor \
  --sql "UPDATE auto_rota_operation_scheduling SET schedule_start='新开始时间', schedule_end='新结束时间' WHERE system_name='子系统名';"
```

## 输出格式

查询结果应以表格形式展示，包含以下列：
- 子系统名称
- A 角（主要负责人）
- B 角（备用负责人）
- 发布窗口（开始时间 - 结束时间）
- 运维组
