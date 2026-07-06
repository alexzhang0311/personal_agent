---
name: pdf-reading
description: 当需要读取、检查或从 PDF 文件中提取内容时使用此技能——特别是文件内容不在上下文中，需要从磁盘读取的场景。覆盖内容清单、文本提取、页面栅格化可视检查、嵌入图片/附件/表格/表单字段提取，以及针对不同文档类型选择读取策略。不要用于 PDF 创建、表单填写、合并、拆分、水印或加密——那些请使用 pdf 技能。
metadata:
  icon: BookOpen
  icon_color: "#d29922"
---

# PDF 读取指南

## 概述

本指南使用 **PyMuPDF (fitz)** 作为核心工具，它是纯 pip 安装的，无需 poppler-utils 等系统依赖。辅以 pdfplumber 做表格提取。

## 读取与检查 PDF

在对 PDF 做任何操作之前，先了解你面对的是什么。

### 内容清单

```python
import fitz

doc = fitz.open("document.pdf")

# === 基础信息（替代 pdfinfo）===
print(f"页数: {len(doc)}")
print(f"元数据: {doc.metadata}")
print(f"加密: {doc.is_encrypted}")

# === 文本可提取性检查（替代 pdftotext）===
text = doc[0].get_text()
if text.strip():
    print("✅ 文本可提取")
    print(text[:500])
else:
    print("⚠️ 首页无文本，可能是扫描件")

# === 嵌入图片列表（替代 pdfimages -list）===
for page_num, page in enumerate(doc):
    images = page.get_images()
    if images:
        print(f"第 {page_num+1} 页: {len(images)} 张嵌入图片")

# === 附件列表（替代 pdfdetach -list）===
if doc.embfile_count():
    print(f"附件: {doc.embfile_count()} 个")
    for i in range(doc.embfile_count()):
        print(f"  - {doc.embfile_info(i)['filename']}")

# === 字体信息（替代 pdffonts）===
for page in doc:
    fonts = page.get_fonts()
    for font in fonts:
        # (xref, ext, type, basefont, name, encoding)
        print(f"  字体: {font[3]}, 类型: {font[2]}, 编码: {font[5]}")
    break  # 通常看首页就够
```

这能告诉你：
- **页数和大小** —— 任务规模有多大？
- **文本可提取性** —— 有真实文本还是扫描件？
- **嵌入光栅图片** —— 有照片或光栅图表？（矢量图不会出现在此列表中）
- **附件** —— 有嵌入的电子表格、数据文件等？
- **字体状态** —— 字体编码是否正常？

### 文本提取

**PyMuPDF** 基础文本：
```python
import fitz

doc = fitz.open("document.pdf")
print(f"页数: {len(doc)}")

text = ""
for page in doc:
    text += page.get_text()
```

**PyMuPDF** 保留布局（多栏文档效果更好）：
```python
for page in doc:
    # flags 控制提取行为，参见 fitz 文档
    text = page.get_text("text", sort=True)
    print(text)
```

**pdfplumber** 布局感知提取，带定位数据：
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

### 可视检查（栅格化页面）

文本提取对图表、示意图、公式、多栏布局和表单结构是**盲的**。当这些重要时，栅格化相关页面：

```python
import fitz

doc = fitz.open("document.pdf")

# 栅格化第 3 页（0-indexed），150 DPI
page = doc[2]
pix = page.get_pixmap(dpi=150)
pix.save("/tmp/page-3.png")

# 批量栅格化
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=150)
    pix.save(f"/tmp/page-{i+1}.png")
```

然后查看生成的图片文件。

**何时栅格化 vs 文本提取：**
- **内容/数据问题 → 文本提取**（更省、可搜索）
- **图表、图形、视觉布局 → 栅格化页面**
- **表格 → 先试文本提取，乱码则栅格化**
- **精度要求高 → 两者都做**

**Token 开销参考：**
- 文本提取：每页约 200–400 tokens
- 栅格化图片：每页约 1,600 tokens（150 DPI）

对于 100 页 PDF，全部栅格化约消耗 160K tokens。只栅格化与问题相关的页面。

### 选择读取策略

**文字密集文档**（报告、文章、书籍）：
→ 文本提取为主。仅对特定图表或布局相关页面栅格化。

**扫描文档**（无可提取文本）：
→ 以 150 DPI 栅格化页面并视觉读取。（注：离线环境不含 OCR 引擎，如需批量文字提取请用户另行处理。）

