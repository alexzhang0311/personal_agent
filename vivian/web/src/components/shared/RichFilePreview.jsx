import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import SelectedXlsxPopup from './SelectedXlsxPopup'
import markdownComponents from '../markdown/markdownComponents'
import MermaidDiagram from '../markdown/MermaidDiagram'

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.rs',
  '.rb', '.php', '.c', '.cpp', '.h', '.hpp', '.swift', '.kt',
  '.scala', '.r', '.lua', '.sh', '.sql', '.css',
])

const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.conf', '.ini', '.env', '.dockerfile'])
const STRUCTURED_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.xml'])
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls'])
const WORD_EXTENSIONS = new Set(['.docx', '.doc'])
const PRESENTATION_EXTENSIONS = new Set(['.pptx'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
])
const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const PRESENTATION_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
])
const STRUCTURED_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'text/xml',
  'text/yaml',
])
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
]
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const SPREADSHEET_ROW_HEADER_WIDTH = 52
const SPREADSHEET_MIN_COLUMN_WIDTH = 96
const SPREADSHEET_MAX_COLUMN_WIDTH = 360
const SPREADSHEET_DEFAULT_ROW_HEIGHT = 40
const SPREADSHEET_MIN_ROW_HEIGHT = 28
const SPREADSHEET_MAX_ROW_HEIGHT = 160
const SPREADSHEET_HEADER_HEIGHT = 34
const SPREADSHEET_AUTOSCROLL_EDGE_SIZE = 48
const SPREADSHEET_AUTOSCROLL_MAX_STEP = 24
const SPREADSHEET_SELECTED_CELL_BACKGROUND = 'color-mix(in srgb, var(--blue) 10%, var(--bg-base))'
const SPREADSHEET_SELECTED_HEADER_BACKGROUND = 'color-mix(in srgb, var(--blue) 10%, var(--bg-elevated))'

function getLanguage(ext) {
  const map = {
    '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.jsx': 'javascript', '.tsx': 'typescript',
    '.java': 'java', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.swift': 'swift',
    '.kt': 'kotlin', '.scala': 'scala', '.r': 'r', '.lua': 'lua', '.sh': 'bash',
    '.sql': 'sql', '.css': 'css',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
  }
  return map[ext] || 'plaintext'
}

function TextPreview({ content }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '16px',
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        fontSize: 12,
        color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.6,
      }}
    >
      {content}
    </pre>
  )
}

function CodePreview({ content, language }) {
  return (
    <div className="overflow-x-auto" style={{ padding: '16px' }}>
      <pre style={{ margin: 0 }}>
        <code
          className={`hljs language-${language}`}
          style={{
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            fontSize: 12,
            lineHeight: 1.6,
            background: 'var(--bg-elevated)',
          }}
        >
          {content}
        </code>
      </pre>
    </div>
  )
}

