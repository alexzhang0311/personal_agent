---
name: docx
description: 当用户需要创建、读取、编辑或操作 Word 文档（.docx 文件）时使用此技能。触发条件包括：提到 'Word 文档'、'.docx'，或请求生成带目录、标题、页码、信头等格式的专业文档。也适用于从 .docx 文件提取或重组内容、插入/替换文档中的图片、查找替换、处理修订和批注、或将内容转为精美 Word 文档。不用于 PDF、电子表格或与文档生成无关的编码任务。
metadata:
  icon: FileType
  icon_color: "#58a6ff"
---

# DOCX 创建、编辑和分析

## 概述

.docx 文件本质上是一个包含 XML 文件的 ZIP 压缩包。

> **离线环境限制：** 不支持旧版 `.doc` 文件（需要 LibreOffice 转换）。如遇到请提示用户先手动转为 `.docx`。docx→PDF 转换不可用，内容检查通过 python-docx 直接读取。

## 快速参考

| 任务 | 方法 |
| --- | --- |
| 读取/分析内容 | `python-docx` 读取段落和表格 |
| 创建新文档 | 使用 `docx-js` —— 见下文"创建新文档" |
| 编辑现有文档 | 解包 → 编辑 XML → 重新打包 —— 见下文"编辑现有文档" |

### 读取内容

```python
from docx import Document

doc = Document("document.docx")

# 读取所有段落
for para in doc.paragraphs:
    if para.text.strip():
        print(f"[{para.style.name}] {para.text}")

# 读取所有表格
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])

# 读取页眉/页脚
for section in doc.sections:
    header = section.header
    for para in header.paragraphs:
        print(f"页眉: {para.text}")
```

**带修订的读取**（需要解包查看原始 XML）：
```bash
python scripts/office/unpack.py document.docx unpacked/
# 然后查看 unpacked/word/document.xml
```

### 接受修订

```bash
python scripts/accept_changes.py input.docx output.docx
```

---

## 创建新文档

使用 JavaScript 的 docx-js 库生成 .docx 文件，然后验证。安装：`npm install -g docx`

### 基础设置
```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink,
        InternalHyperlink, Bookmark, FootnoteReferenceRun, PositionalTab,
        PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
        TabStopType, TabStopPosition, Column, SectionType,
        TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign, PageNumber, PageBreak } = require('docx');

const doc = new Document({ sections: [{ children: [/* 内容 */] }] });
Packer.toBuffer(doc).then(buffer => fs.writeFileSync("doc.docx", buffer));
```

### 验证
创建文件后必须验证。验证失败则解包、修复 XML、重新打包。
```bash
python scripts/office/validate.py doc.docx
```

### 页面尺寸

```javascript
// 关键：docx-js 默认 A4，不是 US Letter
sections: [{
  properties: {
    page: {
      size: { width: 12240, height: 15840 },  // 8.5" x 11" (DXA)
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1" 边距
    }
  },
  children: [/* 内容 */]
}]
```

**常用页面尺寸（DXA 单位，1440 DXA = 1 英寸）：**

| 纸张 | 宽度 | 高度 | 内容宽度（1" 边距） |
| --- | --- | --- | --- |
| US Letter | 12,240 | 15,840 | 9,360 |
| A4（默认） | 11,906 | 16,838 | 9,026 |

**横向：** docx-js 内部交换宽高，传纵向尺寸 + `orientation: PageOrientation.LANDSCAPE`。

### 样式（覆盖内置标题）

```javascript
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("标题")] }),
    ]
  }]
});
```

### 列表（绝不使用 Unicode 符号）

```javascript
// ❌ 错误
new Paragraph({ children: [new TextRun("• 项目")] })

// ✅ 正确
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    children: [
      new Paragraph({ numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("无序列表项")] }),
    ]
  }]
});
```

### 表格

**关键：表格需要双重宽度设定。**

```javascript
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4680, 4680],
  rows: [
    new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun("单元格")] })]
        })
      ]
    })
  ]
})
```

