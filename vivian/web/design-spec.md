# Terminal Codex — Frontend Design Specification
> Agent Ops Console · Internal Tool · Design Version v1.0

---

## §0 Tech Stack & Project Setup

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | React 18 + Vite | Best-known stack for Claude Code; builds to pure static files |
| Styling | Tailwind (locked config) + CSS variables | Tailwind for layout only; colors/radius/shadow via CSS vars |
| State | Zustand | Canvas ↔ message flow sync, minimal boilerplate |
| Icons | lucide-react | stroke-width locked to 1.5 |
| Markdown | react-markdown + remark-gfm + rehype-highlight | github-dark theme matches color palette natively |

### Bootstrap

```bash
npm create vite@latest ops-console -- --template react
cd ops-console
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install lucide-react zustand
npm install react-markdown remark-gfm rehype-highlight highlight.js
```

### Intranet Deployment

Vite builds pure static files. Serve directly from FastAPI — no separate Node.js process needed:

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="dist", html=True), name="static")
```

### Font — Local Setup (No CDN)

**Primary font: Noto Sans** (variable weight woff2), **Code font: JetBrains Mono**. Both loaded locally from `public/fonts/`.

```css
/* src/index.css */
@font-face { font-family: 'Noto Sans';
  src: url('/fonts/NotoSans-Variable.woff2') format('woff2');
  font-weight: 300 700; font-display: swap; }

/* JetBrains Mono — code blocks only */
@font-face { font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400; font-display: swap; }
@font-face { font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Bold.woff2') format('woff2');
  font-weight: 700; font-display: swap; }
```

### Tailwind Locked Config

**Core principle: Tailwind handles layout only. Colors, radius, and shadows are disabled — use CSS variables instead.**

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Full override — no extend — prevents default value leakage
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      // No concrete colors — all written via CSS variables in style props
    },
    borderRadius: {
      none:    '0',
      sm:      '2px',
      DEFAULT: '4px',
      // No lg / xl / full — large radius permanently disabled
    },
    boxShadow: {
      none: 'none',
      // Only none — all shadow-* classes are dead
    },
    fontFamily: {
      sans: ['Noto Sans', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    },
    fontSize: {
      xs:    ['11px', { lineHeight: '16px' }],
      sm:    ['12px', { lineHeight: '18px' }],
      base:  ['13px', { lineHeight: '20px' }],
      md:    ['14px', { lineHeight: '22px' }],
      lg:    ['16px', { lineHeight: '24px' }],
      xl:    ['20px', { lineHeight: '28px' }],
      '2xl': ['24px', { lineHeight: '32px' }],
    },
    spacing: {
      // 4px grid, aligned with --space-* variables
      px: '1px', 0: '0',
      1: '4px',  2: '8px',  3: '12px', 4: '16px',
      5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px',
    },
    extend: {},
  },
  plugins: [],
}
```

### Style Division Rule

```jsx
// ✅ Correct: Tailwind for layout, CSS variables for color
<div className="flex items-center gap-2 px-3 py-2 overflow-hidden"
     style={{ color: 'var(--text-primary)', background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border)' }}>
  <span className="truncate text-sm font-semibold"
        style={{ color: 'var(--text-secondary)' }}>
    Task name
  </span>
</div>

// ❌ Wrong: using Tailwind color palette
<div className="bg-gray-900 text-blue-400 rounded-xl shadow-lg">

// ❌ Wrong: using Tailwind radius / shadow
<button className="rounded-full shadow-md">
```