function MarkdownPreview({ content }) {
  return (
    <div className="markdown-body overflow-hidden px-4 py-3" style={{ wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function MermaidFilePreview({ content }) {
  return (
    <div
      className="overflow-hidden"
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        padding: '12px 16px',
        boxSizing: 'border-box',
      }}
    >
      <MermaidDiagram code={content || ''} fill />
    </div>
  )
}

function TablePreview({ rows, maxRows = 100 }) {
  if (!rows || rows.length === 0) return null
  const headers = rows[0]
  const body = Number.isFinite(maxRows)
    ? rows.slice(1, maxRows + 1)
    : rows.slice(1)

  return (
    <div className="overflow-x-auto" style={{ padding: '8px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                key={index}
                className="px-3 py-2 text-xs text-left truncate"
                style={{
                  color: 'var(--text-primary)',
                  borderBottom: '2px solid var(--border)',
                  fontWeight: 600,
                  maxWidth: 200,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="px-3 py-1 text-xs truncate"
                  style={{
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border)',
                    maxWidth: 200,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {Number.isFinite(maxRows) && rows.length > maxRows + 1 && (
        <div className="text-xs py-2" style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
          Showing {maxRows} of {rows.length - 1} rows
        </div>
      )}
    </div>
  )
}

function getMaxColumnCount(rows) {
  return rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
}

function getColumnLabel(index) {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getSheetLayoutKey(sheet, index) {
  return `${index}:${sheet?.name || 'sheet'}`
}

function toCellDisplayValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function getTextUnits(value) {
  return Array.from(String(value)).reduce((units, char) => {
    if (char === '\t') return units + 2
    return units + (/[^\x00-\xff]/.test(char) ? 1.7 : 1)
  }, 0)
}

function estimateColumnWidths(rows, viewportWidth, columnCount) {
  const sampleRows = rows.slice(0, Math.min(rows.length, 40))
  const estimated = Array.from({ length: columnCount }, (_, columnIndex) => {
    let maxUnits = getTextUnits(getColumnLabel(columnIndex))
    sampleRows.forEach((row) => {
      const cell = toCellDisplayValue(row?.[columnIndex] ?? '')
      cell.split('\n').forEach((line) => {
        maxUnits = Math.max(maxUnits, getTextUnits(line.trim()))
      })
    })
    return clamp(Math.round(maxUnits * 9.5 + 28), SPREADSHEET_MIN_COLUMN_WIDTH, SPREADSHEET_MAX_COLUMN_WIDTH)
  })

  const availableWidth = Math.max((viewportWidth || 0) - SPREADSHEET_ROW_HEADER_WIDTH, 0)
  const estimatedTotal = estimated.reduce((sum, width) => sum + width, 0)

  if (availableWidth > estimatedTotal && columnCount > 0) {
    const extraPerColumn = Math.floor((availableWidth - estimatedTotal) / columnCount)
    return estimated.map((width) => Math.max(SPREADSHEET_MIN_COLUMN_WIDTH, width + extraPerColumn))
  }

  return estimated
}

function normalizeSelectionBounds(bounds) {
  if (!bounds) return null
  return {
    startRowIndex: Math.min(bounds.startRowIndex, bounds.endRowIndex),
    endRowIndex: Math.max(bounds.startRowIndex, bounds.endRowIndex),
    startColIndex: Math.min(bounds.startColIndex, bounds.endColIndex),
    endColIndex: Math.max(bounds.startColIndex, bounds.endColIndex),
    anchorRowIndex: bounds.anchorRowIndex ?? bounds.startRowIndex,
    anchorColIndex: bounds.anchorColIndex ?? bounds.startColIndex,
  }
}

function toRangeA1(bounds) {
  const start = `${getColumnLabel(bounds.startColIndex)}${bounds.startRowIndex + 1}`
  const end = `${getColumnLabel(bounds.endColIndex)}${bounds.endRowIndex + 1}`
  return start === end ? start : `${start}:${end}`
}

function buildSelectionTsv(rows, bounds) {
  const lines = []
  for (let rowIndex = bounds.startRowIndex; rowIndex <= bounds.endRowIndex; rowIndex += 1) {
    const values = []
    for (let colIndex = bounds.startColIndex; colIndex <= bounds.endColIndex; colIndex += 1) {
      values.push(toCellDisplayValue(rows?.[rowIndex]?.[colIndex] ?? ''))
    }
    lines.push(values.join('\t'))
  }
  return lines.join('\n')
}

function buildSpreadsheetSelection(bounds, sheet, sheetIndex) {
  const normalized = normalizeSelectionBounds(bounds)
  if (!normalized) return null
  return {
    sheetIndex,
    sheetName: sheet?.name || '',
    startRowIndex: normalized.startRowIndex,
    endRowIndex: normalized.endRowIndex,
    startColIndex: normalized.startColIndex,
    endColIndex: normalized.endColIndex,
    anchorRowIndex: normalized.anchorRowIndex,
    anchorColIndex: normalized.anchorColIndex,
    rangeA1: toRangeA1(normalized),
    contentTsv: buildSelectionTsv(sheet?.rows || [], normalized),
  }
}

function buildSizeOffsets(sizes) {
  const offsets = []
  let total = 0
  sizes.forEach((size) => {
    offsets.push(total)
    total += size
  })
  return { offsets, total }
}

function getIndexFromOffset(offset, sizes, offsetInfo) {
  if (!sizes.length) return 0
  const safeOffset = clamp(offset, 0, Math.max(offsetInfo.total - 1, 0))
  let low = 0
  let high = sizes.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const start = offsetInfo.offsets[mid]
    const end = start + sizes[mid]
    if (safeOffset < start) {
      high = mid - 1
    } else if (safeOffset >= end) {
      low = mid + 1
    } else {
      return mid
    }
  }

  return clamp(low, 0, sizes.length - 1)
}

function getSelectionPointFromMouse(event, viewport, columnWidths, rowHeights, columnOffsetInfo, rowOffsetInfo) {
  const rect = viewport.getBoundingClientRect()
  const contentX = viewport.scrollLeft + event.clientX - rect.left - SPREADSHEET_ROW_HEADER_WIDTH
  const contentY = viewport.scrollTop + event.clientY - rect.top - SPREADSHEET_HEADER_HEIGHT

  return {
    rowIndex: getIndexFromOffset(contentY, rowHeights, rowOffsetInfo),
    columnIndex: getIndexFromOffset(contentX, columnWidths, columnOffsetInfo),
  }
}

function getAutoScrollDelta(event, viewport) {
  const rect = viewport.getBoundingClientRect()
  const getAxisDelta = (value, start, end) => {
    if (value < start + SPREADSHEET_AUTOSCROLL_EDGE_SIZE) {
      const ratio = clamp((start + SPREADSHEET_AUTOSCROLL_EDGE_SIZE - value) / SPREADSHEET_AUTOSCROLL_EDGE_SIZE, 0, 1)
      return -Math.ceil(ratio * SPREADSHEET_AUTOSCROLL_MAX_STEP)
    }
    if (value > end - SPREADSHEET_AUTOSCROLL_EDGE_SIZE) {
      const ratio = clamp((value - (end - SPREADSHEET_AUTOSCROLL_EDGE_SIZE)) / SPREADSHEET_AUTOSCROLL_EDGE_SIZE, 0, 1)
      return Math.ceil(ratio * SPREADSHEET_AUTOSCROLL_MAX_STEP)
    }
    return 0
  }

  return {
    x: getAxisDelta(event.clientX, rect.left, rect.right),
    y: getAxisDelta(event.clientY, rect.top, rect.bottom),
  }
}

function clampSelectionTipPoint(point) {
  if (typeof window === 'undefined') return point
  return {
    x: clamp(point.x, 8, Math.max(window.innerWidth - 160, 8)),
    y: clamp(point.y, 8, Math.max(window.innerHeight - 48, 8)),
  }
}

function getCellSelectionState(rowIndex, columnIndex, selection) {
  if (!selection) {
    return {
      selected: false,
      top: false,
      bottom: false,
      left: false,
      right: false,
      anchor: false,
    }
  }

  const selected = (
    rowIndex >= selection.startRowIndex &&
    rowIndex <= selection.endRowIndex &&
    columnIndex >= selection.startColIndex &&
    columnIndex <= selection.endColIndex
  )

  if (!selected) {
    return {
      selected: false,
      top: false,
      bottom: false,
      left: false,
      right: false,
      anchor: false,
    }
  }

  return {
    selected: true,
    top: rowIndex === selection.startRowIndex,
    bottom: rowIndex === selection.endRowIndex,
    left: columnIndex === selection.startColIndex,
    right: columnIndex === selection.endColIndex,
    anchor: rowIndex === selection.anchorRowIndex && columnIndex === selection.anchorColIndex,
  }
}

function SpreadsheetGrid({
  rows,
  t,
  columnWidths,
  rowHeights,
  viewportWidth,
  onViewportWidthChange,
  onColumnWidthChange,
  onRowHeightChange,
  selectedRange,
  onSelectionStart,
  onSelectionComplete,
}) {
  const viewportRef = useRef(null)
  const [dragState, setDragState] = useState(null)
  const [selectionDraft, setSelectionDraft] = useState(null)
  const selectionDraftRef = useRef(null)
  const lastSelectionMouseEventRef = useRef(null)
  const autoScrollFrameRef = useRef(null)
  const safeRows = rows || []
  const columnCount = getMaxColumnCount(safeRows)
  const resolvedColumnWidths = useMemo(() => {
    const estimated = estimateColumnWidths(safeRows, viewportWidth, columnCount)
    return estimated.map((width, index) => {
      const userWidth = columnWidths?.[index]
      if (userWidth != null) {
        return clamp(userWidth, SPREADSHEET_MIN_COLUMN_WIDTH, SPREADSHEET_MAX_COLUMN_WIDTH)
      }
      return Math.max(SPREADSHEET_MIN_COLUMN_WIDTH, width)
    })
  }, [columnCount, columnWidths, safeRows, viewportWidth])
  const resolvedRowHeights = useMemo(
    () => safeRows.map((_, index) => clamp(rowHeights?.[index] ?? SPREADSHEET_DEFAULT_ROW_HEIGHT, SPREADSHEET_MIN_ROW_HEIGHT, SPREADSHEET_MAX_ROW_HEIGHT)),
    [rowHeights, safeRows]
  )
  const tableWidth = useMemo(
    () => SPREADSHEET_ROW_HEADER_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0),
    [resolvedColumnWidths]
  )
  const columnOffsetInfo = useMemo(() => buildSizeOffsets(resolvedColumnWidths), [resolvedColumnWidths])
  const rowOffsetInfo = useMemo(() => buildSizeOffsets(resolvedRowHeights), [resolvedRowHeights])
  const committedSelection = useMemo(() => normalizeSelectionBounds(selectedRange), [selectedRange])
  const normalizedDraft = useMemo(() => normalizeSelectionBounds(selectionDraft), [selectionDraft])
  const activeSelection = normalizedDraft || committedSelection

  const updateSelectionFromMouseEvent = useCallback((event) => {
    const viewport = viewportRef.current
    const current = selectionDraftRef.current
    if (!viewport || !current) return

    const point = getSelectionPointFromMouse(
      event,
      viewport,
      resolvedColumnWidths,
      resolvedRowHeights,
      columnOffsetInfo,
      rowOffsetInfo
    )

    const nextDraft = {
      ...current,
      endRowIndex: point.rowIndex,
      endColIndex: point.columnIndex,
    }
    selectionDraftRef.current = nextDraft
    setSelectionDraft(nextDraft)
  }, [columnOffsetInfo, resolvedColumnWidths, resolvedRowHeights, rowOffsetInfo])

  useEffect(() => {
    selectionDraftRef.current = selectionDraft
  }, [selectionDraft])

  useEffect(() => {
    if (typeof onViewportWidthChange !== 'function') return undefined
    const element = viewportRef.current
    if (!element) return undefined

    const updateWidth = () => onViewportWidthChange(Math.round(element.clientWidth))
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(element)
    return () => observer.disconnect()
  }, [onViewportWidthChange])

  useEffect(() => {
    if (!dragState) return undefined

    const onMouseMove = (event) => {
      if (dragState.type === 'column') {
        const nextWidth = clamp(
          dragState.startSize + (event.clientX - dragState.startClient),
          SPREADSHEET_MIN_COLUMN_WIDTH,
          SPREADSHEET_MAX_COLUMN_WIDTH
        )
        onColumnWidthChange?.(dragState.index, nextWidth)
        return
      }

      const nextHeight = clamp(
        dragState.startSize + (event.clientY - dragState.startClient),
        SPREADSHEET_MIN_ROW_HEIGHT,
        SPREADSHEET_MAX_ROW_HEIGHT
      )
      onRowHeightChange?.(dragState.index, nextHeight)
    }

    const onMouseUp = () => setDragState(null)

    document.body.style.cursor = dragState.type === 'column' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragState, onColumnWidthChange, onRowHeightChange])

  useEffect(() => {
    if (!selectionDraft) return undefined

    const stopAutoScroll = () => {
      if (!autoScrollFrameRef.current) return
      cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }

    const runAutoScroll = () => {
      const viewport = viewportRef.current
      const event = lastSelectionMouseEventRef.current
      if (!viewport || !event || !selectionDraftRef.current) {
        stopAutoScroll()
        return
      }

      const delta = getAutoScrollDelta(event, viewport)
      if (delta.x || delta.y) {
        const beforeLeft = viewport.scrollLeft
        const beforeTop = viewport.scrollTop
        viewport.scrollBy(delta.x, delta.y)
        updateSelectionFromMouseEvent(event)
        if (viewport.scrollLeft !== beforeLeft || viewport.scrollTop !== beforeTop) {
          autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll)
        } else {
          stopAutoScroll()
        }
      } else {
        stopAutoScroll()
      }
    }

    const scheduleAutoScroll = () => {
      if (autoScrollFrameRef.current) return
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll)
    }

    const onMouseMove = (event) => {
      if (!(event.buttons & 1)) return
      lastSelectionMouseEventRef.current = event
      updateSelectionFromMouseEvent(event)
      const viewport = viewportRef.current
      if (!viewport) return
      const delta = getAutoScrollDelta(event, viewport)
      if (delta.x || delta.y) scheduleAutoScroll()
      else stopAutoScroll()
    }

    const onMouseUp = (event) => {
      const current = selectionDraftRef.current
      setSelectionDraft(null)
      stopAutoScroll()
      lastSelectionMouseEventRef.current = null
      selectionDraftRef.current = null
      if (!current) return
      const normalized = normalizeSelectionBounds(current)
      if (!normalized) return
      onSelectionComplete?.(normalized, clampSelectionTipPoint({ x: event.clientX + 8, y: event.clientY + 8 }))
    }

    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      stopAutoScroll()
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [onSelectionComplete, selectionDraft, updateSelectionFromMouseEvent])

  if (!safeRows.length) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-dim)' }}>
        {t('userData.emptySheet')}
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className="overflow-auto"
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        position: 'relative',
        background: 'var(--bg-base)',
        overflowX: 'auto',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <table
        style={{
          width: Math.max(tableWidth, viewportWidth || 0),
          minWidth: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: 12,
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: SPREADSHEET_ROW_HEADER_WIDTH }} />
          {resolvedColumnWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              style={{
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 4,
                width: SPREADSHEET_ROW_HEADER_WIDTH,
                minWidth: SPREADSHEET_ROW_HEADER_WIDTH,
                height: SPREADSHEET_HEADER_HEIGHT,
                background: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border)',
                borderRight: '1px solid var(--border-subtle)',
                borderTop: '1px solid var(--border-subtle)',
                borderLeft: '1px solid var(--border-subtle)',
              }}
            />
            {resolvedColumnWidths.map((width, index) => (
              <th
                key={index}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  color: 'var(--text-primary)',
                  background: activeSelection && index >= activeSelection.startColIndex && index <= activeSelection.endColIndex
                    ? SPREADSHEET_SELECTED_HEADER_BACKGROUND
                    : 'var(--bg-elevated)',
                  borderBottom: '1px solid var(--border)',
                  borderRight: '1px solid var(--border-subtle)',
                  borderTop: '1px solid var(--border-subtle)',
                  fontWeight: 600,
                  width,
                  minWidth: width,
                  height: SPREADSHEET_HEADER_HEIGHT,
                  padding: 0,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: SPREADSHEET_HEADER_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 14px',
                  }}
                >
                  {getColumnLabel(index)}
                  <div
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setDragState({
                        type: 'column',
                        index,
                        startClient: event.clientX,
                        startSize: width,
                      })
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: -3,
                      width: 6,
                      height: '100%',
                      cursor: 'col-resize',
                      zIndex: 6,
                    }}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ height: resolvedRowHeights[rowIndex] }}>
              <th
                scope="row"
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 2,
                  color: 'var(--text-dim)',
                  background: activeSelection && rowIndex >= activeSelection.startRowIndex && rowIndex <= activeSelection.endRowIndex
                    ? SPREADSHEET_SELECTED_HEADER_BACKGROUND
                    : 'var(--bg-elevated)',
                  borderBottom: '1px solid var(--border-subtle)',
                  borderRight: '1px solid var(--border-subtle)',
                  fontWeight: 600,
                  width: SPREADSHEET_ROW_HEADER_WIDTH,
                  minWidth: SPREADSHEET_ROW_HEADER_WIDTH,
                  padding: 0,
                  verticalAlign: 'top',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: resolvedRowHeights[rowIndex],
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    paddingTop: 10,
                  }}
                >
                  {rowIndex + 1}
                  <div
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setDragState({
                        type: 'row',
                        index: rowIndex,
                        startClient: event.clientY,
                        startSize: resolvedRowHeights[rowIndex],
                      })
                    }}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: -3,
                      height: 6,
                      cursor: 'row-resize',
                      zIndex: 6,
                    }}
                  />
                </div>
              </th>
              {resolvedColumnWidths.map((width, columnIndex) => {
                const displayValue = toCellDisplayValue(row?.[columnIndex] ?? '')
                const selectionState = getCellSelectionState(rowIndex, columnIndex, activeSelection)
                return (
                  <td
                    key={columnIndex}
                    onMouseDown={(event) => {
                      if (event.button !== 0 || dragState) return
                      event.preventDefault()
                      lastSelectionMouseEventRef.current = event
                      onSelectionStart?.()
                      const nextDraft = {
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex,
                        startColIndex: columnIndex,
                        endColIndex: columnIndex,
                        anchorRowIndex: rowIndex,
                        anchorColIndex: columnIndex,
                      }
                      selectionDraftRef.current = nextDraft
                      setSelectionDraft(nextDraft)
                    }}
                    onMouseEnter={(event) => {
                      if (dragState || !(event.buttons & 1)) return
                      lastSelectionMouseEventRef.current = event
                      const current = selectionDraftRef.current
                      if (!current) return
                      const nextDraft = {
                        ...current,
                        endRowIndex: rowIndex,
                        endColIndex: columnIndex,
                      }
                      selectionDraftRef.current = nextDraft
                      setSelectionDraft(nextDraft)
                    }}
                    style={{
                      color: 'var(--text-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                      borderRight: '1px solid var(--border-subtle)',
                      width,
                      minWidth: width,
                      verticalAlign: 'top',
                      padding: 0,
                      background: 'var(--bg-base)',
                      cursor: 'cell',
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        height: resolvedRowHeights[rowIndex],
                        padding: '8px 10px',
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        display: 'flex',
                        alignItems: 'flex-start',
                        background: selectionState.selected ? SPREADSHEET_SELECTED_CELL_BACKGROUND : 'var(--bg-base)',
                      }}
                    >
                      {selectionState.selected && (
                        <span
                          style={{
                            position: 'absolute',
                            inset: 0,
                            pointerEvents: 'none',
                            borderTop: selectionState.top ? '2px solid var(--blue)' : 'none',
                            borderBottom: selectionState.bottom ? '2px solid var(--blue)' : 'none',
                            borderLeft: selectionState.left ? '2px solid var(--blue)' : 'none',
                            borderRight: selectionState.right ? '2px solid var(--blue)' : 'none',
                            outline: selectionState.anchor ? '1px solid rgba(37, 99, 235, 0.4)' : 'none',
                            outlineOffset: -1,
                          }}
                        />
                      )}
                      {displayValue}
                      {selectionState.anchor && (
                        <span
                          style={{
                            position: 'absolute',
                            right: 2,
                            bottom: 2,
                            width: 6,
                            height: 6,
                            background: 'var(--blue)',
                            borderRadius: 1,
                          }}
                        />
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WorkbookPreview({ sheets, activeSheetIndex, onSelectSheet, t, filePath }) {
  const safeIndex = Math.min(Math.max(activeSheetIndex, 0), Math.max(sheets.length - 1, 0))
  const activeSheet = sheets[safeIndex]
  const activeSheetKey = getSheetLayoutKey(activeSheet, safeIndex)
  const rowCount = activeSheet?.rows?.length || 0
  const columnCount = getMaxColumnCount(activeSheet?.rows || [])
  const [sheetLayouts, setSheetLayouts] = useState({})
  const [selectedRange, setSelectedRange] = useState(null)
  const [selectionTip, setSelectionTip] = useState(null)
  const [selectionPopupData, setSelectionPopupData] = useState(null)

  useEffect(() => {
    setSheetLayouts((prev) => {
      const next = {}
      sheets.forEach((sheet, index) => {
        const key = getSheetLayoutKey(sheet, index)
        if (prev[key]) next[key] = prev[key]
      })
      return next
    })
  }, [sheets])

  const clearSelectionUi = useCallback(() => {
    setSelectedRange(null)
    setSelectionTip(null)
    setSelectionPopupData(null)
  }, [])

  useEffect(() => {
    clearSelectionUi()
  }, [clearSelectionUi, filePath, safeIndex, sheets])

  useEffect(() => {
    if (!selectionTip) return undefined

    const onMouseDown = (event) => {
      const target = event.target
      if (target?.closest?.('[data-xlsx-selection-tip="true"]')) return
      setSelectionTip(null)
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [selectionTip])

  const activeLayout = sheetLayouts[activeSheetKey] || {}
  const handleViewportWidthChange = useCallback((width) => {
    setSheetLayouts((prev) => {
      const current = prev[activeSheetKey] || {}
      if (current.viewportWidth === width) return prev
      return {
        ...prev,
        [activeSheetKey]: {
          ...current,
          viewportWidth: width,
        },
      }
    })
  }, [activeSheetKey])

  const handleColumnWidthChange = useCallback((columnIndex, width) => {
    setSheetLayouts((prev) => {
      const current = prev[activeSheetKey] || {}
      const currentWidths = current.columnWidths || {}
      if (currentWidths[columnIndex] === width) return prev
      return {
        ...prev,
        [activeSheetKey]: {
          ...current,
          columnWidths: {
            ...currentWidths,
            [columnIndex]: width,
          },
        },
      }
    })
  }, [activeSheetKey])

  const handleRowHeightChange = useCallback((rowIndex, height) => {
    setSheetLayouts((prev) => {
      const current = prev[activeSheetKey] || {}
      const currentHeights = current.rowHeights || {}
      if (currentHeights[rowIndex] === height) return prev
      return {
        ...prev,
        [activeSheetKey]: {
          ...current,
          rowHeights: {
            ...currentHeights,
            [rowIndex]: height,
          },
        },
      }
    })
  }, [activeSheetKey])

  const handleSelectionStart = useCallback(() => {
    setSelectionTip(null)
    setSelectionPopupData(null)
  }, [])

  const handleSelectionComplete = useCallback((bounds, anchorPoint) => {
    const nextSelection = buildSpreadsheetSelection(bounds, activeSheet, safeIndex)
    if (!nextSelection) return
    setSelectedRange(nextSelection)
    setSelectionTip({
      x: anchorPoint.x,
      y: anchorPoint.y,
      selection: nextSelection,
    })
  }, [activeSheet, safeIndex])

  const handleSelectionTipClick = useCallback(() => {
    if (!selectionTip?.selection) return
    setSelectionPopupData({
      filePath,
      sheetIndex: selectionTip.selection.sheetIndex,
      sheetName: selectionTip.selection.sheetName,
      range: selectionTip.selection.rangeA1,
      contentTsv: selectionTip.selection.contentTsv,
      anchorX: selectionTip.x,
      anchorY: selectionTip.y,
    })
    setSelectionTip(null)
  }, [filePath, selectionTip])

  return (
    <div className="flex flex-col" style={{ height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, padding: '12px', overflow: 'hidden' }}>
        <div
          className="flex flex-col"
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--bg-base)',
            height: '100%',
            minHeight: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
            <SpreadsheetGrid
              rows={activeSheet?.rows || []}
              t={t}
              columnWidths={activeLayout.columnWidths || {}}
              rowHeights={activeLayout.rowHeights || {}}
              viewportWidth={activeLayout.viewportWidth || 0}
              onViewportWidthChange={handleViewportWidthChange}
              onColumnWidthChange={handleColumnWidthChange}
              onRowHeightChange={handleRowHeightChange}
              selectedRange={selectedRange}
              onSelectionStart={handleSelectionStart}
              onSelectionComplete={handleSelectionComplete}
            />
          </div>
          <div
            className="flex justify-between gap-4 px-3"
            style={{
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              minHeight: 40,
              alignItems: 'stretch',
            }}
          >
            <div
              className="flex overflow-x-auto"
              style={{ flex: 1, minWidth: 0, minHeight: 40 }}
            >
              {sheets.map((sheet, index) => {
                const isActive = index === safeIndex
                return (
                  <button
                    key={`${sheet.name}-${index}`}
                    type="button"
                    className="text-xs"
                    onClick={() => onSelectSheet(index)}
                    onMouseEnter={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background = 'var(--bg-base)'
                        event.currentTarget.style.color = 'var(--text-secondary)'
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background = 'transparent'
                        event.currentTarget.style.color = 'var(--text-secondary)'
                      }
                    }}
                    style={{
                      border: 'none',
                      borderTop: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                      borderRight: '1px solid var(--border-subtle)',
                      borderLeft: index === 0 ? '1px solid var(--border-subtle)' : 'none',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: isActive ? 'var(--bg-base)' : 'transparent',
                      fontWeight: isActive ? 600 : 450,
                      whiteSpace: 'nowrap',
                      height: 40,
                      padding: '0 12px',
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'background 150ms ease, color 150ms ease',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {sheet.name || t('userData.unknownSheet')}
                  </button>
                )
              })}
            </div>
            <div
              className="text-xs"
              style={{
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
                minHeight: 40,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              {t('userData.sheetSummary', {
                current: safeIndex + 1,
                total: sheets.length,
                rows: rowCount,
                columns: columnCount,
              })}
            </div>
          </div>
        </div>
      </div>
      {selectionTip && createPortal(
        <button
          type="button"
          data-xlsx-selection-tip="true"
          className="flex items-center gap-1"
          onClick={handleSelectionTipClick}
          style={{
            position: 'fixed',
            left: selectionTip.x,
            top: selectionTip.y,
            zIndex: 9999,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.color = 'var(--text-primary)'
            event.currentTarget.style.borderColor = 'var(--blue)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = 'var(--text-secondary)'
            event.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <CornerDownLeft size={14} strokeWidth={1.5} />
          {t('quote.provideFeedback')}
        </button>,
        document.body
      )}
      {selectionPopupData && (
        <SelectedXlsxPopup
          data={selectionPopupData}
          onClose={() => setSelectionPopupData(null)}
        />
      )}
    </div>
  )
}

const PPTX_PREVIEW_MIN_WIDTH = 320
const PPTX_PREVIEW_RESIZE_DEBOUNCE_MS = 180
const PPTX_PREVIEW_RERENDER_THRESHOLD = 48

async function normalizePptxArchiveForPreview(buffer) {
  try {
    const mod = await import('jszip')
    const JSZip = mod.default || mod
    const zip = await JSZip.loadAsync(buffer.slice(0))
    const contentTypesFile = zip.file('[Content_Types].xml')
    if (!contentTypesFile || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
      return buffer
    }

    const xml = await contentTypesFile.async('text')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return buffer

    const overrides = Array.from(doc.getElementsByTagName('Override'))
    let removed = false
    overrides.forEach((node) => {
      const partName = node.getAttribute('PartName') || ''
      const zipPath = partName.replace(/^\/+/, '')
      if (zipPath && !zip.file(zipPath)) {
        node.parentNode?.removeChild(node)
        removed = true
      }
    })

    if (!removed) return buffer
    zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(doc))
    return zip.generateAsync({ type: 'arraybuffer' })
  } catch {
    return buffer
  }
}

function PptxPreview({ buffer }) {
  const viewportRef = useRef(null)
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!buffer) return undefined
    const viewport = viewportRef.current
    const el = containerRef.current
    if (!viewport || !el) return undefined

    let cancelled = false
    let previewer = null
    let renderedWidth = 0
    let pendingTargetWidth = 0
    let renderInFlight = false
    let queuedRenderWidth = null
    let resizeTimer = null
    let settleTimer = null
    let resizeObserver = null
    let frameId = null
    const previewBufferPromise = normalizePptxArchiveForPreview(buffer)

    const applyVisualWidth = (width) => {
      const wrapper = el.querySelector('.pptx-preview-wrapper')
      if (!wrapper) return
      const baseWidth = renderedWidth || width
      const scale = width / baseWidth
      const baseHeight = wrapper.scrollHeight || wrapper.getBoundingClientRect().height || Math.round((baseWidth * 9) / 16)

      pendingTargetWidth = width
      el.style.setProperty('width', `${width}px`)
      el.style.setProperty('max-width', '100%')
      el.style.setProperty('height', `${Math.ceil(baseHeight * scale)}px`)
      el.style.setProperty('transition', 'height 120ms cubic-bezier(0.16, 1, 0.3, 1)')

      wrapper.style.setProperty('transform', `scale(${scale})`)
      wrapper.style.setProperty('transition', 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)')
    }

    const normalizeRenderedLayout = (width) => {
      const wrapper = el.querySelector('.pptx-preview-wrapper')
      if (!wrapper) return
      renderedWidth = width
      wrapper.style.setProperty('background', 'transparent')
      wrapper.style.setProperty('width', `${width}px`)
      wrapper.style.setProperty('min-width', `${width}px`)
      wrapper.style.setProperty('height', 'auto')
      wrapper.style.setProperty('overflow', 'visible')
      wrapper.style.setProperty('overflow-y', 'visible')
      wrapper.style.setProperty('max-width', `${width}px`)

      el.querySelectorAll('.pptx-preview-slide-wrapper').forEach((slide) => {
        slide.style.setProperty('width', `${width}px`)
        slide.style.setProperty('outline', '1px solid var(--border-subtle)')
        slide.style.setProperty('margin', '0 auto 12px')
      })

      applyVisualWidth(pendingTargetWidth || width)
    }

    const renderAt = async (width) => {
      if (renderInFlight) {
        queuedRenderWidth = width
        return
      }
      renderInFlight = true
      try {
        setError(null)
        const mod = await import('pptx-preview')
        if (cancelled) return
        const init = mod.init || mod.default?.init || mod.default
        if (typeof init !== 'function') {
          throw new Error('pptx-preview did not expose init()')
        }
        try {
          previewer?.destroy?.()
        } catch {
          /* ignore */
        }
        const previewBuffer = await previewBufferPromise
        if (cancelled) return
        el.innerHTML = ''
        previewer = init(el, { width, mode: 'list' })
        const result = previewer.preview(previewBuffer.slice(0))
        if (result && typeof result.then === 'function') await result
        if (!cancelled) normalizeRenderedLayout(width)
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err))
      } finally {
        renderInFlight = false
        if (!cancelled && queuedRenderWidth != null) {
          const queued = queuedRenderWidth
          queuedRenderWidth = null
          if (Math.abs(queued - renderedWidth) >= 4) renderAt(queued)
          else applyVisualWidth(queued)
        }
      }
    }

    const getTargetWidth = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const style = window.getComputedStyle(viewport)
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const parentWidth = viewport.parentElement?.clientWidth || viewport.offsetParent?.clientWidth || 0
      const measuredWidth = Math.max(viewport.clientWidth || 0, viewportRect.width || 0, parentWidth)
      const available = measuredWidth - horizontalPadding
      return Math.max(PPTX_PREVIEW_MIN_WIDTH, Math.floor(available))
    }

    const renderCurrentWidth = () => {
      if (cancelled) return
      const next = getTargetWidth()
      renderAt(next)
    }

    const syncVisualWidth = () => {
      if (cancelled) return
      const next = getTargetWidth()
      pendingTargetWidth = next
      applyVisualWidth(next)
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (cancelled) return
        const settledWidth = getTargetWidth()
        pendingTargetWidth = settledWidth
        applyVisualWidth(settledWidth)
        if (!renderedWidth || Math.abs(settledWidth - renderedWidth) >= PPTX_PREVIEW_RERENDER_THRESHOLD) {
          renderAt(settledWidth)
        }
      }, PPTX_PREVIEW_RESIZE_DEBOUNCE_MS)
    }

    frameId = requestAnimationFrame(() => {
      renderCurrentWidth()
      settleTimer = setTimeout(syncVisualWidth, 80)
    })

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return
        syncVisualWidth()
      })
      resizeObserver.observe(viewport)
    }

    return () => {
      cancelled = true
      if (frameId) cancelAnimationFrame(frameId)
      if (settleTimer) clearTimeout(settleTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (resizeObserver) resizeObserver.disconnect()
      try {
        previewer?.destroy?.()
      } catch {
        /* ignore */
      }
      if (el) el.innerHTML = ''
    }
  }, [buffer])

  if (error) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>
        {error}
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className="overflow-auto"
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        flex: 1,
        padding: 12,
        boxSizing: 'border-box',
        background: 'var(--bg-base)',
      }}
    >
      <div
        ref={containerRef}
        className="pptx-preview-host"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          minWidth: 0,
        }}
      />
    </div>
  )
}

