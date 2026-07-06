import { memo, useState, useEffect, useId, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Loader, Copy, Check, AlertTriangle, Repeat, ArrowDownToLine, ArrowUpFromLine, PanelRight, ChevronRight, ChevronDown, FileText, FilePen, CornerDownLeft, RotateCcw, GitBranch, ExternalLink, ScrollText, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import ToolCallCard from './ToolCallCard'
import SubagentFrame from './SubagentFrame'
import ToolRunSection from './ToolRunSection'
import TodoWriteCard from './TodoWriteCard'
import AskUserQuestionCard from './AskUserQuestionCard'
import { formatMessageTimestamp, formatDateTime } from '../../utils/formatTime'
import ErrorBlock from './ErrorBlock'
import RetryIndicator from './RetryIndicator'
import CopyButton from '../shared/CopyButton'
import ImageLightbox from '../shared/ImageLightbox'
import Chip from '../shared/Chip'
import FileReferenceCard from '../shared/FileReferenceCard'
import SelectedXlsxCard from '../shared/SelectedXlsxCard'
import SelectedFileCard from '../shared/SelectedFileCard'
import { RollingInteger } from '../shared/Odometer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import useUiStore from '../../stores/uiStore'
import useChatStore from '../../stores/chatStore'
import useTaskStore from '../../stores/taskStore'
import { copyTextToClipboard } from '../../utils/clipboard'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { getToolDisplayName } from '../../utils/generatedTool'
import { parseSelectedXlsx } from '../../utils/selectedXlsx'
import { parseSelectedFile } from '../../utils/selectedFile'

/**
 * Parse text containing <think>...</think> tags into segments.
 * Returns array of { type: 'text' | 'thinking', content: string }
 */
function parseThinkTags(text) {
  const regex = /<think>([\s\S]*?)<\/think>/g
  const segments = []
  let lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: 'text', content: before })
    }
    const thinking = match[1].trim()
    if (thinking) segments.push({ type: 'thinking', content: thinking })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) segments.push({ type: 'text', content: after })
  }
  return segments.length > 0 ? segments : null
}

function contentHasThinking(contentBlocks) {
  return contentBlocks.some((block) => {
    if (block?.type === 'thinking') return Boolean(block.thinking?.trim())
    if (block?.type !== 'text') return false

    const segments = parseThinkTags(block.text || '')
    return Boolean(segments?.some((segment) => segment.type === 'thinking' && segment.content?.trim()))
  })
}

function ThinkingBlock({ content, t, streaming = false }) {
  return (
    <details className="thinking-block">
      <summary
        className="flex items-center gap-1 px-2 rounded-sm"
        style={{
          fontSize: 11,
          color: 'var(--purple)',
          cursor: 'pointer',
          userSelect: 'none',
          listStyle: 'none',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          width: 'fit-content',
          height: 22,
          transition: 'background 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
      >
        {streaming ? (
          <span className="thinking-shimmer">{t('chat.thinking')}</span>
        ) : (
          <>
            <Check size={10} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0 }} />
            {t('chat.thoughtComplete')}
            <ChevronRight size={10} strokeWidth={1.5} className="thinking-chevron" style={{ color: 'var(--text-dim)', flexShrink: 0, transition: 'transform 150ms ease' }} />
          </>
        )}
      </summary>
      <div
        className="px-3 py-2 mt-1 text-xs"
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: '2px',
          color: 'var(--text-dim)',
          borderLeft: '2px solid var(--purple)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content}
      </div>
    </details>
  )
}

function formatDuration(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
}

function getCompactDiffPalette(kind) {
  if (kind === 'add') {
    return {
      text: 'var(--green)',
      number: 'var(--text-dim)',
      sign: '+',
    }
  }

  if (kind === 'remove') {
    return {
      text: 'var(--red)',
      number: 'var(--text-dim)',
      sign: '-',
    }
  }

  return {
    text: 'var(--text-secondary)',
    number: 'var(--text-dim)',
    sign: ' ',
  }
}

function getCompactEditStats(op) {
  const patch = op?.structuredPatch
  if (patch && Array.isArray(patch.hunks)) {
    let added = 0
    let removed = 0
    for (const hunk of patch.hunks) {
      for (const line of hunk?.lines || []) {
        if (typeof line !== 'string' || line.length === 0) continue
        if (line.startsWith('+++') || line.startsWith('---')) continue
        if (line[0] === '+') added += 1
        else if (line[0] === '-') removed += 1
      }
    }
    return { added, removed }
  }

  const oldLines = String(op?.input?.old_string || '')
  const newLines = String(op?.input?.new_string || '')
  const removed = oldLines ? oldLines.split('\n').length : 0
  const added = newLines ? newLines.split('\n').length : 0
  return { added, removed }
}

function buildCompactEditRows(op, maxRows = 18) {
  const patch = op?.structuredPatch
  const rows = []
  let truncated = false

  if (patch && Array.isArray(patch.hunks)) {
    for (const hunk of patch.hunks) {
      if (rows.length >= maxRows) {
        truncated = true
        break
      }

      let oldLine = hunk.oldStart
      let newLine = hunk.newStart

      for (const line of hunk.lines || []) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+++') || line.startsWith('---')) continue
        const prefix = line[0]

        if (prefix === '+') {
          rows.push({ type: 'diff', kind: 'add', oldNum: null, newNum: newLine, text: line })
          newLine += 1
        } else if (prefix === '-') {
          rows.push({ type: 'diff', kind: 'remove', oldNum: oldLine, newNum: null, text: line })
          oldLine += 1
        } else {
          rows.push({ type: 'diff', kind: 'context', oldNum: oldLine, newNum: newLine, text: line || ' ' })
          oldLine += 1
          newLine += 1
        }

        if (rows.length >= maxRows) {
          truncated = true
          break
        }
      }
    }

    if (rows.length > 0) return { rows, truncated }
  }

  if (op?.input?.old_string != null || op?.input?.new_string != null) {
    const oldString = String(op?.input?.old_string || '')
    const newString = String(op?.input?.new_string || '')
    const oldLines = oldString.split('\n')
    const newLines = newString.split('\n')
    const limitedOld = oldLines.slice(0, maxRows)
    const remaining = Math.max(maxRows - limitedOld.length, 0)
    const limitedNew = newLines.slice(0, remaining)
    const originalFile = op?.originalFile
      || op?.toolUseResult?.original_file
      || op?.toolUseResult?.originalFile
      || op?.resultContent
    let oldStartLine = 1

    if (oldString && typeof originalFile === 'string') {
      const oldIndex = originalFile.indexOf(oldString)
      if (oldIndex >= 0) {
        oldStartLine = originalFile.slice(0, oldIndex).split('\n').length
      }
    }

    limitedOld.forEach((line, index) => {
      rows.push({ type: 'diff', kind: 'remove', oldNum: oldStartLine + index, newNum: null, text: `-${line}` })
    })
    limitedNew.forEach((line, index) => {
      rows.push({ type: 'diff', kind: 'add', oldNum: null, newNum: oldStartLine + index, text: `+${line}` })
    })

    truncated = oldLines.length + newLines.length > limitedOld.length + limitedNew.length
  }

  return rows.length > 0 ? { rows, truncated } : null
}

