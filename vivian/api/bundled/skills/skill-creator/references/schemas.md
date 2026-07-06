# JSON 数据结构定义

本文档定义了技能创建器使用的所有 JSON 数据结构。

---

## evals.json

定义技能的评估用例。位于技能目录的 `evals/evals.json`。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "用户的示例提示词",
      "expected_output": "期望结果描述",
      "files": ["evals/files/sample1.pdf"],
      "expectations": [
        "输出包含 X",
        "技能使用了脚本 Y"
      ]
    }
  ]
}
```

**字段说明：**
- `skill_name`：与技能前置元数据中的名称匹配
- `evals[].id`：唯一整数标识符
- `evals[].prompt`：要执行的任务
- `evals[].expected_output`：人类可读的成功描述
- `evals[].files`：可选的输入文件路径列表（相对于技能根目录）
- `evals[].expectations`：可验证的声明列表

---

## history.json

在改进模式中跟踪版本进展。位于工作空间根目录。

```json
{
  "started_at": "2026-01-15T10:30:00Z",
  "skill_name": "pdf",
  "current_best": "v2",
  "iterations": [
    {
      "version": "v0",
      "parent": null,
      "expectation_pass_rate": 0.65,
      "grading_result": "baseline",
      "is_current_best": false
    },
    {
      "version": "v2",
      "parent": "v1",
      "expectation_pass_rate": 0.85,
      "grading_result": "won",
      "is_current_best": true
    }
  ]
}
```

**字段说明：**
- `started_at`：改进开始的 ISO 时间戳
- `skill_name`：被改进的技能名称
- `current_best`：当前最佳版本标识符
- `iterations[].version`：版本标识符（v0, v1, ...）
- `iterations[].parent`：派生自的父版本
- `iterations[].expectation_pass_rate`：评分通过率
- `iterations[].grading_result`："baseline"、"won"、"lost" 或 "tie"
- `iterations[].is_current_best`：是否为当前最佳版本

---

## grading.json

评分代理的输出。位于 `<run-dir>/grading.json`。

```json
{
  "expectations": [
    {
      "text": "输出包含名字 '张三'",
      "passed": true,
      "evidence": "在执行记录步骤 3 中找到：'提取的名字：张三、李四'"
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "execution_metrics": {
    "tool_calls": { "Read": 5, "Write": 2, "Bash": 8 },
    "total_tool_calls": 15,
    "total_steps": 6,
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "表单有 12 个可填写字段",
      "type": "factual",
      "verified": true,
      "evidence": "在 field_info.json 中计数为 12 个字段"
    }
  ],
  "user_notes_summary": {
    "uncertainties": ["使用了 2023 年数据，可能已过时"],
    "needs_review": [],
    "workarounds": ["对不可填写字段回退到文本覆盖"]
  },
  "eval_feedback": {
    "suggestions": [
      {
        "assertion": "输出包含名字 '张三'",
        "reason": "瞎编的文档也会通过——考虑检查主要联系人的电话和邮箱匹配"
      }
    ],
    "overall": "断言检查存在性但不检查正确性。"
  }
}
```

**字段说明：**
- `expectations[]`：带证据的已评分断言
  - `text`：原始断言文本
  - `passed`：布尔值
  - `evidence`：支持判定的具体引用或描述
- `summary`：通过/失败的聚合统计
- `execution_metrics`：工具使用和输出大小
- `timing`：挂钟计时
- `claims`：从输出中提取和验证的声明
- `user_notes_summary`：执行器标记的问题
- `eval_feedback`：（可选）对评估标准的改进建议

---

## metrics.json

执行器代理的输出。位于 `<run-dir>/outputs/metrics.json`。

```json
{
  "tool_calls": { "Read": 5, "Write": 2, "Bash": 8, "Edit": 1, "Glob": 2, "Grep": 0 },
  "total_tool_calls": 18,
  "total_steps": 6,
  "files_created": ["filled_form.pdf", "field_values.json"],
  "errors_encountered": 0,
  "output_chars": 12450,
  "transcript_chars": 3200
}
```

---

## timing.json

运行的挂钟计时。位于 `<run-dir>/timing.json`。

**捕获方式：** 子代理任务完成时，任务通知包含 `total_tokens` 和 `duration_ms`。立即保存——它们不会在其他地方持久化。

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

---

## benchmark.json

基准模式的输出。位于 `benchmarks/<timestamp>/benchmark.json`。

```json
{
  "metadata": {
    "skill_name": "pdf",
    "skill_path": "/path/to/pdf",
    "executor_model": "claude-sonnet-4-20250514",
    "analyzer_model": "most-capable-model",
    "timestamp": "2026-01-15T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 3
  },
  "runs": [
    {
      "eval_id": 1,
      "eval_name": "Ocean",
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": ["使用了 2023 年数据，可能已过时"]
    }
  ],
  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },
  "notes": [
    "断言'输出是 PDF 文件'在两种配置中都 100% 通过——可能无法区分技能价值",
    "评估 3 显示高方差（50% ± 40%）——可能不稳定或模型相关"
  ]
}
```

**重要：** 查看器严格读取这些字段名。使用 `config` 而非 `configuration`，或将 `pass_rate` 放在运行顶层而非嵌套在 `result` 下，会导致查看器显示空/零值。手动生成 benchmark.json 时务必参考此 schema。

---

## comparison.json

盲测对比代理的输出。位于 `<grading-dir>/comparison-N.json`。

```json
{
  "winner": "A",
  "reasoning": "输出 A 提供了完整方案...",
  "rubric": { "A": { "overall_score": 9.0 }, "B": { "overall_score": 5.4 } },
  "output_quality": {
    "A": { "score": 9, "strengths": ["..."], "weaknesses": ["..."] },
    "B": { "score": 5, "strengths": ["..."], "weaknesses": ["..."] }
  },
  "expectation_results": {
    "A": { "passed": 4, "total": 5, "pass_rate": 0.80, "details": [] },
    "B": { "passed": 3, "total": 5, "pass_rate": 0.60, "details": [] }
  }
}
```

---

## analysis.json

事后分析代理的输出。位于 `<grading-dir>/analysis.json`。

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "对比代理选择赢家的简要总结"
  },
  "winner_strengths": ["..."],
  "loser_weaknesses": ["..."],
  "instruction_following": {
    "winner": { "score": 9, "issues": ["..."] },
    "loser": { "score": 6, "issues": ["..."] }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "具体修改建议",
      "expected_impact": "预期效果"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "读取技能 -> 遵循流程 -> 产出输出",
    "loser_execution_pattern": "读取技能 -> 不确定方法 -> 多次尝试 -> 有错误"
  }
}
```