function HtmlPreview({ content }) {
  return (
    <iframe
      title="HTML preview"
      sandbox=""
      srcDoc={content}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 500,
        border: 'none',
        background: 'white',
      }}
    />
  )
}

function ImagePreview({ src, alt }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 320,
        padding: 16,
        background: 'var(--bg-base)',
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          borderRadius: 4,
          outline: '1px solid var(--border-subtle)',
          background: 'white',
        }}
      />
    </div>
  )
}

function getFileExtension(file) {
  if (file.ext) return String(file.ext).toLowerCase()
  const name = file.name || file.original_name || ''
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function getMimeType(file) {
  return String(file.mime_type || file.mimeType || '').toLowerCase()
}

function inferPreviewKind(file, ext) {
  const mimeType = getMimeType(file)

  if (ext === '.csv' || mimeType === 'text/csv') return 'csv'
  if (SPREADSHEET_EXTENSIONS.has(ext) || SPREADSHEET_MIME_TYPES.has(mimeType) || mimeType.includes('spreadsheetml')) {
    return 'spreadsheet'
  }
  if (WORD_EXTENSIONS.has(ext) || WORD_MIME_TYPES.has(mimeType) || mimeType.includes('wordprocessingml')) {
    return 'docx'
  }
  if (PRESENTATION_EXTENSIONS.has(ext) || PRESENTATION_MIME_TYPES.has(mimeType) || mimeType.includes('presentationml')) {
    return 'pptx'
  }
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) return 'image'
  if (ext === '.pdf' || mimeType === 'application/pdf') return 'pdf'
  if (ext === '.html' || ext === '.htm' || mimeType === 'text/html') return 'html'
  if (ext === '.mmd' || ext === '.mermaid') return 'mermaid'
  if (ext === '.md' || mimeType === 'text/markdown') return 'markdown'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (STRUCTURED_EXTENSIONS.has(ext) || STRUCTURED_MIME_TYPES.has(mimeType)) return 'structured'
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) return 'text'
  return 'binary'
}

