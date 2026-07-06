# 文件管理 API 使用指南

所有文件管理端点的前缀为 `/api/files`。所有端点需要登录鉴权。

---

## 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/files/upload | 上传文件 |
| GET | /api/files/ | 获取已上传文件列表 |
| GET | /api/files/{uuid} | 下载文件 |
| DELETE | /api/files/{uuid} | 删除文件 |

---

## 上传文件

```bash
curl -X POST /api/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@report.pdf"
```

**请求**：`multipart/form-data`，字段名为 `file`。

**限制**：
- 单个文件最大 3MB
- 支持格式：docx、xlsx、pptx、pdf、txt、csv、json、md、py、js、ts、jpg、png、gif、webp 等

**响应**：
```json
{
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "filename": "report.pdf",
  "mime_type": "application/pdf",
  "size": 1048576,
  "server_path": "/workspace/user1/temp/uploads/2024-03-25/a1b2c3d4.pdf",
  "uploaded_at": "2024-03-25T10:30:00Z"
}
```

上传后：
- 文件存储在服务器上，通过 UUID 引用
- `server_path` 可用于在聊天中通过 `#` 引用此文件
- 文件会在一段时间后自动清理

---

## 获取文件列表

```bash
curl GET "/api/files/?date=2024-03-25" \
  -H "Authorization: Bearer <token>"
```

**查询参数**：
| 参数 | 说明 |
|------|------|
| date | 按上传日期筛选（可选，格式 YYYY-MM-DD） |

**响应**：
```json
{
  "files": [
    {
      "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "filename": "report.pdf",
      "mime_type": "application/pdf",
      "size": 1048576,
      "uploaded_at": "2024-03-25T10:30:00Z"
    }
  ]
}
```

---

## 下载文件

```bash
curl GET /api/files/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer <token>" \
  -o downloaded_file.pdf
```

返回文件内容，带正确的 `Content-Type` 和 `Content-Disposition` 头。

---

## 删除文件

```bash
curl -X DELETE /api/files/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer <token>"
```

**注意**：删除不可撤销。如果文件正在被某个会话引用，删除后该引用将失效。

---

## 在聊天中使用文件

1. 通过 API 或 Web UI 上传文件
2. 在聊天消息中引用文件路径：
   - Web UI：在输入框输入 `#` 选择文件
   - API：在 `attachments` 字段中传入文件路径

```bash
curl -X POST /api/agent/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "请分析这个报告的内容",
    "attachments": [
      {"path": "/workspace/user1/temp/uploads/2024-03-25/a1b2c3d4.pdf"}
    ]
  }'
```

---

## 常见错误

| 状态码 | 说明 | 解决方法 |
|--------|------|----------|
| 400 | 文件类型不支持或过大 | 检查文件格式和大小限制 |
| 404 | 文件不存在（可能已过期清理） | 重新上传 |
| 413 | 文件超过大小限制 | 压缩或拆分文件 |