### 图片

```javascript
new Paragraph({
  children: [new ImageRun({
    type: "png",
    data: fs.readFileSync("image.png"),
    transformation: { width: 200, height: 150 },
    altText: { title: "标题", description: "描述", name: "名称" }
  })]
})
```

### 分页符

```javascript
new Paragraph({ children: [new PageBreak()] })
```

### 超链接

```javascript
new Paragraph({
  children: [new ExternalHyperlink({
    children: [new TextRun({ text: "点击这里", style: "Hyperlink" })],
    link: "https://example.com",
  })]
})
```

### 目录

```javascript
new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" })
```

### 页眉/页脚

```javascript
sections: [{
  headers: {
    default: new Header({ children: [new Paragraph({ children: [new TextRun("页眉")] })] })
  },
  footers: {
    default: new Footer({ children: [new Paragraph({
      children: [new TextRun("第 "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" 页")]
    })] })
  },
  children: [/* 内容 */]
}]
```

### docx-js 关键规则

- **显式设置页面尺寸** —— 默认 A4
- **横向：传纵向尺寸** —— docx-js 内部交换
- **绝不用 `\n`** —— 用独立 Paragraph
- **绝不用 Unicode 项目符号** —— 用 `LevelFormat.BULLET`
- **PageBreak 必须在 Paragraph 内**
- **ImageRun 必须指定 `type`**
- **表格 `width` 始终用 DXA**（不用 PERCENTAGE）
- **表格需要双重宽度** —— `columnWidths` + 单元格 `width`
- **用 `ShadingType.CLEAR`** —— 绝不用 SOLID
- **绝不用表格做分隔线**
- **TOC 仅需 HeadingLevel**
- **覆盖内置样式用精确 ID**："Heading1"、"Heading2"
- **包含 `outlineLevel`** —— TOC 必需

---

## 编辑现有文档

**严格按顺序执行 3 个步骤。**

### 步骤 1：解包
```bash
python scripts/office/unpack.py document.docx unpacked/
```

### 步骤 2：编辑 XML

编辑 `unpacked/word/` 中的文件。

**修订和批注使用 "Claude" 作为作者**，除非用户明确指定其他名称。

**直接用编辑工具做字符串替换。不要写 Python 脚本。**

**关键：新内容使用智能引号。**
| 实体 | 字符 |
| --- | --- |
| `&#x2018;` | '（左单引号） |
| `&#x2019;` | '（右单引号/撇号） |
| `&#x201C;` | "（左双引号） |
| `&#x201D;` | "（右双引号） |

**添加批注：**
```bash
python scripts/comment.py unpacked/ 0 "批注文本"
python scripts/comment.py unpacked/ 1 "回复文本" --parent 0
```

### 步骤 3：打包
```bash
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```

---

## XML 参考

### 修订

**插入：**
```xml
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>插入的文本</w:t></w:r>
</w:ins>
```

**删除：**
```xml
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>删除的文本</w:delText></w:r>
</w:del>
```

**最小编辑 —— 只标记变化的部分：**
```xml
<w:r><w:t>期限为 </w:t></w:r>
<w:del w:id="1" w:author="Claude" w:date="...">
  <w:r><w:delText>30</w:delText></w:r>
</w:del>
<w:ins w:id="2" w:author="Claude" w:date="...">
  <w:r><w:t>60</w:t></w:r>
</w:ins>
<w:r><w:t> 天。</w:t></w:r>
```

### 批注

**`<w:commentRangeStart>` 和 `<w:commentRangeEnd>` 是 `<w:r>` 的兄弟节点，绝不在 `<w:r>` 内部。**

```xml
<w:commentRangeStart w:id="0"/>
<w:r><w:t>被批注的文本</w:t></w:r>
<w:commentRangeEnd w:id="0"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>
```

---

## 依赖

- **python-docx**：文档读取
- **docx**（npm）：`npm install -g docx`（创建新文档）
- **scripts/office/**：解包/打包/验证（纯 Python，无外部依赖）