**Tailwind allowed classes (whitelist):**
- Layout: `flex` `grid` `items-*` `justify-*` `gap-*` `col-span-*`
- Spacing: `p-*` `px-*` `py-*` `m-*` `mx-*` `my-*`
- Sizing: `w-*` `h-*` `min-w-0` `max-w-*` `flex-1` `flex-shrink-0`
- Text: `text-xs` `text-sm` `text-base` `font-light` `font-normal` `font-semibold` `font-bold` `truncate` `whitespace-nowrap` `break-words` `uppercase`
- Overflow: `overflow-hidden` `overflow-x-auto` `overflow-y-auto`
- Position: `relative` `absolute` `fixed` `sticky` `inset-0` `top-*` `left-*` `right-*` `bottom-*`
- Display: `hidden` `block` `inline-flex` `inline-block`
- Transition: `transition` `duration-150` `ease-in-out`
- Radius: `rounded-none` `rounded-sm` `rounded` (2px / 4px only)

**Forbidden Tailwind classes:**
- All color classes: `bg-*` `text-*` `border-*` → use CSS variables
- `shadow-*` (except `shadow-none`)
- `rounded-lg` `rounded-xl` `rounded-full` and above
- `ring-*` `outline-*`

---

## §1 Design Philosophy

**Core metaphor: A living, hardcover technical manual.**

Users are heavy terminal users. The aesthetic anchors are GitHub Dark Default + Noto Sans (UI) / JetBrains Mono (code) + Powerlevel10k.
The goal is not "a pretty AI interface" — it's **the spirit of the terminal, the craft of Stripe**.

The interface should feel: serious, precise, in control. Every pixel has a reason to exist.

---

## §2 Color System

```css
:root {
  /* Background layers — like terminal z-depth */
  --bg-base:       #0d1117;   /* page base, GitHub Dark Default native */
  --bg-surface:    #161b22;   /* panels, cards */
  --bg-elevated:   #21262d;   /* hover layer, active state, code blocks */
  --bg-overlay:    #0d1117e6; /* modal backdrop, with transparency */

  /* Borders */
  --border-subtle: #21262d;   /* lightest, structural separation */
  --border:        #30363d;   /* default border, present but not distracting */
  --border-strong: #484f58;   /* emphasis, focus state */

  /* Text layers */
  --text-primary:   #e6edf3;  /* main content */
  --text-secondary: #8b949e;  /* secondary descriptions */
  --text-dim:       #484f58;  /* hints, labels, disabled */
  --text-inverse:   #0d1117;  /* inverted, for use on highlighted backgrounds */

  /* Semantic colors — GitHub Dark Default native palette */
  --blue:   #58a6ff;  /* primary actions, links, active */
  --green:  #3fb950;  /* success, running, online */
  --yellow: #d29922;  /* warning, pending, slow */
  --red:    #f85149;  /* error, failed, critical */
  --purple: #bc8cff;  /* agent thinking, AI-related */
  --cyan:   #79c0ff;  /* tool calls, data streams, params */
  --orange: #ffa657;  /* important notice, below red in severity */

  /* Status left-border colors */
  --status-running: var(--purple);
  --status-success: var(--green);
  --status-error:   var(--red);
  --status-pending: var(--yellow);
  --status-idle:    var(--border);
}
```

**Forbidden:**
- ❌ Any white background
- ❌ Gradient backgrounds (`linear-gradient` for decoration only)
- ❌ Colors outside this palette — no new colors without updating the spec
- ❌ Tailwind default colors (violet, purple, indigo families)

---

## §3 Typography

**Primary font: Noto Sans** for UI text. **Code font: JetBrains Mono** for code blocks, inline code, and monospace content. Both loaded locally, no CDN.

```css
body { font-family: 'Noto Sans', 'JetBrains Mono', sans-serif; }
code, pre { font-family: 'JetBrains Mono', monospace; }
```

### Font Weight Scale

| Weight | Usage | Examples |
|--------|-------|---------|
| 700 | Page titles | H1, task names |
| 600 | Section headers | Panel titles, group labels |
| 400 | Body text | Message body, descriptions, inputs |
| 300 | Secondary info | Timestamps, hints, dim text |

### Font Size Scale