function countContentLines(str) {
  if (typeof str !== 'string' || str.length === 0) return 0
  const normalized = str.endsWith('\n') ? str.slice(0, -1) : str
  if (!normalized) return 0
  return normalized.split('\n').length
}

function fileNameFromPath(filePath) {
  if (!filePath) return '(untitled)'
  const parts = filePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function buildCompactWriteRows(op, maxRows = 18) {
  const content = op?.content || op?.input?.content || ''
  if (typeof content !== 'string' || content.length === 0) return null
  const lines = content.split('\n')
  return {
    rows: lines.slice(0, maxRows).map((line, index) => ({
      type: 'diff',
      kind: 'add',
      oldNum: null,
      newNum: index + 1,
      text: `+${line}`,
    })),
    truncated: lines.length > maxRows,
  }
}

function getReadMeta(block) {
  const input = block?.input || {}
  const result = block?.result
  let actual = null
  if (result && typeof result.content === 'string' && result.content) {
    actual = result.content.split('\n').filter((line) => line.length > 0).length
  }
  const linesSuffix = actual != null ? ` · ${actual} lines` : ''
  if (input.offset != null && input.limit != null) return `L${input.offset}–L${input.offset + input.limit - 1}${linesSuffix}`
  if (input.limit != null) return `L1–L${input.limit}${linesSuffix}`
  if (input.offset != null) return `from L${input.offset}${linesSuffix}`
  return `full file${linesSuffix}`
}

function PathCopyButton({ path }) {
  const [copied, setCopied] = useState(false)
  if (!path) return null
  return (
    <button
      type="button"
      aria-label="Copy full path"
      onClick={async (event) => {
        event.stopPropagation()
        const didCopy = await copyTextToClipboard(path)
        if (!didCopy) return
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        border: 'none',
        background: 'transparent',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        cursor: 'pointer',
        padding: 0,
        transition: 'color 150ms ease',
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} strokeWidth={1.5} /> : <Copy size={11} strokeWidth={1.5} />}
    </button>
  )
}

function normalizeToolErrorText(value) {
  if (value == null) return ''
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
  }

  return text
    .replace(/^<tool_use_error>/, '')
    .replace(/<\/tool_use_error>$/, '')
    .trim()
}

function getToolErrorText(op, block) {
  const candidates = [
    op?.resultContent,
    block?.result?.content,
    op?.toolUseResult?.error,
    op?.toolUseResult?.message,
    typeof op?.toolUseResult === 'string' ? op.toolUseResult : null,
    block?.result?.error,
  ]

  for (const candidate of candidates) {
    const text = normalizeToolErrorText(candidate)
    if (text) return text
  }
  return ''
}

function getErrorSummary(text) {
  return text.split('\n').map((line) => line.trim()).find(Boolean) || ''
}

function CompactFilePreview({ preview }) {
  if (!preview?.rows?.length) return null
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        maxHeight: 400,
        overflowY: 'auto',
        overflowX: 'auto',
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        padding: '8px 10px',
        lineHeight: 1.6,
      }}
    >
      {preview.rows.map((row, index) => {
        const palette = getCompactDiffPalette(row.kind)
        const lineNumber = row.kind === 'remove' ? row.oldNum : (row.newNum ?? row.oldNum)
        return (
          <div
            key={`preview-${index}`}
            className="text-xs"
            style={{
              display: 'grid',
              gridTemplateColumns: '32px minmax(max-content, 1fr)',
              columnGap: 8,
              minWidth: 'max-content',
            }}
          >
            <span
              style={{
                textAlign: 'right',
                color: palette.number,
                fontSize: 11,
                userSelect: 'none',
              }}
            >
              {lineNumber ?? ''}
            </span>
            <span
              style={{
                color: palette.text,
                whiteSpace: 'pre',
              }}
            >
              {row.text}
            </span>
          </div>
        )
      })}
      {preview.truncated && (
        <div
          className="text-xs"
          style={{
            color: 'var(--text-dim)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            marginTop: 2,
          }}
        >
          ...
        </div>
      )}
    </div>
  )
}