function hasSignature(bytes, signature) {
  if (bytes.length < signature.length) return false
  return signature.every((value, index) => bytes[index] === value)
}

function isZipContainer(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4))
  return ZIP_SIGNATURES.some((signature) => hasSignature(bytes, signature))
}

function isOleContainer(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8))
  return hasSignature(bytes, OLE_SIGNATURE)
}

function describeHeader(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16))
  const ascii = Array.from(bytes, (value) => (value >= 32 && value <= 126 ? String.fromCharCode(value) : '.')).join('')
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(' ')
  return `"${ascii}" (${hex})`
}

function assertValidOfficeBuffer(file, ext, previewKind, buffer) {
  if (previewKind === 'spreadsheet') {
    if (ext === '.xlsx') {
      if (!isZipContainer(buffer)) {
        throw new Error(`Invalid Excel file: .xlsx files must start with a ZIP header. Actual header: ${describeHeader(buffer)}`)
      }
      return
    }

    if (ext === '.xls') {
      if (!isZipContainer(buffer) && !isOleContainer(buffer)) {
        throw new Error(`Invalid Excel file: .xls files must use an OLE or ZIP Office container. Actual header: ${describeHeader(buffer)}`)
      }
      return
    }
  }

  if (previewKind === 'docx') {
    if (ext === '.docx' && !isZipContainer(buffer)) {
      throw new Error(`Invalid Word file: .docx files must start with a ZIP header. Actual header: ${describeHeader(buffer)}`)
    }
    if (ext === '.doc' && !isZipContainer(buffer) && !isOleContainer(buffer)) {
      throw new Error(`Invalid Word file: .doc files must use an OLE or ZIP Office container. Actual header: ${describeHeader(buffer)}`)
    }
  }

  if (previewKind === 'pptx' && !isZipContainer(buffer)) {
    throw new Error(`Invalid PowerPoint file: .pptx files must start with a ZIP header. Actual header: ${describeHeader(buffer)}`)
  }
}