```css
--text-xs:   11px;  /* labels, chips, badges */
--text-sm:   12px;  /* secondary info, timestamps */
--text-base: 13px;  /* body text (smaller than typical web — terminal feel) */
--text-md:   14px;  /* important content, inputs */
--text-lg:   16px;  /* panel titles */
--text-xl:   20px;  /* page-level titles */
--text-2xl:  24px;  /* rarely used — empty state guidance only */

/* Letter spacing */
--tracking-tight:  -0.02em;  /* large headings */
--tracking-normal:  0;        /* body text */
--tracking-wide:    0.06em;  /* ALL CAPS labels, chips */
--tracking-wider:   0.10em;  /* status codes, monospace emphasis */
```

**Rules:**
- Numbers are always monospace-aligned, right-aligned (time, duration, counts)
- Status chips / labels: ALL CAPS + `letter-spacing: var(--tracking-wide)`
- Use JetBrains Mono for code/monospace content only, Noto Sans for everything else

---

## §4 Layout

### Overall Structure

```
┌────────────────────────────────────────────────────┐
│  Top status bar (fixed, 40px, p10k segment style)  │
├──────────┬─────────────────────────────────────────┤
│          │                                         │
│  Sidebar │  Main content (independent scroll)      │
│  (fixed) │                                         │
│  240px   │  ┌──────────────────────────────────┐  │
│          │  │  Task list (left) | Detail (right)│  │
│          │  └──────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────┘
```

### No Horizontal Overflow (Most Important Layout Rule)

```css
/* Global root */
html, body {
  overflow-x: hidden;
  max-width: 100vw;
}

/* All containers */
* {
  box-sizing: border-box;
  min-width: 0; /* critical: allows flex children to shrink */
}

/* Text containers */
.text-container {
  overflow: hidden;
  word-break: break-word;
  overflow-wrap: break-word;
}
```

### Sidebar

**Sizing behavior:**
- Default width: 240px
- Drag range: 180px – 480px
- Collapsed width: 48px (icons only, no labels)
- Width persisted: `localStorage['sidebar-width']`

**Resize handle:**
```css
.sidebar-resizer {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--duration-fast) ease;
}
.sidebar-resizer:hover,
.sidebar-resizer.dragging {
  background: var(--blue);
}
```
- Handle is transparent by default; highlights `var(--blue)` on hover/drag
- Set global `cursor: col-resize` during drag to prevent cursor flicker
- Content area width updates in real time via `--sidebar-width` CSS variable

**Collapse / expand:**
- Trigger: button at sidebar bottom, or double-click the handle
- Animation: `width` 200ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Collapsed: labels fade out (`opacity: 0`), icons remain centered
- Expanded: restores last remembered width, labels fade in

```css
.sidebar {
  width: var(--sidebar-width, 240px);
  min-width: 48px;
  transition: width 200ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  position: fixed;
  top: 40px; left: 0; bottom: 0;
}
.sidebar.collapsed { --sidebar-width: 48px; }

.sidebar-label {
  opacity: 1;
  transition: opacity 150ms ease;
  white-space: nowrap;
  overflow: hidden;
}
.sidebar.collapsed .sidebar-label { opacity: 0; width: 0; }
```

**Active item:** 2px left border `var(--blue)` + `var(--bg-elevated)` background  
**Collapsed active item:** border only + tooltip on hover showing full label

**Content area sync:**
```css
.main-content {
  margin-left: var(--sidebar-width, 240px);
  transition: margin-left 200ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow-y: auto;
}
```

### Master-Detail Layout (Task List + Detail)

- Left task list: fixed ~320px width, independent scroll
- Right detail area: remaining width, grows vertically with content
- Divider: `1px var(--border)`, no shadow

### Spacing Scale

```css
/* 4px grid */
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
```

---

## §5 Content Behavior

### Long Text Handling

**Agent primary responses:**
- May grow the page vertically (no height limit)
- **Never** expand horizontally — no horizontal page scroll
- Force wrap: `word-break: break-word; overflow-wrap: break-word`

