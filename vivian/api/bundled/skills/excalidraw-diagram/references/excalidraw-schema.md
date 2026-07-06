# Excalidraw JSON Schema 参考

## 配色方案

### 主色
| 用途 | 颜色 | 十六进制 |
|---------|-------|-----|
| 主标题 | 深蓝 | `#1e40af` |
| 副标题 | 中蓝 | `#3b82f6` |
| 正文文字 | 深灰 | `#374151` |
| 强调 | 橙色 | `#f59e0b` |
| 成功 | 绿色 | `#10b981` |
| 警告 | 红色 | `#ef4444` |

### 背景色
| 用途 | 颜色 | 十六进制 |
|---------|-------|-----|
| 浅蓝 | 背景 | `#dbeafe` |
| 浅灰 | 中性 | `#f3f4f6` |
| 浅橙 | 高亮 | `#fef3c7` |
| 浅绿 | 成功 | `#d1fae5` |
| 浅紫 | 点缀 | `#ede9fe` |

## 元素类型

### 矩形（Rectangle）
```json
{
  "type": "rectangle",
  "id": "unique-id",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 80,
  "strokeColor": "#1e40af",
  "backgroundColor": "#dbeafe",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roughness": 1,
  "opacity": 100,
  "roundness": { "type": 3 }
}
```

### 文本（Text）
```json
{
  "type": "text",
  "id": "unique-id",
  "x": 150,
  "y": 130,
  "width": 120,
  "height": 25,
  "text": "Content here",
  "fontSize": 20,
  "fontFamily": 5,
  "textAlign": "center",
  "verticalAlign": "middle",
  "strokeColor": "#1e40af",
  "backgroundColor": "transparent"
}
```

Text elements must always include non-zero `width` and `height`. Estimate `width` from rendered text (CJK ~= `fontSize`, ASCII ~= `fontSize * 0.6`, spaces ~= `fontSize * 0.45`) and `height = ceil(lineCount * fontSize * lineHeight)`.

### 箭头（Arrow）
```json
{
  "type": "arrow",
  "id": "unique-id",
  "x": 300,
  "y": 140,
  "width": 100,
  "height": 0,
  "points": [[0, 0], [100, 0]],
  "strokeColor": "#374151",
  "strokeWidth": 2,
  "startArrowhead": null,
  "endArrowhead": "arrow"
}
```

Arrow `points` must be nested coordinate pairs relative to `x` / `y`: `[[0, 0], [100, 0]]`. Do not use a flat array such as `[0, 0, 100, 0]`. Arrowhead keys are exactly `startArrowhead` and `endArrowhead`.

### 椭圆（Ellipse）
```json
{
  "type": "ellipse",
  "id": "unique-id",
  "x": 100,
  "y": 100,
  "width": 120,
  "height": 120,
  "strokeColor": "#10b981",
  "backgroundColor": "#d1fae5",
  "fillStyle": "solid"
}
```

### 菱形（Diamond）
```json
{
  "type": "diamond",
  "id": "unique-id",
  "x": 100,
  "y": 100,
  "width": 150,
  "height": 100,
  "strokeColor": "#f59e0b",
  "backgroundColor": "#fef3c7",
  "fillStyle": "solid"
}
```

### 直线（Line）
```json
{
  "type": "line",
  "id": "unique-id",
  "x": 100,
  "y": 100,
  "points": [[0, 0], [200, 100]],
  "strokeColor": "#374151",
  "strokeWidth": 2
}
```

Line `points` must be nested coordinate pairs relative to `x` / `y`: `[[0, 0], [200, 100]]`. Do not use a flat array such as `[0, 0, 200, 100]`.

## 完整 JSON 结构

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    // 元素数组
  ],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

## 字体（fontFamily）取值

| 取值 | 字体名称 |
|-------|-----------|
| 1 | Virgil（手写体） |
| 2 | Helvetica |
| 3 | Cascadia |
| 4 | Assistant |
| 5 | Excalifont（推荐） |

## 填充样式（Fill Styles）

- `solid` —— 实心填充
- `hachure` —— 斜线填充
- `cross-hatch` —— 交叉斜线填充
- `dots` —— 点状填充

## 圆角类型（Roundness Types）

- `{ "type": 1 }` —— 直角
- `{ "type": 2 }` —— 轻微圆角
- `{ "type": 3 }` —— 完全圆角（推荐）

## 元素绑定（Element Binding）

将文本绑定到容器：

```json
{
  "type": "rectangle",
  "id": "container-id",
  "boundElements": [{ "id": "text-id", "type": "text" }]
}
```

```json
{
  "type": "text",
  "id": "text-id",
  "containerId": "container-id"
}
```

## 箭头绑定（Arrow Binding）

将箭头连接到形状：

```json
{
  "type": "arrow",
  "startBinding": {
    "elementId": "source-shape-id",
    "focus": 0,
    "gap": 5
  },
  "endBinding": {
    "elementId": "target-shape-id",
    "focus": 0,
    "gap": 5
  }
}
```
