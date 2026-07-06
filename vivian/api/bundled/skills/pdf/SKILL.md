---
name: pdf
description: 当用户需要对 PDF 文件进行任何操作时使用此技能。包括读取/提取文本和表格、合并多个 PDF、拆分 PDF、旋转页面、添加水印、创建新 PDF、填写 PDF 表单、加密/解密 PDF、提取图片。如果用户提到 .pdf 文件或要求生成 PDF，使用此技能。
metadata:
  icon: FileText
  icon_color: "#f85149"
---

# PDF 处理指南

## 概述

本指南使用纯 Python 库处理 PDF，无需系统依赖。核心库：pypdf（读写操作）、pdfplumber（表格提取）、reportlab（创建）、PyMuPDF（图片提取和栅格化）。如需填写 PDF 表单，请阅读 FORMS.md。

## 快速开始

```python
from pypdf import PdfReader, PdfWriter

# 读取 PDF
reader = PdfReader("document.pdf")
print(f"页数: {len(reader.pages)}")

# 提取文本
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python 库

### pypdf - 基础操作

#### 合并 PDF
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### 拆分 PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### 提取元数据
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"标题: {meta.title}")
print(f"作者: {meta.author}")
```

#### 旋转页面
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # 顺时针旋转 90 度
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - 文本和表格提取

#### 带布局的文本提取
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### 提取表格
```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"第 {i+1} 页 表格 {j+1}:")
            for row in table:
                print(row)
```

#### 高级表格提取
```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### PyMuPDF - 图片提取和栅格化

#### 提取嵌入图片
```python
import fitz

doc = fitz.open("document.pdf")
for page_num, page in enumerate(doc):
    for img_index, img in enumerate(page.get_images()):
        xref = img[0]
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        pix.save(f"/tmp/img_p{page_num+1}_{img_index}.png")
```

#### 栅格化页面为图片
```python
import fitz

doc = fitz.open("document.pdf")
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=150)
    pix.save(f"/tmp/page-{i+1}.png")
```

### reportlab - 创建 PDF

#### 基础 PDF 创建
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

c.drawString(100, height - 100, "Hello World!")
c.line(100, height - 140, 400, height - 140)
c.save()
```

#### 创建多页 PDF
```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

title = Paragraph("报告标题", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("这是报告正文内容。" * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

story.append(Paragraph("第 2 页", styles['Heading1']))
story.append(Paragraph("第 2 页的内容", styles['Normal']))

doc.build(story)
```

#### 上下标

**重要**：绝对不要在 ReportLab PDF 中使用 Unicode 上下标字符。内置字体不包含这些字形，会渲染为黑色方块。

使用 ReportLab 的 XML 标记：
```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet
styles = getSampleStyleSheet()

chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

## 常见任务

### 添加水印
```python
from pypdf import PdfReader, PdfWriter

watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### 密码保护
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

writer.encrypt("用户密码", "所有者密码")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

### 解除密码
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("encrypted.pdf")
if reader.is_encrypted:
    reader.decrypt("password")

writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

with open("decrypted.pdf", "wb") as output:
    writer.write(output)
```

## 快速参考

| 任务 | 最佳工具 | 代码 |
| --- | --- | --- |
| 合并 PDF | pypdf | `writer.add_page(page)` |
| 拆分 PDF | pypdf | 每页一个文件 |
| 提取文本 | pdfplumber | `page.extract_text()` |
| 提取表格 | pdfplumber | `page.extract_tables()` |
| 创建 PDF | reportlab | Canvas 或 Platypus |
| 提取图片 | PyMuPDF | `page.get_images()` |
| 栅格化页面 | PyMuPDF | `page.get_pixmap(dpi=150)` |
| 加密/解密 | pypdf | `writer.encrypt()` / `reader.decrypt()` |
| 填写 PDF 表单 | pypdf（见 FORMS.md） | 见 FORMS.md |
