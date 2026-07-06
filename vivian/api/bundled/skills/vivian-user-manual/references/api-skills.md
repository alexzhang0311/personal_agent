# 技能管理 API 使用指南

所有技能管理端点的前缀为 `/api/resource/skills`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/resource/skills/ | 获取当前用户的所有技能 |
| GET | /api/resource/skills/config | 获取全局技能启用配置 |
| PUT | /api/resource/skills/config | 更新全局技能启用配置 |
| GET | /api/resource/skills/{level}/{name} | 获取技能详情 |
| GET | /api/resource/skills/{level}/{name}/file | 获取技能中某个文件的内容 |
| POST | /api/resource/skills/upload | 上传新技能（ZIP 文件） |
| DELETE | /api/resource/skills/{level}/{name} | 删除技能 |

---

## 获取技能列表

```bash
curl GET /api/resource/skills/ \
  -H "Authorization: Bearer <token>"
```

**响应**：
```json
{
  "skills": [
    {
      "name": "pdf",
      "description": "PDF 创建和处理技能",
      "level": "project",
      "files": ["SKILL.md", "scripts/create.py"]
    },
    {
      "name": "xlsx",
      "description": "Excel 操作技能",
      "level": "global",
      "files": ["SKILL.md", "references/formulas.md"]
    }
  ]
}
```

**level 说明**：
- `project`：项目级技能，仅当前用户可见
- `global`：全局技能，所有用户共享

---

## 获取技能详情

```bash
curl GET /api/resource/skills/project/pdf \
  -H "Authorization: Bearer <token>"
```

**路径参数**：
| 参数 | 说明 |
|------|------|
| level | `project` 或 `global` |
| name | 技能名称 |

**响应**：返回技能元数据和文件列表。

---

## 获取技能文件内容

```bash
curl GET "/api/resource/skills/project/pdf/file?path=SKILL.md" \
  -H "Authorization: Bearer <token>"
```

**查询参数**：
| 参数 | 说明 |
|------|------|
| path | 技能内的文件相对路径 |

**响应**：返回文件内容（纯文本）。

---

## 上传技能

```bash
curl -X POST /api/resource/skills/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@my-skill.zip" \
  -F "level=project"
```

**请求参数**（multipart/form-data）：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | file | 是 | ZIP 格式的技能包 |
| level | string | 否 | `project`（默认）或 `global` |

**ZIP 包结构要求**：
```
my-skill.zip
└── my-skill/
    ├── SKILL.md        ← 必需，包含 name 和 description 前置元数据
    ├── scripts/        ← 可选，可执行脚本
    ├── references/     ← 可选，参考文档
    └── assets/         ← 可选，模板等资源
```

**SKILL.md 格式**：
```markdown
---
name: my-skill
description: 技能描述，说明何时使用此技能
---

# 技能标题

技能的详细使用说明...
```

---

## 全局技能配置

### 获取配置

```bash
curl GET /api/resource/skills/config \
  -H "Authorization: Bearer <token>"
```

### 更新配置

启用或禁用特定的全局技能：

```bash
curl -X PUT /api/resource/skills/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled_skills": ["xlsx", "pdf"]}'
```

---

## 删除技能

```bash
curl -X DELETE /api/resource/skills/project/my-skill \
  -H "Authorization: Bearer <token>"
```

**注意**：删除操作不可撤销。

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | ZIP 格式无效或缺少 SKILL.md | 检查技能包结构 |
| 404 | 技能不存在 | 检查 level 和 name |
| 409 | 同名技能已存在 | 先删除再上传，或使用不同名称 |