**幻灯片 PDF**（导出的演示文稿）：
→ 每页都是视觉为主。按需栅格化单页。

**表单密集文档**：
→ 先程序化提取表单字段值（见下文）。需要视觉上下文时栅格化表单页。

**数据密集文档**（表格、图表、图形）：
→ 用 pdfplumber 提取表格。栅格化含图表/图形的页面。

### 提取嵌入图片

```python
import fitz

doc = fitz.open("document.pdf")

# 列出所有嵌入图片
for page_num, page in enumerate(doc):
    for img_index, img in enumerate(page.get_images()):
        xref = img[0]
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha > 3:  # CMYK 或其他非 RGB
            pix = fitz.Pixmap(fitz.csRGB, pix)
        pix.save(f"/tmp/img_p{page_num+1}_{img_index}.png")
        print(f"第 {page_num+1} 页 图片 {img_index}: {pix.width}x{pix.height}")

# 仅提取指定页面（第3页，0-indexed=2）
page = doc[2]
for img_index, img in enumerate(page.get_images()):
    xref = img[0]
    pix = fitz.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    pix.save(f"/tmp/img_{img_index}.png")
```

**注意——矢量图形：** `get_images()` 只提取光栅图片数据。矢量绘制的图表和示意图（常见于 matplotlib、Excel、R 导出）**不会出现**——它们是页面内容操作符。对这些用 `page.get_pixmap()` 栅格化整页。

**注意——空图片：** 有时会提取出很多微小图片——通常是背景遮罩、透明层或装饰元素。按尺寸过滤找到真正的内容图片。

### 提取文件附件

```python
import fitz

doc = fitz.open("document.pdf")

# 列出所有附件
print(f"附件数: {doc.embfile_count()}")
for i in range(doc.embfile_count()):
    info = doc.embfile_info(i)
    print(f"  {i}: {info['filename']} ({info.get('length', '?')} bytes)")

# 提取所有附件
for i in range(doc.embfile_count()):
    info = doc.embfile_info(i)
    data = doc.embfile_get(i)
    with open(f"/tmp/{info['filename']}", "wb") as f:
        f.write(data)
```

也可以用 pypdf：
```python
import os
from pypdf import PdfReader

reader = PdfReader("document.pdf")
for name, content_list in reader.attachments.items():
    safe_name = os.path.basename(name)
    for content in content_list:
        with open(f"/tmp/{safe_name}", "wb") as f:
            f.write(content)
```

### 提取表单字段数据

```python
from pypdf import PdfReader

reader = PdfReader("form.pdf")

# 仅文本输入字段：
fields = reader.get_form_text_fields()
for name, value in fields.items():
    print(f"{name}: {value}")

# 所有字段类型（复选框、单选按钮、下拉菜单）：
all_fields = reader.get_fields() or {}
for name, field in all_fields.items():
    print(f"{name}: {field.get('/V', '')} (类型: {field.get('/FT', '')})")
```

### 字体诊断

如果文本提取输出乱码，检查字体：

```python
import fitz

doc = fitz.open("document.pdf")
for page in doc:
    for font in page.get_fonts():
        # (xref, ext, type, basefont, name, encoding)
        xref, ext, ftype, basefont, name, encoding = font
        print(f"字体: {basefont}, 类型: {ftype}, 编码: {encoding}")
```

如果字体未嵌入且有自定义编码，PDF 的字符映射可能对文本提取失效。这种情况下栅格化页面，用视觉方式替代。

---

## 快速参考

| 任务 | 工具 | 代码 |
| --- | --- | --- |
| 检查 PDF 信息 | PyMuPDF | `doc.metadata`, `len(doc)` |
| 提取文本 | PyMuPDF | `page.get_text()` |
| 提取文本（表格感知） | pdfplumber | `page.extract_text()` |
| 提取表格 | pdfplumber | `page.extract_tables()` |
| 可视化查看页面 | PyMuPDF | `page.get_pixmap(dpi=150)` |
| 提取图片 | PyMuPDF | `page.get_images()` + `fitz.Pixmap()` |
| 提取附件 | PyMuPDF | `doc.embfile_get(i)` |
| 读取表单字段 | pypdf | `reader.get_fields()` |
| 字体信息 | PyMuPDF | `page.get_fonts()` |

## PDF 表单填写、创建、合并、拆分等操作

此技能仅覆盖**读取和检查**。表单填写、创建、合并、拆分、旋转、水印、加密等 PDF 操作请使用 `pdf/SKILL.md`。
