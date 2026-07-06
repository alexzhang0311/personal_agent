# 文档处理技能包（离线部署版）

面向 Claude Code / Agent 的文档处理技能集。**纯 pip + npm 安装，无需 apt install 系统包**（除已有的 jq）。

## 离线适配要点

| 原始依赖 | 替代方案 |
| --- | --- |
| poppler-utils (6 个命令行工具) | **PyMuPDF (fitz)** 全部覆盖 |
| pandoc | **python-docx** + **ebooklib** |
| libreoffice (公式重算) | **formulas** 库纯 Python 求值 |
| libreoffice (格式转换) | 不支持旧版 .doc/.ppt（提示用户手动转换） |
| libreoffice (docx/pptx→PDF) | 不可用（内容 QA 改用程序化检查） |
| tesseract-ocr + pytesseract | 已移除（不需要 OCR） |
| qpdf / pdftk | **pypdf** 已覆盖 |

## 目录结构

```
document-skills/
├── README.md
├── requirements.txt          # Python 依赖汇总（纯 pip）
├── file-reading/
│   └── SKILL.md              # 文件读取路由分发器
├── pdf/
│   ├── SKILL.md              # PDF 写操作
│   ├── FORMS.md              # PDF 表单填写参考
│   ├── REFERENCE.md          # 高级 PDF 处理参考
│   └── scripts/              # PDF 处理脚本
├── pdf-reading/
│   ├── SKILL.md              # PDF 读取与检查
│   └── REFERENCE.md          # 高级 PDF 读取参考
├── docx/
│   ├── SKILL.md              # Word 文档创建、编辑、分析
│   └── scripts/              # 解包/打包/验证脚本（纯 Python）
├── xlsx/
│   ├── SKILL.md              # 电子表格创建、编辑、分析
│   └── scripts/              # Office 工具脚本
└── pptx/
    ├── SKILL.md              # 演示文稿创建、编辑、分析
    ├── editing.md            # 编辑工作流
    ├── pptxgenjs.md          # 从头创建指南
    └── scripts/              # 工具脚本
```

## 安装

### Python 依赖
```bash
pip install -r requirements.txt
```

### Node.js 依赖
```bash
npm install -g docx pptxgenjs
```

### 离线安装
```bash
# 在有网络的机器上下载
pip download -r requirements.txt -d ./pip-packages/
npm pack docx pptxgenjs

# 在离线机器上安装
pip install --no-index --find-links=./pip-packages/ -r requirements.txt
npm install -g docx-*.tgz pptxgenjs-*.tgz
```

## 技能清单

| 目录 | 职责 | 覆盖格式 |
| --- | --- | --- |
| `file-reading/` | 文件读取路由分发器 | 所有格式 |
| `pdf-reading/` | PDF 读取与检查 | .pdf |
| `pdf/` | PDF 写操作 | .pdf |
| `docx/` | Word 文档全流程 | .docx |
| `xlsx/` | 电子表格全流程 | .xlsx, .xlsm, .xls, .ods, .csv, .tsv |
| `pptx/` | 演示文稿全流程 | .pptx |

## 路径约定

文件上传路径：`<cwd>/temp/uploads/<current_date>/<file_uid>.<ext>`

## 不支持的功能

- 旧版 `.doc` / `.ppt` 文件（需要 LibreOffice 转换）
- OCR 扫描件文字识别（需要 tesseract）
- pptx/docx → PDF 转换（需要 LibreOffice）
- Excel 公式中的 INDIRECT/OFFSET 等动态引用函数（formulas 库限制）