**Single-line fixed-width containers (marquee):**
```css
.marquee-text {
  overflow: hidden;
  white-space: nowrap;
  /* JS adds .overflow class when text width exceeds container width */
}
.marquee-text.overflow {
  animation: marquee 8s linear infinite;
}
@keyframes marquee {
  0%   { transform: translateX(0); }
  30%  { transform: translateX(0); }             /* pause at start */
  70%  { transform: translateX(var(--shift)); }  /* scroll to end */
  100% { transform: translateX(var(--shift)); }  /* pause at end */
}
/* --shift computed by JS: -(textWidth - containerWidth)px */
```

### Collapsible Secondary Content

Default collapsed, click to expand:
- `tool_call` input / output
- `todo` lists
- Thinking blocks
- Long JSON / logs

Collapsed state: single line — left status border + content summary + right duration/line count  
Expanded state: `var(--bg-elevated)` background, monospace, padded

### Dim Text for Secondary Information

```css
.text-dim       { color: var(--text-dim); font-weight: 300; }
.text-secondary { color: var(--text-secondary); }
/* Use for: timestamps, param hints, annotation text */
```

### Chip / Tag Spec

```css
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  border: 1px solid currentColor;
  opacity: 0.85;
}
/* Color = corresponding semantic color (--blue, --green, etc.) */
/* Background: transparent or very low opacity tint of the semantic color */
```

---

## §6 Component Specs

### Universal Component Rules

- Border radius: max `4px`, chips use `3px`
- Borders: `1px solid var(--border)`
- Shadows: **forbidden.** Use background color difference for depth.
- Icons: **Lucide** icon library
  - `stroke-width` locked to `1.5` on every icon
  - Sizes: navigation=16px, action buttons=14px, status=12px
  - Color: always `currentColor`, never hardcoded

### Status Left Border (Core Visual Language)

```css
/* All status display uses a 2px left border — never dots */
.status-bar {
  border-left: 2px solid var(--status-idle);
  padding-left: var(--space-3);
}
.status-bar.running { border-left-color: var(--status-running); }
.status-bar.success { border-left-color: var(--status-success); }
.status-bar.error   { border-left-color: var(--status-error); }
.status-bar.pending { border-left-color: var(--status-pending); }
```

### Tool Call Card

```
Collapsed (single line):
▶ [cyan]tool_name[/cyan]  ·  param summary  ·  ············  142ms

Expanded:
┌─ INPUT ──────────────────────────────────────────┐
│  { "server": "gpu-01", "action": "status" }      │  <- bg-elevated
└─ OUTPUT ─────────────────────────────────────────┘
│  { "status": "running", "gpu_util": "87%" }      │
└──────────────────────────────────────────────────┘
```

- pending: purple left border + blinking cursor animation
- success: green left border
- error: red left border + error message displayed

### Copy Interaction

```
Trigger:  mouse hover over code block / JSON / command / log content
Display:  Copy icon appears top-right (Lucide Copy, 14px, strokeWidth 1.5)
On click:
  1. Copy to clipboard
  2. Icon changes to Check (var(--green))
  3. Reverts to Copy icon after 800ms
  No toast. The icon IS the feedback.
```

```css
.copyable { position: relative; }
.copy-btn {
  position: absolute;
  top: 8px; right: 8px;
  opacity: 0;
  transition: opacity 150ms ease;
  color: var(--text-dim);
}
.copyable:hover .copy-btn { opacity: 1; }
.copy-btn.copied { color: var(--green); }
```

### Live Content (Streaming Output)

- Content area auto-scrolls to newest content
- If user scrolls up: stop auto-scroll, show "↓ Jump to latest" floating button
- User clicks button or scrolls to bottom: resume auto-scroll

```
[↓ Jump to latest]  ← fixed bottom-right, green left border, disappears on click
```

