---
name: pptx
description: 任何涉及 .pptx 文件的场景都使用此技能——无论是输入、输出还是两者兼有。包括：创建幻灯片、PPT、演示文稿；读取、解析或提取 .pptx 中的文本；编辑、修改或更新现有演示文稿；合并或拆分幻灯片文件；处理模板、布局、演讲者备注或批注。
metadata:
  icon: Presentation
  icon_color: "#ffa657"
---

# PPTX 技能

> **离线环境限制：** 不支持旧版 `.ppt` 文件。pptx→PDF 转换和基于图片的视觉 QA 不可用（需要 LibreOffice），内容 QA 通过 markitdown / python-pptx 完成。

## 快速参考

| 任务 | 指南 |
| --- | --- |
| 读取/分析内容 | `python -m markitdown presentation.pptx` |
| 编辑或基于模板创建 | 阅读 [editing.md](editing.md) |
| 从头创建 | 阅读 [pptxgenjs.md](pptxgenjs.md) |

---

## 读取内容

```bash
# 文本提取
python -m markitdown presentation.pptx
```

```python
# 程序化读取
from itertools import islice
from pptx import Presentation

p = Presentation("presentation.pptx")
print(f"{len(p.slides)} 张幻灯片")
for i, slide in enumerate(p.slides, 1):
    texts = [s.text for s in slide.shapes if s.has_text_frame]
    print(f"幻灯片 {i}:", " | ".join(t for t in texts if t))
```

```bash
# 原始 XML
python scripts/office/unpack.py presentation.pptx unpacked/
```

---

## 编辑工作流

**详细操作请阅读 [editing.md](editing.md)。**

1. 分析模板结构
2. 解包 → 操作幻灯片 → 编辑内容 → 清理 → 打包

---

## 从头创建

**详细操作请阅读 [pptxgenjs.md](pptxgenjs.md)。**

无模板或参考演示文稿时使用 pptxgenjs。

---

## 设计理念

**不要做无聊的幻灯片。** 白底纯文字列表不会打动任何人。

### 开始之前

- **选择大胆的、与内容相关的配色方案**
- **主次分明**：一种颜色占主导（60-70%），1-2 种辅助色 + 一种强调色
- **深浅对比**：标题+结论用深色背景，内容用浅色
- **坚持一个视觉母题**：一个独特元素贯穿全部幻灯片

### 配色方案参考

| 主题 | 主色 | 辅色 | 强调色 |
| --- | --- | --- | --- |
| **午夜商务** | `1E2761` | `CADCFC` | `FFFFFF` |
| **森林苔藓** | `2C5F2D` | `97BC62` | `F5F5F5` |
| **珊瑚活力** | `F96167` | `F9E795` | `2F3C7E` |
| **暖赤陶** | `B85042` | `E7E8D1` | `A7BEAE` |
| **海洋渐变** | `065A82` | `1C7293` | `21295C` |
| **炭灰极简** | `36454F` | `F2F2F2` | `212121` |
| **青绿信任** | `028090` | `00A896` | `02C39A` |
| **浆果奶油** | `6D2E46` | `A26769` | `ECE2D0` |
| **鼠尾草宁静** | `84B59F` | `69A297` | `50808E` |
| **樱桃大胆** | `990011` | `FCF6F5` | `2F3C7E` |

### 每张幻灯片

**每张幻灯片都需要视觉元素** —— 图片、图表、图标或形状。

**布局选项：** 双栏、图标+文字行、2x2/2x3 网格、半出血图片

**数据展示：** 大数字亮点（60-72pt）、对比列、时间线/流程图

### 字体

| 标题字体 | 正文字体 |
| --- | --- |
| Georgia | Calibri |
| Arial Black | Arial |
| Cambria | Calibri |
| Trebuchet MS | Calibri |

| 元素 | 大小 |
| --- | --- |
| 幻灯片标题 | 36-44pt 粗体 |
| 章节标题 | 20-24pt 粗体 |
| 正文 | 14-16pt |
| 注释 | 10-12pt |

### 间距

- 最小 0.5" 边距
- 内容块间 0.3-0.5"
- 留出呼吸空间

### 避免

- **不要重复相同布局**
- **不要居中正文** —— 左对齐；仅标题居中
- **不要忽视大小对比** —— 标题 36pt+
- **不要默认蓝色**
- **不要做纯文字幻灯片**
- **绝不在标题下使用装饰线** —— AI 生成幻灯片的标志

---

## QA（必须做）

**假设存在问题。你的工作是找到它们。**

### 内容 QA

```bash
python -m markitdown output.pptx
```

检查缺失内容、拼写错误、顺序错误。

**检查残留占位符文本：**

```bash
python -m markitdown output.pptx | grep -iE "\bx{3,}\b|lorem|ipsum|\bTODO|\[insert"
```

### 结构 QA（替代视觉 QA）

离线环境无法做 pptx→PDF→图片 的视觉检查。改用程序化检查：

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu

p = Presentation("output.pptx")
slide_width = p.slide_width
slide_height = p.slide_height

for i, slide in enumerate(p.slides, 1):
    print(f"\n=== 幻灯片 {i} ===")
    for shape in slide.shapes:
        # 检查元素是否超出幻灯片边界
        if shape.left < 0 or shape.top < 0:
            print(f"  ⚠️ {shape.shape_type}: 负坐标 ({shape.left}, {shape.top})")
        if shape.left + shape.width > slide_width:
            print(f"  ⚠️ {shape.shape_type}: 超出右边界")
        if shape.top + shape.height > slide_height:
            print(f"  ⚠️ {shape.shape_type}: 超出底边界")

        # 检查文本框内容
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                if para.text.strip():
                    print(f"  [{shape.left/914400:.1f}\", {shape.top/914400:.1f}\"] {para.text[:60]}")
```

### 验证循环

1. 生成幻灯片 → markitdown 检查内容 → 程序化检查结构
2. **列出发现的问题**
3. 修复问题
4. **重新验证**
5. 重复直到一轮完整检查没有新问题

---

## 依赖

- `pip install "markitdown[pptx]"` - 文本提取
- `pip install python-pptx` - 读取和分析
- `pip install Pillow` - 图片处理
- `npm install -g pptxgenjs` - 从头创建
