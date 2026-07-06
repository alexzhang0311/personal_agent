---
name: file-reading
description: 当用户上传了文件但内容不在你的上下文中时使用此技能。这是一个路由分发器：根据文件类型（pdf、docx、xlsx、csv、json、图片、压缩包、电子书）告诉你应该用什么工具、以什么方式读取，避免对二进制文件盲目 cat。触发条件：用户提到上传文件路径、或询问已上传但尚未读取的文件内容。如果文件内容已经在上下文中（documents 块内可见），则不需要使用此技能。
metadata:
  icon: FolderSearch
  icon_color: "#79c0ff"
---

# 读取上传文件

## 此技能存在的意义

当用户上传文件时，文件会写入 `<cwd>/temp/uploads/<current_date>/<file_uid>.<ext>`，**内容不在你的上下文中**，你需要主动去读取。

直接 `cat` 对大多数文件来说是错误的：

- PDF 会输出二进制乱码
- 100MB 的 CSV 会把上下文塞满无用数据
- DOCX 会输出原始 ZIP 字节
- 图片文件完全无法处理

此技能告诉你每种文件类型的正确首步操作，以及何时交接给更深层的专用技能。

## 通用协议

1. **看扩展名。** 扩展名是你的分发键。
2. **先 stat 再读。** 大文件需要采样，不要全量读取。
   ```bash
   stat -c '%s bytes, %y' <cwd>/temp/uploads/<current_date>/report.pdf
   file <cwd>/temp/uploads/<current_date>/report.pdf
   ```
3. **只读够回答问题所需的量。** 如果用户只是问"这个 CSV 有多少行"，不需要加载到 pandas——`wc -l` 就能给出近似值。
4. **如果有专用技能，去读它。** 下表告诉你何时交接。

## 分发表

| 扩展名 | 首选操作 | 专用技能 |
| --- | --- | --- |
| `.pdf` | PyMuPDF 内容清单（见 PDF 章节） | `pdf-reading/SKILL.md` |
| `.docx` | `python-docx` 读取段落 | `docx/SKILL.md` |
| `.xlsx`, `.xlsm` | `openpyxl` 读 sheet 名 + head | `xlsx/SKILL.md` |
| `.xls`（旧版） | `pd.read_excel(engine="xlrd")` | `xlsx/SKILL.md` |
| `.ods` | `pd.read_excel(engine="odf")` | `xlsx/SKILL.md` |
| `.pptx` | `python-pptx` 获取幻灯片数 | `pptx/SKILL.md` |
| `.csv`, `.tsv` | `pandas` + `nrows` | —（见下文） |
| `.json`, `.jsonl` | `jq` 探查结构 | —（见下文） |
| `.jpg`, `.png`, `.gif`, `.webp` | 已作为视觉输入注入上下文 | —（见下文） |
| `.zip`, `.tar`, `.tar.gz` | 列出内容，**不要**自动解压 | —（见下文） |
| `.gz`（单文件） | `zcat | head` | —（见下文） |
| `.epub` | `ebooklib` + `BeautifulSoup` | —（见下文） |
| `.txt`, `.md`, `.log`, 代码文件 | `wc -c` 然后 `head` 或 `cat` | —（见下文） |
| 未知 | `file` 命令判断后决定 | — |

> **不支持的格式：** 旧版 `.doc`、`.ppt` 需要 LibreOffice 转换，离线环境不可用。如遇到请提示用户先手动转为 `.docx` / `.pptx`。

---

## PDF

**绝对不要** `cat` PDF——会输出二进制乱码。

快速首步——使用 PyMuPDF 获取页数并检查文本是否可提取：

```python
import fitz

doc = fitz.open("<cwd>/temp/uploads/<current_date>/report.pdf")
print(f"页数: {len(doc)}")
print(f"元数据: {doc.metadata}")

# 快速文本检查
text = doc[0].get_text()
print(text[:2000] if text.strip() else "⚠️ 首页无可提取文本，可能是扫描件")
```

更复杂的操作（图表、表格、附件、表单、可视化检查、选择读取策略）请去读 `pdf-reading/SKILL.md`。

PDF 表单填写、创建、合并、拆分、水印等操作请去读 `pdf/SKILL.md`。

---

## DOCX

`docx/SKILL.md` 覆盖编辑、创建、修订等完整操作。快速查看：

```python
from docx import Document

doc = Document("<cwd>/temp/uploads/<current_date>/memo.docx")
for para in doc.paragraphs[:20]:
    if para.text.strip():
        print(para.text)
```

---

## XLSX / XLS / 电子表格

`xlsx/SKILL.md` 覆盖公式、格式、图表、创建等完整操作。快速查看 `.xlsx` / `.xlsm`：

