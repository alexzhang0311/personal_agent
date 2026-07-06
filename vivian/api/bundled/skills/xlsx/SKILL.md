---
name: xlsx
description: 当电子表格文件是主要输入或输出时使用此技能。包括：打开、读取、编辑或修复现有 .xlsx/.xlsm/.csv/.tsv 文件；从头创建新电子表格；或在表格文件格式之间转换。当用户以任何方式提到电子表格文件时触发。也适用于将混乱的表格数据文件整理为规范电子表格。交付物必须是电子表格文件。
metadata:
  icon: Sheet
  icon_color: "#3fb950"
---

# 输出要求

## 所有 Excel 文件

### 专业字体
- 使用一致的专业字体（如 Arial、Times New Roman），除非用户另有指示

### 零公式错误
- 每个 Excel 模型交付时必须零公式错误（#REF!、#DIV/0!、#VALUE!、#N/A、#NAME?）

### 保留现有模板
- 修改文件时精确匹配现有格式、样式和约定

## 财务模型

### 颜色编码标准

- **蓝色文字** (0,0,255)：硬编码输入
- **黑色文字** (0,0,0)：所有公式和计算
- **绿色文字** (0,128,0)：从其他工作表拉取的链接
- **红色文字** (255,0,0)：到其他文件的外部链接
- **黄色背景** (255,255,0)：需要关注的关键假设

### 数字格式标准

- **年份**：文本字符串（"2024" 非 "2,024"）
- **货币**：$#,##0，表头指定单位
- **零值**：显示为 "-"
- **百分比**：0.0% 格式
- **倍数**：0.0x
- **负数**：括号 (123) 非 -123

### 公式构建规则

- 假设放独立单元格，用引用替代硬编码
- 用 `=B5*(1+$B$6)` 而非 `=B5*1.05`

---

# XLSX 创建、编辑和分析

## 读取和分析数据

```python
import pandas as pd

df = pd.read_excel('file.xlsx')
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)

df.head()
df.info()
df.describe()

df.to_excel('output.xlsx', index=False)
```

## 关键：使用公式，不要硬编码计算值

```python
# ❌ 错误
sheet['B10'] = df['Sales'].sum()  # 硬编码

# ✅ 正确
sheet['B10'] = '=SUM(B2:B9)'
sheet['C5'] = '=(C4-C2)/C2'
sheet['D20'] = '=AVERAGE(D2:D19)'
```

## 通用工作流

1. **选择工具**：pandas 用于数据，openpyxl 用于公式/格式
2. **创建/加载**：创建新工作簿或加载现有文件
3. **修改**：添加/编辑数据、公式和格式
4. **保存**：写入文件
5. **重算公式（使用公式时必须做）**：使用 formulas 库
6. **验证**：检查错误

### 创建新 Excel 文件

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
sheet = wb.active

sheet['A1'] = 'Hello'
sheet['B1'] = 'World'
sheet.append(['行', '数据', '示例'])

sheet['B2'] = '=SUM(A1:A10)'

sheet['A1'].font = Font(bold=True, color='FF0000')
sheet['A1'].fill = PatternFill('solid', start_color='FFFF00')
sheet['A1'].alignment = Alignment(horizontal='center')

sheet.column_dimensions['A'].width = 20

wb.save('output.xlsx')
```

### 编辑现有 Excel 文件

```python
from openpyxl import load_workbook

wb = load_workbook('existing.xlsx')
sheet = wb.active

sheet['A1'] = '新值'
sheet.insert_rows(2)
sheet.delete_cols(3)

new_sheet = wb.create_sheet('新工作表')
new_sheet['A1'] = '数据'

wb.save('modified.xlsx')
```

## 公式重算（formulas 库）

openpyxl 写入的公式只有字符串没有计算值。使用 **formulas** 库纯 Python 求值，**替代 LibreOffice 重算**：

```python
import formulas

# 加载 Excel 文件并求值所有公式
xl_model = formulas.ExcelModel().loads("output.xlsx").finish()
solution = xl_model.calculate()

# ⚠️ 必须传 dict(solution) 浅拷贝，否则 Python 3.13 会抛
#   RuntimeError: OrderedDict mutated during iteration
# （formulas 在遍历 solution 时会就地写回，3.13 严格禁止）
xl_model.write(books=dict(solution))

# 或者写入新目录
xl_model.write(books=dict(solution), dirpath="./calculated")
```

> **Python 3.13 兼容性陷阱**：直接 `xl_model.write(books=solution)` 在 3.13 上
> 必然报 `OrderedDict mutated during iteration`。始终用 `dict(solution)` 包一层。
> 这不是用户脚本的 bug，是 formulas 库未适配 3.13 的严格迭代检查。

### formulas 库注意事项

- **覆盖范围**：支持大部分常用 Excel 函数（SUM、AVERAGE、IF、VLOOKUP、INDEX/MATCH 等），但部分高级函数可能不支持
- **不支持的函数**：INDIRECT、OFFSET 等动态引用函数支持有限
- **循环引用**：不支持迭代求解
- **性能**：大型工作簿（10000+ 公式）可能较慢

### 手动验证公式结果

```python
from openpyxl import load_workbook

# data_only=True 读取缓存的计算值（formulas 写入后）
wb = load_workbook('output_calculated.xlsx', data_only=True)
sheet = wb.active

# 检查关键公式单元格的值
print(f"B10 = {sheet['B10'].value}")  # 应该是数值而非公式字符串
print(f"C5  = {sheet['C5'].value}")

# 扫描错误
for row in sheet.iter_rows():
    for cell in row:
        if isinstance(cell.value, str) and cell.value.startswith('#'):
            print(f"⚠️ 错误 {cell.coordinate}: {cell.value}")
```

### 备选方案：pandas 算值 + 公式并存

如果 formulas 库对某些函数不支持，可以同时写入计算值和公式：

```python
from openpyxl import Workbook

wb = Workbook()
sheet = wb.active

# 写入数据
data = [100, 200, 300, 400]
for i, val in enumerate(data, start=2):
    sheet[f'B{i}'] = val

# 同时写入公式（Excel 打开时会重算）
sheet['B6'] = '=SUM(B2:B5)'

# 但也用 openpyxl 的 data_type 写入缓存值
# 这样即使不重算，查看时也能看到近似值
import openpyxl.utils

wb.save('output.xlsx')
```

## 公式验证清单

### 必要验证
- [ ] **测试 2-3 个示例引用**
- [ ] **列映射**：第 64 列 = BL，不是 BK
- [ ] **行偏移**：DataFrame 第 5 行 = Excel 第 6 行

### 常见陷阱
- [ ] **NaN 处理**：`pd.notna()`
- [ ] **除零**：检查分母
- [ ] **跨 sheet 引用**：Sheet1!A1

## 最佳实践

### 库选择
- **pandas**：数据分析、批量操作、简单数据导出
- **openpyxl**：复杂格式、公式、Excel 特有功能
- **formulas**：公式求值（替代 LibreOffice）

### openpyxl 注意事项
- 单元格索引从 1 开始
- `data_only=True` 读取计算值
- **警告**：`data_only=True` 打开后保存，公式被替换为值
- 大文件：`read_only=True` / `write_only=True`

### pandas 注意事项
- `dtype={'id': str}` 避免推断问题
- `usecols=['A', 'C', 'E']` 大文件读指定列
- `parse_dates=['date_column']` 处理日期

## 代码风格
- 写精简代码，不加多余注释
- 避免冗长变量名和冗余操作