function InlineCopyButton({ content }) {
  const [copied, setCopied] = useState(false)
  return (
    <span
      className="flex-shrink-0"
      onClick={async (e) => {
        e.stopPropagation()
        const didCopy = await copyTextToClipboard(content)
        if (!didCopy) return
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      style={{
        cursor: 'pointer',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease',
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 4,
      }}
    >
      {copied
        ? <Check size={12} strokeWidth={1.5} />
        : <Copy size={12} strokeWidth={1.5} />}
    </span>
  )
}

function buildPreviewOutputStr(preview) {
  if (!preview?.rows?.length) return ''
  const body = preview.rows.map((r) => r.text).join('\n')
  return preview.truncated ? `${body}\n...` : body
}

function DeltaStat({ sign, value, color, fontSize = 12 }) {
  const height = fontSize <= 11 ? 18 : 20
  return (
    <span
      style={{
        color,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        fontSize,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        height,
        lineHeight: `${height}px`,
        verticalAlign: 'middle',
      }}
    >
      <span>{sign}</span>
      <RollingInteger value={value} height={12} color="currentColor" />
    </span>
  )
}

function FileToolCard({ kind, block = null, op = null, reverted = false }) {
  const { t } = useTranslation()
  const bodyId = useId()
  const [hovered, setHovered] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const setSelectedFileOpId = useFileOpsStore((s) => s.setSelectedFileOpId)
  const openFile = useFileBrowserStore((s) => s.openFile)
  const resolvedPath = op?.filePath || block?.filePath || block?.input?.file_path || ''
  const fileName = fileNameFromPath(resolvedPath)
  const normalizedKind = kind || op?.type || block?.name || 'file'
  const displayKind = normalizedKind === 'generated' ? 'FILECANVAS' : normalizedKind.charAt(0).toUpperCase() + normalizedKind.slice(1)
  const isRead = displayKind === 'Read'
  const isWrite = displayKind === 'Write'
  const isEdit = displayKind === 'Edit'
  const status = op?.status || block?.status || 'success'
  const isError = status === 'error' || block?.result?.is_error
  const statusTone = isError ? 'error' : status === 'running' ? 'running' : 'success'
  const errorText = isError ? getToolErrorText(op, block) : ''
  const errorSummary = errorText ? getErrorSummary(errorText) : ''
  const hasErrorDetails = Boolean(errorText)
  const statusColor = statusTone === 'error' ? 'var(--red)' : statusTone === 'running' ? 'var(--purple)' : 'var(--green)'
  const accent = isRead ? 'var(--text-dim)' : isWrite ? 'var(--cyan)' : isEdit ? 'var(--yellow)' : 'var(--green)'
  const Icon = isEdit ? FilePen : FileText
  const editStats = isEdit ? getCompactEditStats(op) : null
  const writeLines = isWrite ? countContentLines(op?.content || op?.input?.content) : 0
  const showChangeStats = statusTone === 'success'
  const preview = isEdit ? buildCompactEditRows(op, 18) : isWrite ? buildCompactWriteRows(op, 18) : null
  const hasPreview = Boolean(preview?.rows?.length)
  const hasDetails = hasErrorDetails || hasPreview
  const meta = isRead ? getReadMeta(block) : null
  const duration = block?.duration ? formatDuration(block.duration) : null
  const actionSize = 20
  const statusChipStyle = {
    height: actionSize,
    padding: '0 6px',
    lineHeight: `${actionSize - 2}px`,
    display: 'inline-flex',
    alignItems: 'center',
  }

  useEffect(() => {
    if (isError) setIsOpen(true)
  }, [isError])

  const openInFileBrowser = () => {
    if (!resolvedPath) return
    openFile({
      filePath: resolvedPath,
      name: fileName,
      mimeType: op?.mimeType,
      extension: op?.extension,
      size: op?.size,
      source: displayKind,
    })
    showCanvas()
    setActiveCanvasTab('file-browser')
  }

  const openInChangeReview = () => {
    if (!op?.id) {
      openInFileBrowser()
      return
    }
    showCanvas()
    setActiveCanvasTab('changes')
    setSelectedFileOpId(op.id)
  }

  const openExternal = isWrite || isEdit ? openInChangeReview : openInFileBrowser

  const outputStr = buildPreviewOutputStr(preview)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full overflow-hidden"
      style={{
        background: 'var(--bg-elevated)',
        borderTop: `1px solid ${hovered ? 'var(--border)' : 'var(--border-subtle)'}`,
        borderRight: `1px solid ${hovered ? 'var(--border)' : 'var(--border-subtle)'}`,
        borderBottom: `1px solid ${hovered ? 'var(--border)' : 'var(--border-subtle)'}`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: '4px',
        transition: 'border-color 150ms ease, background 150ms ease',
        opacity: reverted ? 0.55 : 1,
        filter: reverted ? 'grayscale(0.4)' : 'none',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          columnGap: 6,
          background: hovered ? 'var(--bg-surface)' : 'transparent',
          minWidth: 0,
          overflow: 'hidden',
          padding: '4px 6px',
          transition: 'background 150ms ease',
        }}
      >
        <div
          role={hasDetails ? 'button' : undefined}
          tabIndex={hasDetails ? 0 : undefined}
          aria-expanded={hasDetails ? isOpen : undefined}
          aria-controls={hasDetails ? bodyId : undefined}
          className="flex items-center gap-1 min-w-0"
          onClick={() => {
            if (hasDetails) setIsOpen((next) => !next)
          }}
          onKeyDown={(event) => {
            if (!hasDetails) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setIsOpen((next) => !next)
            }
          }}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            color: 'inherit',
            cursor: hasDetails ? 'pointer' : 'default',
            padding: 0,
            textAlign: 'left',
          }}
        >
          {hasDetails ? (
            <AnimatedChevron open={isOpen} style={{ color: 'var(--text-dim)' }}>
              <ChevronDown size={12} strokeWidth={1.5} />
            </AnimatedChevron>
          ) : (
            <span style={{ width: 12, height: 12, flexShrink: 0 }} />
          )}
          <Icon size={12} strokeWidth={1.5} style={{ color: accent, flexShrink: 0 }} />
          <span
            className="font-semibold"
            style={{
              color: 'var(--text-primary)',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {displayKind}
          </span>
          <button
            type="button"
            className="truncate"
            onClick={(event) => {
              event.stopPropagation()
              openInFileBrowser()
            }}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: hovered ? 'var(--blue)' : 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              flex: '0 1 auto',
              maxWidth: 180,
              minWidth: 0,
              padding: 0,
              textDecoration: hovered ? 'underline' : 'none',
            }}
            aria-label={resolvedPath ? `Open ${resolvedPath} in file browser` : 'Open file in file browser'}
          >
            {fileName}
          </button>
          <PathCopyButton path={resolvedPath} />
          {errorSummary && (
            <span
              className="truncate"
              title={errorText}
              style={{
                color: 'var(--red)',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                minWidth: 0,
                flex: '1 1 auto',
              }}
            >
              · {errorSummary}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              <Clock size={10} strokeWidth={1.5} />
              {duration}
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-2"
          style={{
            minWidth: 'max-content',
            justifySelf: 'end',
            overflow: 'visible',
            alignItems: 'center',
            minHeight: actionSize,
            lineHeight: 1,
          }}
        >
          {meta && (
            <span
              className="text-xs"
              style={{ color: 'var(--text-dim)', flexShrink: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 11, whiteSpace: 'nowrap' }}
            >
              · {meta}
            </span>
          )}
          {showChangeStats && isWrite && writeLines > 0 && (
            <DeltaStat sign="+" value={writeLines} color="var(--green)" />
          )}
          {showChangeStats && isEdit && editStats && (editStats.added > 0 || editStats.removed > 0) && (
            <>
              <DeltaStat sign="+" value={editStats.added} color="var(--green)" />
              <DeltaStat sign="-" value={editStats.removed} color="var(--red)" />
            </>
          )}
          <button
            type="button"
            aria-label="Open in Canvas"
            onClick={(event) => {
              event.stopPropagation()
              openExternal()
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              lineHeight: 0,
              border: '1px solid transparent',
              borderRadius: '2px',
              background: 'transparent',
              color: hovered ? 'var(--text-secondary)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = 'var(--border)'
              event.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'transparent'
              event.currentTarget.style.background = 'transparent'
            }}
          >
            <ExternalLink size={12} strokeWidth={1.5} />
          </button>
          {statusTone === 'error' ? (
            <span
              className="chip"
              style={{
                color: 'var(--text-inverse)',
                background: 'var(--red)',
                borderColor: 'var(--red)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                opacity: 1,
                flexShrink: 0,
                ...statusChipStyle,
              }}
            >
              <AlertTriangle size={10} strokeWidth={1.5} style={{ marginRight: 2 }} /> {t('toolCall.error')}
            </span>
          ) : statusTone === 'running' ? (
            <span
              className="chip"
              style={{
                color: 'var(--purple)',
                background: 'rgba(188, 140, 255, 0.1)',
                borderColor: 'rgba(188, 140, 255, 0.3)',
                opacity: 1,
                flexShrink: 0,
                ...statusChipStyle,
              }}
            >
              <Loader size={10} strokeWidth={1.5} className="icon-running" style={{ marginRight: 2 }} />
              <span className="thinking-shimmer" style={{ fontSize: 11 }}>{t('toolCall.running')}</span>
            </span>
          ) : (
            <span
              className="chip"
              style={{
                color: 'var(--green)',
                background: 'rgba(63, 185, 80, 0.15)',
                borderColor: 'rgba(63, 185, 80, 0.4)',
                opacity: 1,
                flexShrink: 0,
                ...statusChipStyle,
              }}
            >
              <Check size={10} strokeWidth={1.5} style={{ marginRight: 2 }} /> {t('toolCall.success')}
            </span>
          )}
          {reverted && (
            <span
              className="chip"
              style={{
                color: 'var(--text-dim)',
                background: 'transparent',
                borderColor: 'var(--border)',
                letterSpacing: '0.06em',
                ...statusChipStyle,
              }}
            >
              <RotateCcw size={10} strokeWidth={1.5} style={{ marginRight: 2 }} />
              {t('rewind.reverted')}
            </span>
          )}
        </div>
      </div>
    <AnimatedCollapse
      open={hasDetails && isOpen}
      id={bodyId}
      animateHeight={false}
      keepMounted
      deferContentOnClose
      style={{
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {() => (
      <div>
        {hasErrorDetails ? (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-semibold uppercase"
                style={{ color: 'var(--red)', letterSpacing: '0.06em' }}
              >
                {t('toolCall.error')}
              </span>
            </div>
            <pre
              className="text-xs overflow-x-auto"
              style={{
                color: 'var(--red)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                lineHeight: 1.6,
                maxHeight: 400,
                overflowY: 'auto',
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              }}
            >
              {errorText}
            </pre>
          </div>
        ) : hasPreview ? (
          <div className="px-3 py-2">
          <pre
            className="text-xs overflow-x-auto"
            style={{
              margin: 0,
              lineHeight: 1.6,
              maxHeight: 400,
              overflowY: 'auto',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
          >
            {preview.rows.map((row, index) => {
              const isAdd = row.kind === 'add'
              const isRemove = row.kind === 'remove'
              const rowBg = isAdd
                ? 'rgba(63, 185, 80, 0.15)'
                : isRemove
                  ? 'rgba(248, 81, 73, 0.15)'
                  : 'transparent'
              const textColor = isError
                ? 'var(--red)'
                : isAdd
                  ? 'var(--green)'
                  : isRemove
                    ? 'var(--red)'
                    : 'var(--text-secondary)'
              const numColor = isAdd
                ? 'rgba(63, 185, 80, 0.75)'
                : isRemove
                  ? 'rgba(248, 81, 73, 0.75)'
                  : 'var(--text-dim)'
              const lineNumber = isRemove ? row.oldNum : (row.newNum ?? row.oldNum)
              return (
                <div
                  key={`diff-${index}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px minmax(0, 1fr)',
                    background: rowBg,
                  }}
                >
                  <span
                    style={{
                      color: numColor,
                      textAlign: 'right',
                      paddingRight: 10,
                      userSelect: 'none',
                      fontSize: 11,
                    }}
                  >
                    {lineNumber ?? ''}
                  </span>
                  <span
                    style={{
                      color: textColor,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {row.text}
                  </span>
                </div>
              )
            })}
            {preview.truncated && (
              <div style={{ color: 'var(--text-dim)', paddingLeft: 50 }}>...</div>
            )}
          </pre>
          </div>
        ) : null}
      </div>
      )}
    </AnimatedCollapse>
    </div>
  )
}

/**
 * Parse a user message that starts with /skill-name into { skillName, instruction }.
 * Returns null if the text doesn't match the slash command pattern or if the
 * skill name doesn't exactly match one of the available skills.
 */
function parseSkillCommand(text, availableSkills) {
  if (!text || !text.startsWith('/')) return null
  const match = text.match(/^\/([a-zA-Z0-9_-]+)\s+(.*)$/s)
  if (!match) {
    // No space after the name — the entire text could be just `/skillname`
    const exactMatch = text.match(/^\/([a-zA-Z0-9_-]+)$/)
    if (!exactMatch) return null
    const name = exactMatch[1]
    if (!availableSkills.some((s) => s.name === name)) return null
    return { skillName: name, instruction: '' }
  }
  const name = match[1]
  if (!availableSkills.some((s) => s.name === name)) return null
  return { skillName: name, instruction: match[2].trim() }
}

/**
 * Parse attached file paths from a user message.
 * Supports both formats:
 *   - XML: <uploaded-files>...- /path...</uploaded-files>
 *   - Code block: [Attached files ...]\n```\n/path\n```
 * Returns { cleanText, files: [{ name }] } or null if not found.
 */
function parseUploadedFiles(text) {
  if (!text) return null

  let inner = null
  let cleanText = text

  // Try code block format: [Attached files ...]\n```\n...\n```
  const codeMatch = text.match(/\[Attached files[^\]]*\]\s*\n```\n([\s\S]*?)\n```/)
  if (codeMatch) {
    inner = codeMatch[1]
    cleanText = text.replace(/\n?\n?\[Attached files[^\]]*\]\s*\n```\n[\s\S]*?\n```/, '').trim()
  } else {
    // Fallback: XML format (for old session history)
    const xmlMatch = text.match(/<uploaded-files>\s*([\s\S]*?)\s*<\/uploaded-files>/)
    if (xmlMatch) {
      inner = xmlMatch[1]
      cleanText = text.replace(/<uploaded-files>[\s\S]*?<\/uploaded-files>/, '').trim()
    }
  }

  if (!inner) return null

  const files = []
  const lines = inner.split('\n')
  for (const line of lines) {
    // Match "- original_name: /path" or "- /path" or bare "/path"
    const namedMatch = line.match(/^-\s+(.+?):\s*(\/\S+)\s*$/)
    if (namedMatch) {
      files.push({ name: namedMatch[1].trim(), path: namedMatch[2].trim() })
      continue
    }
    const pathMatch = line.match(/^-\s+`?(.+?)`?\s*$/) || line.match(/^(\/\S+)$/)
    if (pathMatch) {
      const fullPath = pathMatch[1].trim()
      const parts = fullPath.split('/')
      const name = parts[parts.length - 1] || fullPath
      files.push({ name, path: fullPath })
    }
  }
  return files.length > 0 ? { cleanText, files } : null
}

/**
 * Parse <file-reference>...</file-reference> from a user message.
 * Returns { filePath, startLine, endLine, language, selectedText, cleanText } or null.
 */
function parseFileReference(text) {
  if (!text) return null
  const match = text.match(/<file-reference\s+path="([^"]+)"\s+startLine="(\d+)"\s+endLine="(\d+)"\s+language="([^"]*)">([\s\S]*?)<\/file-reference>/)
  if (!match) return null
  const cleanText = text.replace(/<file-reference[\s\S]*?<\/file-reference>\s*/, '').trim()
  return { filePath: match[1], startLine: +match[2], endLine: +match[3], language: match[4], selectedText: match[5].trim(), cleanText }
}

/**
 * Parse <quote-content>...</quote-content> from a user message.
 * Returns { quotedText, cleanText } or null if not found.
 */
function parseQuoteContent(text) {
  if (!text) return null
  const match = text.match(/<quote-content>\s*([\s\S]*?)\s*<\/quote-content>/)
  if (!match) return null
  const inner = match[1]
  const quoteMatch = inner.match(/[`"']([^`"']+)[`"']/)
  const quotedText = quoteMatch ? quoteMatch[1] : inner.trim()
  const cleanText = text.replace(/<quote-content>[\s\S]*?<\/quote-content>\s*/, '').trim()
  return { quotedText, cleanText }
}

function hasUserReferenceMarkup(text) {
  return /<selected-file>|<selected-xlsx>|<file-reference|<uploaded-files>|\[Attached files/.test(text || '')
}

function isCollapsibleToolBlock(block) {
  if (block?.type === 'canvas_ref' || block?.type === 'file_ref') return true
  if (block?.type !== 'tool_use') return false
  // SubagentFrame and TodoWriteCard manage their own collapse UX — keep them
  // out of the outer tool-steps section so they render as top-level nodes.
  if (block.name === 'Agent' || block.name === 'Task') return false
  if (block.name === 'TodoWrite') return false
  return true
}

function isEmptyTextBlock(block) {
  return block?.type === 'text' && !block?.text?.trim()
}

function getToolSectionKey(run, startIndex) {
  const first = run[0]
  return `${first?.type || 'tool'}-${first?.id || first?.refType || startIndex}-${startIndex}`
}

export default memo(function MessageBubble({
  message,
  isStreaming: streamingProp,
  isLatestAssistantMessage = false,
  latestAssistantRefreshKey = 0,
  onSendAnswer,
  assistantIndex = null,
  onRewind = null,
  onFork = null,
  showCheckpointActions = false,
  revertedToolUseIds = null,
}) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const isStreaming = streamingProp || false

  // Extract content
  const contentBlocks = message.content || []
  const textBlocks = contentBlocks.filter((b) => b.type === 'text')
  const imageBlocks = contentBlocks.filter((b) => b.type === 'image')
  const toolBlocks = contentBlocks.filter((b) => b.type === 'tool_use')
  const canvasRefBlocks = contentBlocks.filter((b) => b.type === 'canvas_ref')
  const fileRefBlocks = contentBlocks.filter((b) => b.type === 'file_ref')
  const textContent = textBlocks.map((b) => b.text).join('\n').replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  const askUserBlocks = contentBlocks.filter((b) => b.type === 'ask_user')
  const hasContent = Boolean(textContent && textContent.trim())
  const hasTools = toolBlocks.length > 0 || canvasRefBlocks.length > 0 || fileRefBlocks.length > 0 || askUserBlocks.length > 0
  const hasThinkingContent = !isUser && contentHasThinking(contentBlocks)
  const hasUserReferenceContent = isUser && (
    contentBlocks.some((block) => block.type === 'text' && hasUserReferenceMarkup(block.text)) ||
    imageBlocks.length > 0 ||
    (message.attachments?.length || 0) > 0
  )
  // Synthetic / error assistant messages render as a structured ErrorBlock
  // instead of the regular markdown-text path.
  const isErrorMessage = !isUser && (message.is_synthetic === true || message.error === true)
  const hasCollapsibleToolSection = !isUser && contentBlocks.some(isCollapsibleToolBlock)
  const [collapsedToolSections, setCollapsedToolSections] = useState({})
  const [lightboxImage, setLightboxImage] = useState(null)

  const availableSkills = useChatStore((s) => s.availableSkills)
  const skillsLoaded = useChatStore((s) => s.skillsLoaded)
  const fetchAvailableSkills = useChatStore((s) => s.fetchAvailableSkills)
  const fileOps = useFileOpsStore((s) => s.fileOps)
  const latestTodoWriteId = useTaskStore((s) => s.todoWriteInfo?.tool_use_id || null)

  useEffect(() => {
    if (!isUser || skillsLoaded) return
    if (/(^|\n)\s*\/[a-zA-Z0-9_-]+(?:\s|$)/.test(textContent)) {
      fetchAvailableSkills()
    }
  }, [fetchAvailableSkills, isUser, skillsLoaded, textContent])

  // Selection tooltip for assistant messages (quote feedback)
  const [tooltip, setTooltip] = useState(null)
  const contentAreaRef = useRef(null)
  const tooltipSetAtRef = useRef(0)

  const hasMetadata = Boolean(message.duration || message.inputTokens != null || message.agentLoops != null)
  const shouldHideBubble = !isUser && !hasContent && !hasTools && !hasThinkingContent && !isStreaming && !hasMetadata

  useEffect(() => {
    if (isUser || shouldHideBubble) return
    const onMouseUp = (e) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const range = selection.getRangeAt(0)
      const ancestor = range.commonAncestorContainer
      if (!contentAreaRef.current || !contentAreaRef.current.contains(ancestor)) return
      // Don't trigger on tool cards, ask-user blocks, or message actions (token stats, etc.)
      const el = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement
      const closestToolCard = el?.closest?.('[data-tool-card]')
      if (closestToolCard) return
      const closestActions = el?.closest?.('[data-message-actions]')
      if (closestActions) return
      const text = selection.toString().trim()
      if (!text) return
      tooltipSetAtRef.current = Date.now()
      setTooltip({ x: e.clientX + 8, y: e.clientY + 8, selectedText: text })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [isUser, shouldHideBubble])

  useEffect(() => {
    if (isUser || shouldHideBubble) return
    const onSelectionChange = () => {
      if (Date.now() - tooltipSetAtRef.current < 150) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setTooltip(null)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [isUser, shouldHideBubble])

  const handleQuoteClick = useCallback(() => {
    if (!tooltip) return
    useChatStore.getState().setQuotedText(tooltip.selectedText)
    setTooltip(null)
    window.getSelection()?.removeAllRanges()
    // Focus the textarea
    setTimeout(() => {
      document.querySelector('.chat-textarea')?.focus()
    }, 0)
  }, [tooltip])

  useEffect(() => {
    if (!hasCollapsibleToolSection) {
      setCollapsedToolSections({})
      return
    }
    const nextSectionKeys = []
    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]
      if (!isCollapsibleToolBlock(block)) continue

      const run = [block]
      while (i + 1 < contentBlocks.length) {
        const nextBlock = contentBlocks[i + 1]
        if (isCollapsibleToolBlock(nextBlock)) {
          i += 1
          run.push(contentBlocks[i])
          continue
        }
        if (isEmptyTextBlock(nextBlock)) {
          i += 1
          continue
        }
        break
      }
      nextSectionKeys.push(getToolSectionKey(run, i - run.length + 1))
    }

    setCollapsedToolSections((prev) => {
      const next = {}
      nextSectionKeys.forEach((key) => {
        next[key] = Object.prototype.hasOwnProperty.call(prev, key)
          ? prev[key]
          : true
      })
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev
      }
      return next
    })
  }, [message.content, hasCollapsibleToolSection])

  const prevStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && hasCollapsibleToolSection) {
      setCollapsedToolSections((prev) => {
        const next = {}
        let changed = false
        Object.keys(prev).forEach((key) => {
          next[key] = true
          if (prev[key] !== true) changed = true
        })
        return changed ? next : prev
      })
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming, hasCollapsibleToolSection])

  // Keep hook order stable even when a stopped stream leaves an empty assistant placeholder behind.
  if (shouldHideBubble) return null

  const renderBlock = (block, i) => {
    if (block.type === 'ask_user') {
      // Active questions are shown in ChatInput instead; only render inline for answered/declined
      if (block.status === 'answered' || block.status === 'declined') {
        return (
          <AskUserQuestionCard
            key={block.id || i}
            block={block}
            onAnswer={onSendAnswer}
          />
        )
      }
      return null
    }
    if (block.type === 'tool_use') {
      const reverted = revertedToolUseIds?.has(block.id) || false
      if (block.name === 'Read') {
        return <FileToolCard key={block.id || i} kind="Read" block={block} reverted={reverted} />
      }
      // Subagents render as a collapsible framed node with nested children.
      if (block.name === 'Agent' || block.name === 'Task') {
        return <SubagentFrame key={block.id || i} block={block} reverted={reverted} />
      }
      // TodoWrite renders as a plan widget — latest is full, earlier collapse.
      if (block.name === 'TodoWrite') {
        const isLatest = latestTodoWriteId && latestTodoWriteId === block.id
        return (
          <TodoWriteCard
            key={block.id || i}
            block={block}
            mode={isLatest ? 'full' : 'collapsed'}
          />
        )
      }
      return <ToolCallCard key={block.id || i} block={block} reverted={reverted} />
    }
    if (block.type === 'canvas_ref') {
      return <CanvasRefIndicator key={block.id || i} count={block.count} refType={block.refType} />
    }
    if (block.type === 'file_ref') {
      const reverted = revertedToolUseIds?.has(block.fileOpId) || false
      return <FileOpRefIndicator key={block.id || i} block={block} reverted={reverted} />
    }
    if (block.type === 'thinking' && block.thinking?.trim()) {
      return (
        <ThinkingBlock
          key={block.id || i}
          content={block.thinking}
          t={t}
          streaming={isStreaming}
        />
      )
    }
    if (block.type === 'text' && block.text?.trim()) {
      if (isUser) {
        // Check for <uploaded-files> XML in text (from session history)
        const uploadedParsed = parseUploadedFiles(block.text)
        const displayText = uploadedParsed ? uploadedParsed.cleanText : block.text
        const parsedFiles = uploadedParsed ? uploadedParsed.files : null
        let remainingText = displayText
        const selectedXlsxParsed = parseSelectedXlsx(remainingText)
        if (selectedXlsxParsed) remainingText = selectedXlsxParsed.cleanText

        const selectedFileParsed = parseSelectedFile(remainingText)
        if (selectedFileParsed) remainingText = selectedFileParsed.cleanText

        const fileRefParsed = parseFileReference(remainingText)
        if (fileRefParsed) remainingText = fileRefParsed.cleanText

        const quoteParsed = parseQuoteContent(remainingText)
        if (quoteParsed) remainingText = quoteParsed.cleanText

        const parsed = parseSkillCommand(remainingText, availableSkills)
        const hasStructuredCards = Boolean(
          parsedFiles ||
          selectedXlsxParsed ||
          selectedFileParsed ||
          fileRefParsed ||
          quoteParsed
        )

        return (
          <div
            key={i}
            className="flex flex-col gap-2 min-w-0"
            style={{
              width: hasStructuredCards ? '100%' : undefined,
              maxWidth: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              alignItems: hasStructuredCards ? 'stretch' : undefined,
            }}
          >
            {parsedFiles && <AttachmentChips files={parsedFiles} />}
            {selectedXlsxParsed && (
              <SelectedXlsxCard
                filePath={selectedXlsxParsed.filePath}
                sheetName={selectedXlsxParsed.sheetName}
                range={selectedXlsxParsed.range}
                contentTsv={selectedXlsxParsed.contentTsv}
                collapsed
              />
            )}
            {selectedFileParsed && (
              <SelectedFileCard
                kind={selectedFileParsed.kind}
                filePath={selectedFileParsed.filePath}
                fileName={selectedFileParsed.fileName}
                locator={selectedFileParsed.locator}
                content={selectedFileParsed.content}
                collapsed
              />
            )}
            {fileRefParsed && (
              <FileReferenceCard
                filePath={fileRefParsed.filePath}
                startLine={fileRefParsed.startLine}
                endLine={fileRefParsed.endLine}
                selectedText={fileRefParsed.selectedText}
                language={fileRefParsed.language}
                collapsed
              />
            )}
            {quoteParsed && <QuoteBlock text={quoteParsed.quotedText} />}
            {parsed ? (
              <>
                <SkillCommandChip skillName={parsed.skillName} />
                {parsed.instruction && <MarkdownRenderer content={parsed.instruction} mermaidCollapsible />}
              </>
            ) : (
              remainingText && <MarkdownRenderer content={remainingText} mermaidCollapsible />
            )}
          </div>
        )
      }
      // Parse <think>...</think> tags from model output
      const thinkSegments = parseThinkTags(block.text)
      if (thinkSegments) {
        return (
          <div key={i} className="flex flex-col gap-2 min-w-0">
            {thinkSegments.map((seg, si) =>
              seg.type === 'thinking'
                ? <ThinkingBlock key={si} content={seg.content} t={t} />
                : <MarkdownRenderer key={si} content={seg.content} mermaidCollapsible />
            )}
          </div>
        )
      }
      return <MarkdownRenderer key={i} content={block.text} mermaidCollapsible />
    }
    return null
  }

  const renderedContent = []
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (isCollapsibleToolBlock(block)) {
      const runStartIndex = i
      const run = [block]
      while (i + 1 < contentBlocks.length) {
        const nextBlock = contentBlocks[i + 1]
        if (isCollapsibleToolBlock(nextBlock)) {
          i += 1
          run.push(contentBlocks[i])
          continue
        }
        if (isEmptyTextBlock(nextBlock)) {
          i += 1
          continue
        }
        break
      }
      const sectionKey = getToolSectionKey(run, runStartIndex)
      const isCollapsed = collapsedToolSections[sectionKey] ?? !isStreaming

      renderedContent.push(
        <ToolRunSection
          key={`tool-run-${sectionKey}`}
          collapsed={isCollapsed}
          onToggle={() => setCollapsedToolSections((prev) => ({
            ...prev,
            [sectionKey]: !(prev[sectionKey] ?? !isStreaming),
          }))}
          run={run}
          fileOps={fileOps}
          t={t}
          renderBlock={(toolBlock, runIndex) => renderBlock(toolBlock, runStartIndex + runIndex)}
          getChildKey={(toolBlock, runIndex) => `tree-child-${toolBlock.id || runStartIndex + runIndex}`}
        />
      )
      continue
    }

    const rendered = renderBlock(block, i)
    if (rendered) renderedContent.push(rendered)
  }

  const messageHeader = (
    <div className="flex items-center gap-2" style={{ alignSelf: isUser ? 'flex-end' : undefined }}>
      <Chip color={isUser ? 'var(--blue)' : 'var(--purple)'}>
        {isUser ? 'You' : 'vivian'}
      </Chip>

      {/* Duration — live timer while streaming, final duration when done */}
      {!isUser && isStreaming && message.timestamp && (
        <LiveTimer startTime={message.timestamp} />
      )}

      {/* Streaming indicator */}
      {isStreaming && !isUser && (
        <div
          className="inline-flex items-center gap-1"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 3,
            color: 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '16px',
            padding: '2px 6px',
          }}
        >
          <span className="thinking-shimmer">{t('chat.thinking')}</span>
        </div>
      )}

      {/* Error indicator */}
      {message.error && (
        <Chip color="var(--red)">ERROR</Chip>
      )}
    </div>
  )

  const messageBody = (
    <>
        {/* Image thumbnails in user messages */}
        {isUser && imageBlocks.length > 0 && (
          <div className="flex flex-wrap gap-2 py-1">
            {imageBlocks.map((img, i) => {
              // Render from the content block's own source — previewUrl blob
              // URLs are revoked once the attachment leaves the composer.
              if (!img.source) return null
              const src = `data:${img.source.media_type};base64,${img.source.data}`
              return (
                <button
                  key={i}
                  onClick={() => setLightboxImage({ src, alt: img.filename || `Image ${i + 1}` })}
                  style={{
                    width: 80, height: 80, padding: 0, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    cursor: 'pointer', overflow: 'hidden',
                  }}
                >
                  <img src={src} alt={img.filename || `Image ${i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              )
            })}
          </div>
        )}

        {/* User message attachment chips (from current session metadata) */}
        {isUser && message.attachments?.length > 0 && (
          <AttachmentChips files={message.attachments.filter((a) => !a.isImage)} />
        )}

        {/* Lightbox overlay */}
        {lightboxImage && (
          <ImageLightbox
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            onClose={() => setLightboxImage(null)}
          />
        )}

        {/* Error / synthetic messages render as a structured ErrorBlock */}
        {isErrorMessage && <ErrorBlock message={message} />}

        {/* Content blocks — render in order for continuity */}
        {!isErrorMessage && renderedContent}
        {/* Empty response fallback */}
        {!isUser && !isStreaming && !hasContent && !hasTools && hasMetadata && !isErrorMessage && (
          <span className="text-xs" style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
            {t('chat.emptyResponse')}
          </span>
        )}

        {/* Retry indicator — shown inside the streaming assistant slot when
            backend is auto-retrying. Auto-hides when retryState is null. */}
        {isStreaming && !isUser && <RetryIndicator />}

        {/* Skeleton shown throughout streaming, hidden when retry indicator
            replaces it (RetryIndicator manages that itself). */}
        {isStreaming && !isUser && !isErrorMessage && (
          <StreamingSkeleton />
        )}

        {/* Action bar — copy on every message, plus rewind/fork/stats for assistant */}
        {!isStreaming && (hasContent || hasMetadata) && (
          <MessageActions
            textContent={textContent}
            message={message}
            assistantIndex={assistantIndex}
            onRewind={onRewind}
            onFork={onFork}
            showCheckpointActions={showCheckpointActions}
            streamingDisabled={streamingProp}
          />
        )}
    </>
  )

  return (
    <div
      className="flex px-4 py-2 overflow-hidden"
      style={{
        background: 'transparent',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {/* Content */}
      <div
        ref={contentAreaRef}
        className={isUser ? 'min-w-0 overflow-hidden' : 'flex-1 min-w-0 overflow-hidden'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: isUser ? 4 : 6,
          alignItems: isUser ? 'flex-end' : 'stretch',
          width: hasUserReferenceContent ? 'min(720px, 80%)' : undefined,
          maxWidth: isUser ? 'min(720px, 80%)' : undefined,
        }}
      >
        {isUser ? (
          <>
            {messageHeader}
            <div
              className="min-w-0 overflow-hidden"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                alignItems: hasUserReferenceContent ? 'stretch' : 'flex-end',
                width: hasUserReferenceContent ? '100%' : undefined,
                maxWidth: '100%',
                boxSizing: 'border-box',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '8px 12px',
                background: 'var(--bg-elevated)',
              }}
            >
              {messageBody}
            </div>
          </>
        ) : (
          <>
            {messageHeader}
            {messageBody}
          </>
        )}
      </div>

      {/* Selection tooltip for quoting assistant text */}
      {!isUser && tooltip && createPortal(
        <button
          className="flex items-center gap-1"
          onClick={handleQuoteClick}
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
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
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)'
            e.currentTarget.style.borderColor = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <CornerDownLeft size={14} strokeWidth={1.5} />
          {t('quote.provideFeedback')}
        </button>,
        document.body
      )}
    </div>
  )
})

function StreamingSkeleton() {
  // Hide the skeleton while the backend is auto-retrying — the
  // RetryIndicator already conveys the active state.
  const retryState = useChatStore((s) => s.retryState)
  if (retryState) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="skeleton" style={{ width: '80%', height: 16, borderRadius: '4px' }} />
      <div className="skeleton" style={{ width: '55%', height: 16, borderRadius: '4px' }} />
      <div className="skeleton" style={{ width: '70%', height: 16, borderRadius: '4px' }} />
      <div className="skeleton" style={{ width: '45%', height: 16, borderRadius: '4px' }} />
    </div>
  )
}

function LiveTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(Date.now() - startTime)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 100)
    return () => clearInterval(id)
  }, [startTime])
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dim)' }}>
      <Timer size={12} strokeWidth={1.5} />
      {formatDuration(elapsed)}
    </span>
  )
}

function CanvasRefIndicator({ count }) {
  // File ops are rendered inline as individual FileOpRefIndicator rows.
  // This indicator now only summarizes hidden non-file tools (Agent, Task, etc.)
  // and points at the Tasks tab.
  const { t } = useTranslation()
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const label = t('chat.toolsRunningInCanvas', { count })
  return (
    <button
      className="flex items-center gap-2 px-3 py-1 text-xs"
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderLeft: '2px solid var(--purple)',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition: 'background 150ms ease',
      }}
      onClick={() => {
        showCanvas()
        setActiveCanvasTab('tasks')
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <PanelRight size={12} strokeWidth={1.5} style={{ color: 'var(--purple)' }} />
      <span>{label}</span>
    </button>
  )
}

function FileOpRefIndicator({ block, reverted = false }) {
  const op = useFileOpsStore((s) => s.fileOps.find((item) => item.id === block.fileOpId) || null)
  const displayName = getToolDisplayName(block.name)
  return (
    <FileToolCard
      kind={displayName === 'FileCanvas' ? 'FILECANVAS' : displayName}
      op={op}
      block={block}
      reverted={reverted}
    />
  )
}

function MessageActions({ textContent, message, assistantIndex, onRewind, onFork, showCheckpointActions, streamingDisabled }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const messageTimestamp = formatMessageTimestamp(message.timestamp)
  const messageTimestampTitle = message.timestamp
    ? formatDateTime(message.timestamp)
    : undefined
  const iconBtnStyle = (disabled) => ({
    background: 'transparent',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    padding: 4,
    borderRadius: '4px',
    color: 'var(--text-dim)',
    transition: 'color 150ms ease',
  })
  return (
    <div
      data-message-actions
      className="flex items-center gap-3 text-xs"
      style={{
        marginTop: isUser ? -2 : 4,
        color: 'var(--text-dim)',
        alignSelf: isUser ? 'flex-end' : undefined,
        lineHeight: '16px',
      }}
    >
      <button
        onClick={async () => {
          const didCopy = await copyTextToClipboard(textContent)
          if (!didCopy) return
          setCopied(true)
          setTimeout(() => setCopied(false), 800)
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: isUser ? 0 : 4,
          borderRadius: '4px',
          color: copied ? 'var(--green)' : 'var(--text-dim)',
          transition: 'color 150ms ease, background 150ms ease',
        }}
        onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-dim)' }}
        title={t('chat.copyMessage')}
      >
        {copied
          ? <Check size={14} strokeWidth={1.5} />
          : <Copy size={14} strokeWidth={1.5} />}
      </button>
      {messageTimestamp && (
        <span className="flex items-center gap-1 whitespace-nowrap" title={messageTimestampTitle}>
          <Clock size={10} strokeWidth={1.5} />
          {messageTimestamp}
        </span>
      )}
      {showCheckpointActions && message.role === 'assistant' && onRewind && (
        <button
          type="button"
          title={t('chat.rewindTooltip')}
          disabled={streamingDisabled}
          onClick={() => { if (!streamingDisabled) onRewind(assistantIndex) }}
          onMouseEnter={(e) => { if (!streamingDisabled) e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          style={iconBtnStyle(streamingDisabled)}
        >
          <RotateCcw size={14} strokeWidth={1.5} />
        </button>
      )}
      {showCheckpointActions && message.role === 'assistant' && onFork && (
        <button
          type="button"
          title={t('chat.forkTooltip')}
          disabled={streamingDisabled}
          onClick={() => { if (!streamingDisabled) onFork(assistantIndex) }}
          onMouseEnter={(e) => { if (!streamingDisabled) e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          style={iconBtnStyle(streamingDisabled)}
        >
          <GitBranch size={14} strokeWidth={1.5} />
        </button>
      )}
      {message.inputTokens != null && (
        <span className="flex items-center gap-1">
          <ArrowDownToLine size={10} strokeWidth={1.5} />
          {message.inputTokens.toLocaleString()}
        </span>
      )}
      {message.outputTokens != null && (
        <span className="flex items-center gap-1">
          <ArrowUpFromLine size={10} strokeWidth={1.5} />
          {message.outputTokens.toLocaleString()}
        </span>
      )}
      {message.agentLoops != null && (
        <span className="flex items-center gap-1">
          <Repeat size={10} strokeWidth={1.5} />
          {t('chat.loops', { count: message.agentLoops })}
        </span>
      )}
      {message.duration && (
        <span className="flex items-center gap-1">
          <Timer size={10} strokeWidth={1.5} />
          {formatDuration(message.duration)}
        </span>
      )}
    </div>
  )
}

function AttachmentChips({ files }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {files.map((file, i) => (
        <div
          key={i}
          className="inline-flex items-center gap-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            borderLeft: '2px solid var(--cyan)',
            borderRadius: 2,
          }}
        >
          <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          <span
            className="truncate"
            title={file.name}
            style={{
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              maxWidth: 130,
            }}
          >
            {file.name}
          </span>
          {file.size != null && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              {file.size < 1024 ? `${file.size}B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${(file.size / (1024 * 1024)).toFixed(1)}MB`}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function QuoteBlock({ text }) {
  const { t } = useTranslation()
  return (
    <div style={{
      borderLeft: '2px solid var(--blue)',
      background: 'var(--bg-elevated)',
      borderRadius: 2,
      padding: '6px 10px',
    }}>
      <div className="uppercase" style={{
        fontSize: 11,
        letterSpacing: '0.06em',
        color: 'var(--text-dim)',
        fontWeight: 600,
        marginBottom: 2,
      }}>
        {t('quote.quoted')}
      </div>
      <div style={{
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        wordBreak: 'break-word',
      }}>
        &ldquo;{text}&rdquo;
      </div>
    </div>
  )
}

function SkillCommandChip({ skillName }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="inline-flex items-center gap-2 px-2 py-1"
        style={{
          background: 'var(--bg-elevated)',
          borderLeft: '2px solid var(--purple)',
          borderRadius: 2,
        }}
      >
        <ScrollText size={12} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0 }} />
        <span
          style={{
            color: 'var(--text-dim)',
            fontWeight: 400,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
        >
          skill:
        </span>
        <span
          style={{
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
        >
          {skillName}
        </span>
      </div>
    </div>
  )
}