```python
from openpyxl import load_workbook
wb = load_workbook("<cwd>/temp/uploads/<current_date>/data.xlsx", read_only=True)
print("工作表:", wb.sheetnames)
ws = wb.active
for row in ws.iter_rows(max_row=5, values_only=True):
    print(row)
```

`read_only=True` 很重要——不加的话 openpyxl 会把整个工作簿加载到内存，大文件会崩溃。不要在 read-only 模式下信任 `ws.max_row`：很多非 Excel 写入器会省略 dimension 记录，返回 `None` 或错误值。

**旧版 `.xls`** —— openpyxl 报 `InvalidFileException`。使用：

```python
import pandas as pd
df = pd.read_excel("<cwd>/temp/uploads/<current_date>/old.xls", engine="xlrd", nrows=5)
```

**`.ods`（OpenDocument）** —— openpyxl 同样拒绝。使用：

```python
import pandas as pd
df = pd.read_excel("<cwd>/temp/uploads/<current_date>/data.ods", engine="odf", nrows=5)
```

---

## PPTX

```python
from itertools import islice
from pptx import Presentation
p = Presentation("<cwd>/temp/uploads/<current_date>/deck.pptx")
print(f"{len(p.slides)} 张幻灯片")
for i, slide in enumerate(islice(p.slides, 3), 1):
    texts = [s.text for s in slide.shapes if s.has_text_frame]
    print(f"幻灯片 {i}:", " | ".join(t for t in texts if t))
```

`p.slides` 不支持下标切片——`p.slides[:3]` 会报 `AttributeError`。使用 `islice` 或 `list(p.slides)[:3]`。

更多操作请去读 `pptx/SKILL.md`。

---

## CSV / TSV

**不要**盲目 `cat` 或 `head`。使用 pandas + `nrows`：

```python
import pandas as pd
df = pd.read_csv("<cwd>/temp/uploads/<current_date>/data.csv", nrows=5)
print(df)
print()
print(df.dtypes)
```

近似行数（不加载全量）：

```bash
wc -l <cwd>/temp/uploads/<current_date>/data.csv
```

TSV：相同，加 `sep="\t"`。

---

## JSON / JSONL

先探查结构，再看内容：

```bash
jq 'type' <cwd>/temp/uploads/<current_date>/data.json
jq 'if type == "array" then length elif type == "object" then keys else . end' <cwd>/temp/uploads/<current_date>/data.json
```

JSONL（每行一个对象）——**不要**对整个文件 `jq`，逐行处理：

```bash
head -3 <cwd>/temp/uploads/<current_date>/data.jsonl | jq .
wc -l <cwd>/temp/uploads/<current_date>/data.jsonl
```

---

## 图片（JPG / PNG / GIF / WEBP）

**上传的图片已经作为视觉输入注入上下文了。** 你不需要从磁盘读取就能描述它们。

磁盘副本仅在需要**程序化处理**图片时使用：

```python
from PIL import Image
img = Image.open("<cwd>/temp/uploads/<current_date>/photo.jpg")
print(img.size, img.mode, img.format)
```

---

## 压缩包（ZIP / TAR / TAR.GZ）

**先列出内容。不要解压——除非用户明确要求。**

```bash
unzip -l <cwd>/temp/uploads/<current_date>/bundle.zip
tar -tf <cwd>/temp/uploads/<current_date>/bundle.tar
```

如果用户只要压缩包内的某个文件，只提取那一个：

```bash
unzip -p <cwd>/temp/uploads/<current_date>/bundle.zip path/inside/file.txt
```

**独立 `.gz`**：

```bash
zcat <cwd>/temp/uploads/<current_date>/data.json.gz | head -50
```

---

## EPUB

```python
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

book = epub.read_epub("<cwd>/temp/uploads/<current_date>/book.epub")
for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
    soup = BeautifulSoup(item.get_content(), 'html.parser')
    text = soup.get_text()
    if text.strip():
        print(text[:2000])
        break  # 先看第一章
```

长电子书只读开头——你很少需要全部内容来回答问题。

---

## 纯文本 / 代码 / 日志

先检查大小：

```bash
wc -c <cwd>/temp/uploads/<current_date>/app.log
```

- **小于 ~20KB**：`cat` 即可。
- **大于 ~20KB**：`head -100` 和 `tail -100` 先定位。

日志文件用户几乎总是关心末尾：

```bash
tail -200 <cwd>/temp/uploads/<current_date>/app.log
```

---

## 未知扩展名

```bash
file <cwd>/temp/uploads/<current_date>/mystery.bin
xxd <cwd>/temp/uploads/<current_date>/mystery.bin | head -5
```

`file` 能识别大多数类型。`xxd` head 显示魔数字节。如果 `file` 返回 "data" 且十六进制没有匹配项，直接问用户这是什么文件，不要猜测。