### Modals & Drawers

**Confirm dialog (dangerous actions):**
- Overlay: `var(--bg-overlay)` with backdrop blur
- Dialog: `var(--bg-surface)`, border `var(--border-strong)`
- Danger button: `var(--red)` color, requires user to type confirmation text before activating
- Animation: 200ms `cubic-bezier(0.16, 1, 0.3, 1)` scale-in from center

**Detail drawer (log detail):**
- Slides in from right, width 480px
- Background `var(--bg-surface)`, left border `1px var(--border)`
- Animation: 200ms `cubic-bezier(0.16, 1, 0.3, 1)`

**CRUD forms:**
- Centered modal, max width 480px
- Input: `var(--bg-elevated)` background, border changes to `var(--border-strong)` on focus

---

## §6.5 Canvas Panel (Task Progress)

### Positioning & Trigger

**Analogy:** Claude's artifact panel — but the content is a live task progress tree.

**Trigger logic:**
- Agent starts executing tasks (todo/task data generated) → slides in from right automatically
- All tasks complete or error → panel stays open (user can close manually)
- No tasks → panel hidden, message flow takes full width

```
With tasks running:
┌────────────────────────────────────────────────────────┐
│  Sidebar  │    Message flow (left)    ║  Canvas (right) │
│   240px   │       flex: 1 min        ║  380px default   │
└────────────────────────────────────────────────────────┘

No tasks:
┌───────────────────────────────────────────┐
│  Sidebar  │      Message flow (full)      │
│   240px   │          flex: 1             │
└───────────────────────────────────────────┘
```

### Sizing & Resize

```
Default width:    380px
Drag range:       280px – 60vw
Minimized width:  40px (handle + icon only)
Persisted:        localStorage['canvas-width']
```

**Resize handle (same interaction language as sidebar):**
```css
.canvas-resizer {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--duration-fast) ease;
  z-index: 10;
}
.canvas-resizer:hover,
.canvas-resizer.dragging {
  background: var(--blue);
}
```

**Slide in / collapse animation:**
```css
.canvas-panel {
  width: var(--canvas-width, 380px);
  min-width: 40px;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  position: relative;
  transition: width 220ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  flex-shrink: 0;
}
.canvas-panel.hidden {
  width: 0;
  border-left: none;
}
```

### Panel Internal Layout

```
┌─────────────────────────────────┐
│ ≡  TASK TRACKER      [_] [×]   │  ← header bar, 40px
├─────────────────────────────────┤
│ ████████░░  6 / 10             │  ← progress bar, 2px
├─────────────────────────────────┤
│                                 │
│  Task tree (scrollable)         │
│                                 │
│  ▼ main task name     running  │
│    ├─ ✓ subtask A      1.2s    │
│    ├─ ▶ subtask B  ◀ current  │  ← highlighted row
│    │    └─ tool_call: bash     │
│    └─ ○ subtask C     pending  │
│                                 │
└─────────────────────────────────┘
```

**Header bar:**
```css
.canvas-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}
/* Right buttons: minimize, close (Lucide, 14px, strokeWidth 1.5) */
```

**Overall progress bar:**
```css
.canvas-progress-bar {
  height: 2px;   /* extremely thin — doesn't compete for attention */
  background: var(--bg-elevated);
  flex-shrink: 0;
}
.canvas-progress-fill {
  height: 100%;
  background: var(--green);
  transition: width 400ms ease;
}
/* On error: turns --red. On complete: brief --green flash then holds */
```

### Task Tree Node Spec

Each task node row:

```
[indent] [status icon] [task name (marquee)] [········] [duration/status chip]
```

**Status icons (Lucide, 12px, strokeWidth 1.5):**

| Status | Icon | Color |
|--------|------|-------|
| pending | `Circle` | `--text-dim` |
| running | `Loader` (spinning) | `--purple` |
| success | `CheckCircle` | `--green` |
| error | `XCircle` | `--red` |
| skipped | `MinusCircle` | `--text-dim` |