function sanitizeDocument(doc) {
  const blockedTags = ['script', 'iframe', 'object', 'embed', 'meta', 'base', 'link[rel="import"]']
  blockedTags.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => node.remove())
  })

  doc.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()

      if (name.startsWith('on') || name === 'srcdoc') {
        node.removeAttribute(attr.name)
        return
      }

      if (
        ['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name) &&
        (value.startsWith('javascript:') || value.startsWith('data:text/html'))
      ) {
        node.removeAttribute(attr.name)
        return
      }

      if (name === 'target') {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    })
  })
}

function sanitizeHtmlDocument(html) {
  if (typeof DOMParser === 'undefined') return html
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  sanitizeDocument(doc)
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

function sanitizeHtmlFragment(html) {
  if (typeof DOMParser === 'undefined') return html
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html')
  sanitizeDocument(doc)
  return doc.body.innerHTML
}

export default function RichFilePreview({
  file,
  cacheKey,
  loadText,
  loadArrayBuffer,
  loadBlob,
  fallbackText = null,
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tables, setTables] = useState(null)
  const [pptxBuffer, setPptxBuffer] = useState(null)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)

  const ext = getFileExtension(file)
  const previewKind = inferPreviewKind(file, ext)
  const key = cacheKey || file.path || file.uuid || file.name || file.original_name || `${ext}:${previewKind}`

  useEffect(() => {
    let cancelled = false
    let objectUrl = null

    setContent(null)
    setTables(null)
    setPptxBuffer(null)
    setActiveSheetIndex(0)
    setError(null)
    setLoading(true)

    const fetchTextContent = async () => {
      if (typeof file.content === 'string') return file.content
      if (typeof loadText === 'function') return loadText()
      if (fallbackText != null) return fallbackText
      throw new Error('No text preview available')
    }

    const fetchArrayBuffer = async () => {
      if (typeof loadArrayBuffer === 'function') return loadArrayBuffer()
      throw new Error('No binary preview available')
    }

    const fetchBlob = async () => {
      if (typeof loadBlob === 'function') return loadBlob()
      throw new Error('No blob preview available')
    }

    const run = async () => {
      try {
        if (previewKind === 'csv') {
          const text = await fetchTextContent()
          const Papa = (await import('papaparse')).default
          const result = Papa.parse(text, { skipEmptyLines: true })
          if (!cancelled) setTables([{ name: 'CSV', rows: result.data }])
          return
        }

        if (previewKind === 'spreadsheet') {
          const buffer = await fetchArrayBuffer()
          assertValidOfficeBuffer(file, ext, previewKind, buffer)
          const XLSX = await import('xlsx')
          const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
          const allSheets = workbook.SheetNames.map((sheetName) => ({
            name: sheetName,
            rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }),
          }))
          const firstNonEmptySheetIndex = allSheets.findIndex((sheet) =>
            sheet.rows.some((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
          )
          if (!cancelled) {
            setTables(allSheets)
            setActiveSheetIndex(firstNonEmptySheetIndex >= 0 ? firstNonEmptySheetIndex : 0)
          }
          return
        }

        if (previewKind === 'docx') {
          const buffer = await fetchArrayBuffer()
          assertValidOfficeBuffer(file, ext, previewKind, buffer)
          const mammoth = await import('mammoth')
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          if (!cancelled) setContent(sanitizeHtmlFragment(result.value))
          return
        }

        if (previewKind === 'pptx') {
          const buffer = await fetchArrayBuffer()
          assertValidOfficeBuffer(file, ext, previewKind, buffer)
          if (!cancelled) setPptxBuffer(buffer)
          return
        }

        if (previewKind === 'pdf') {
          const blob = await fetchBlob()
          objectUrl = URL.createObjectURL(blob)
          if (!cancelled) setContent(objectUrl)
          return
        }

        if (previewKind === 'image') {
          const blob = await fetchBlob()
          objectUrl = URL.createObjectURL(blob)
          if (!cancelled) setContent(objectUrl)
          return
        }

        if (previewKind === 'html') {
          const text = await fetchTextContent()
          if (!cancelled) setContent(sanitizeHtmlDocument(text))
          return
        }

        if (previewKind === 'markdown' || previewKind === 'mermaid' || previewKind === 'code' || previewKind === 'structured' || previewKind === 'text') {
          const text = await fetchTextContent()
          if (!cancelled) setContent(text)
          return
        }
      } catch (err) {
        if (!cancelled) {
          if (
            fallbackText != null &&
            (previewKind === 'markdown' || previewKind === 'mermaid' || previewKind === 'code' || previewKind === 'structured' || previewKind === 'text' || previewKind === 'html')
          ) {
            setContent(previewKind === 'html' ? sanitizeHtmlDocument(fallbackText) : fallbackText)
            setError(null)
          } else {
            setError(err?.message || String(err))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [cacheKey, ext, fallbackText, file, key, loadArrayBuffer, loadBlob, loadText, previewKind])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 16 }} />
        <div className="skeleton" style={{ width: '60%', height: 16 }} />
        <div className="skeleton" style={{ width: '90%', height: 16 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>
        {t('userData.previewError')}: {error}
      </div>
    )
  }

  if (tables) {
    if (previewKind === 'spreadsheet') {
      return (
        <WorkbookPreview
          sheets={tables}
          activeSheetIndex={activeSheetIndex}
          onSelectSheet={setActiveSheetIndex}
          t={t}
          filePath={file.path || file.name || file.original_name || ''}
        />
      )
    }
    return <TablePreview rows={tables[0]?.rows || []} />
  }

  if (previewKind === 'docx' && content) {
    return (
      <div
        className="px-4 py-3"
        style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  if (previewKind === 'pptx' && pptxBuffer) {
    return <PptxPreview buffer={pptxBuffer} />
  }

  if (previewKind === 'pdf' && content) {
    return (
      <object
        data={content}
        type="application/pdf"
        style={{ width: '100%', height: '100%', minHeight: 500, border: 'none' }}
      >
        <div className="p-4 text-xs" style={{ color: 'var(--text-dim)' }}>
          {t('userData.pdfNotSupported')}
        </div>
      </object>
    )
  }

  if (previewKind === 'image' && content) {
    return <ImagePreview src={content} alt={file.name || file.original_name || 'image preview'} />
  }

  if (previewKind === 'html' && content) {
    return <HtmlPreview content={content} />
  }

  if (previewKind === 'markdown' && content) {
    return <MarkdownPreview content={content} />
  }

  if (previewKind === 'mermaid' && content != null) {
    return <MermaidFilePreview content={content} />
  }

  if ((previewKind === 'code' || previewKind === 'structured') && content) {
    return <CodePreview content={content} language={getLanguage(ext)} />
  }

  if (content != null) {
    return <TextPreview content={content} />
  }

  return (
    <div className="p-4 text-xs" style={{ color: 'var(--text-dim)' }}>
      {t('userData.noPreview')}
    </div>
  )
}