```css
/* Active (current) node highlight */
.task-node.active {
  background: var(--bg-elevated);
  border-left: 2px solid var(--purple);
  padding-left: calc(var(--indent) - 2px); /* compensate for border width */
}

/* Depth indent: 16px per level */
.task-node { padding-left: calc(var(--depth, 0) * 16px + 12px); }

/* Spinning Loader for running state */
@keyframes spin { to { transform: rotate(360deg); } }
.icon-running { animation: spin 1s linear infinite; }
```

**Task name overflow:** marquee (reuse `.marquee-text` spec)  
**Duration/status:** right-aligned, monospace numbers, `--text-dim` color; shows actual duration after completion (e.g. `1.2s`)

### Expand Single Task Detail

Click task row → inline expand (no modal), shows associated tool_call list:

```
▼ ▶ subtask B (expanded)             running  ◀ current
   │
   ├─ ✓ bash · get_server_status   · 142ms
   ├─ ▶ bash · restart_service     · running...
   └─ ○ bash · verify_status       · pending
```

Expanded area: `var(--bg-elevated)` background, `border-left: 1px solid var(--border-subtle)`, reuses Tool Call card spec.

### Minimized State (40px strip)

```
┌──┐
│≡ │  ← icon
│  │
│6/│  ← progress vertical
│10│
│  │
└──┘
```

- Shows `done/total` vertically
- Left border pulses `--purple` when tasks are running
- Hover shows tooltip with full task name

```css
.canvas-panel.minimized .canvas-body { display: none; }
.canvas-panel.minimized { width: 40px; writing-mode: vertical-rl; }

@keyframes pulse-border {
  0%, 100% { border-left-color: var(--purple); }
  50%       { border-left-color: transparent; }
}
.canvas-panel.minimized.running {
  animation: pulse-border 1.5s ease infinite;
}
```

### Message Flow ↔ Canvas Sync

- When a todo/task collapsed block appears in message flow, click "View in canvas" → canvas slides in and highlights the task
- Clicking a task node in canvas → message flow auto-scrolls to the corresponding tool_call message
- Both sides linked via shared `taskId` in Zustand store — no direct component coupling

---

## §7 Markdown Rendering

### Library Choice

**Recommended: `react-markdown` + `remark-gfm` + `rehype-highlight`**

```jsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
  components={markdownComponents}
>
  {content}
</ReactMarkdown>
```

- `remark-gfm`: tables, task lists, strikethrough (GitHub-flavored)
- `rehype-highlight`: code highlighting with `github-dark` theme — natively matches color palette
- `components`: full control over every element, no dependency on browser UA defaults

### Code Highlight Theme Alignment

```css
/* Ensure hljs background matches --bg-elevated — no white blocks */
.hljs {
  background: var(--bg-elevated) !important;
  color: var(--text-primary) !important;
  padding: 0 !important; /* padding controlled by parent pre */
}
```

### Custom Component Map

Every Markdown element must override defaults — no white backgrounds, no UA styles:

```jsx
const markdownComponents = {
  h1: ({children}) => (
    <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700,
      color: 'var(--text-primary)', margin: '24px 0 12px',
      letterSpacing: 'var(--tracking-tight)',
      borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
      {children}
    </h1>
  ),
  h2: ({children}) => (
    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600,
      color: 'var(--text-primary)', margin: '20px 0 8px' }}>{children}</h2>
  ),
  h3: ({children}) => (
    <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600,
      color: 'var(--text-secondary)', margin: '16px 0 6px' }}>{children}</h3>
  ),
  p: ({children}) => (
    <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)',
      lineHeight: 1.7, margin: '0 0 12px', wordBreak: 'break-word' }}>{children}</p>
  ),
  code: ({inline, className, children}) => {
    if (inline) return (
      <code style={{ background: 'var(--bg-elevated)', color: 'var(--cyan)',
        padding: '1px 5px', borderRadius: '3px', fontSize: '0.9em',
        border: '1px solid var(--border)' }}>{children}</code>
    )
    return (
      <div style={{ position: 'relative' }} className="copyable-block">
        <pre style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: '4px', padding: '12px 16px', overflowX: 'auto',
          fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 12px' }}>
          <code className={className}>{children}</code>
        </pre>
        <CopyButton content={String(children)} />
      </div>
    )
  },
  blockquote: ({children}) => (
    <blockquote style={{ borderLeft: '2px solid var(--border-strong)',
      paddingLeft: '12px', margin: '0 0 12px',
      color: 'var(--text-secondary)' }}>{children}</blockquote>
  ),
  ul: ({children}) => (
    <ul style={{ paddingLeft: '20px', margin: '0 0 12px',
      color: 'var(--text-primary)' }}>{children}</ul>
  ),
  ol: ({children}) => (
    <ol style={{ paddingLeft: '20px', margin: '0 0 12px',
      color: 'var(--text-primary)' }}>{children}</ol>
  ),
  li: ({children}) => (
    <li style={{ fontSize: 'var(--text-base)', lineHeight: 1.7,
      marginBottom: '4px' }}>{children}</li>
  ),
  // Table: outer div handles horizontal scroll — doesn't pollute parent
  table: ({children}) => (
    <div style={{ overflowX: 'auto', margin: '0 0 12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse',
        fontSize: 'var(--text-sm)' }}>{children}</table>
    </div>
  ),
  th: ({children}) => (
    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600,
      color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
      letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
      fontSize: 'var(--text-xs)' }}>{children}</th>
  ),
  td: ({children}) => (
    <td style={{ padding: '6px 12px', color: 'var(--text-primary)',
      borderBottom: '1px solid var(--border-subtle)' }}>{children}</td>
  ),
  hr: () => <hr style={{ border: 'none',
    borderTop: '1px solid var(--border)', margin: '20px 0' }} />,
  a: ({href, children}) => (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ color: 'var(--blue)', textDecoration: 'none' }}
      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
      {children}
    </a>
  ),
  strong: ({children}) => (
    <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
  ),
  em: ({children}) => (
    <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{children}</em>
  ),
  img: ({src, alt}) => (
    <img src={src} alt={alt} style={{ maxWidth: '100%', height: 'auto',
      borderRadius: '4px', border: '1px solid var(--border)',
      display: 'block', margin: '8px 0' }} />
  ),
}
```

### Code Block Copy Button

```jsx
function CopyButton({ content }) {
  const [copied, setCopied] = useState(false)
  return (
    <button className="copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      style={{ position: 'absolute', top: 8, right: 8,
        background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease' }}
    >
      {copied
        ? <Check size={14} strokeWidth={1.5} />
        : <Copy size={14} strokeWidth={1.5} />}
    </button>
  )
}
```

```css
.copyable-block .copy-btn { opacity: 0; transition: opacity 150ms ease; }
.copyable-block:hover .copy-btn { opacity: 1; }
```

### Markdown Container Global Rules

```css
.markdown-body {
  overflow-x: hidden;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}
.markdown-body pre { overflow-x: auto; max-width: 100%; }
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child  { margin-bottom: 0; }
```

---

## §8 Animation

```css
/* Timing variables */
--duration-fast:   100ms;
--duration-normal: 150ms;
--duration-slow:   200ms;
--ease-default:    ease;
--ease-spring:     cubic-bezier(0.16, 1, 0.3, 1);  /* modals, panels */

/* Principles */
/* ✅ Use for: hover color/border changes, opacity transitions */
/* ✅ Use for: modal open, panel slide-in, collapse/expand */
/* ❌ Not for: continuous loops (except loading states) */
/* ❌ Not for: scroll behavior, cursor tracking */
```

### Loading States

**① Content placeholder → Skeleton Screen**

Used when page/panel initially loads or data is fetching. Shape must match the real content layout.

```css
@keyframes skeleton-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}

.skeleton {
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--bg-surface)  50%,   /* light band: one layer brighter */
    var(--bg-elevated) 75%
  );
  background-size: 800px 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
}
```

**Skeleton component examples:**
```jsx
function MessageSkeleton() {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="skeleton" style={{ width: 12, height: 12, borderRadius: '50%' }} />
        <div className="skeleton" style={{ width: 80, height: 11 }} />
        <div className="skeleton" style={{ width: 40, height: 11 }} />
      </div>
      {/* Three lines with decreasing width — natural feel */}
      <div className="skeleton" style={{ width: '92%', height: 13 }} />
      <div className="skeleton" style={{ width: '78%', height: 13 }} />
      <div className="skeleton" style={{ width: '55%', height: 13 }} />
    </div>
  )
}

function TaskNodeSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px' }}>
      {[1, 0.7, 0.85, 0.6].map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: i > 0 ? 20 : 0 }}>
          <div className="skeleton" style={{ width: 12, height: 12, flexShrink: 0 }} />
          <div className="skeleton" style={{ width: `${w * 100}%`, height: 12 }} />
        </div>
      ))}
    </div>
  )
}
```

**Skeleton shape by context:**

| Context | Skeleton structure |
|---------|-------------------|
| Message list | 3–4 text lines, width decreasing |
| Task canvas | Tree indent structure, one row per node |
| Sidebar nav | Several equal-height row blocks |
| Detail drawer | Wide block (title) + multiple narrow blocks |

**State flow:** `skeleton` → `loaded`. No intermediate state.

### Tab Switching

```css
.tab-indicator {
  position: absolute;
  bottom: 0;
  height: 1px;
  background: var(--blue);
  transition: left var(--duration-normal) var(--ease-spring),
              width var(--duration-normal) var(--ease-spring);
}
/* Content: opacity fade-in only, no position transition */
.tab-content { animation: tab-fade 150ms ease; }
@keyframes tab-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

---

## §9 Dangerous Operations

These must show a confirmation dialog before executing:

| Action | Confirmation type |
|--------|------------------|
| Stop a running task | Dialog + red confirm button |
| Delete history / logs | Dialog + type resource name to confirm |
| Re-trigger a task | Dialog + show current task state |

---

## §10 Claude Code Task Template

Prepend this context to every new component request:

```
Follow the design spec strictly:
- Font: Noto Sans for UI, JetBrains Mono for code only
- Colors: CSS variables only, no Tailwind color palette, no hardcoded hex
- No box-shadow — use background color difference for depth
- Border radius max 4px
- Status via 2px left border, not dots or icons
- Icons: Lucide, strokeWidth={1.5}, color=currentColor
- All text containers: min-width:0, word-break:break-word
- Loading: skeleton shimmer only, no spinner
- Copy button: appears on hover (Copy icon), switches to Check (green) on click, reverts after 800ms

[then describe the specific component]
```

---

## §11 Pre-submission Checklist

- [ ] Shrink browser window — no horizontal scrollbar appears
- [ ] All colors from CSS variables — no hardcoded hex
- [ ] No `box-shadow` used anywhere
- [ ] Font is Noto Sans for UI, JetBrains Mono for code blocks only
- [ ] Long text tested: wrap and marquee both work
- [ ] Hover states have 150ms transition
- [ ] Copy icon appears on hover, shows Check on click, reverts after 800ms
- [ ] Dangerous actions have confirmation dialog
- [ ] Loading uses skeleton shimmer — shape matches real content
- [ ] Skeleton disappears and content renders directly — no intermediate state
- [ ] All Lucide icons have `strokeWidth={1.5}`
- [ ] Status displayed via 2px left border, not dots