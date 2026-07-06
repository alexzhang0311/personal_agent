import { useEffect, useId, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  FilePen,
  FileText,
  Loader,
  RotateCcw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { copyTextToClipboard } from '../../utils/clipboard'
import { RollingInteger } from '../shared/Odometer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

function formatDuration(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
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
          rows.push({ kind: 'add', oldNum: null, newNum: newLine, text: line })
          newLine += 1
        } else if (prefix === '-') {
          rows.push({ kind: 'remove', oldNum: oldLine, newNum: null, text: line })
          oldLine += 1
        } else {
          rows.push({ kind: 'context', oldNum: oldLine, newNum: newLine, text: line || ' ' })
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
      rows.push({ kind: 'remove', oldNum: oldStartLine + index, newNum: null, text: `-${line}` })
    })
    limitedNew.forEach((line, index) => {
      rows.push({ kind: 'add', oldNum: null, newNum: oldStartLine + index, text: `+${line}` })
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

function PathCopyButton({ path, compact = false }) {
  const [copied, setCopied] = useState(false)
  if (!path) return null
  const size = compact ? 16 : 18
  const iconSize = compact ? 10 : 11
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
        width: size,
        height: size,
        border: 'none',
        background: 'transparent',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        cursor: 'pointer',
        padding: 0,
        transition: 'color 150ms ease',
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={iconSize} strokeWidth={1.5} /> : <Copy size={iconSize} strokeWidth={1.5} />}
    </button>
  )
}

function makeOpLike(op, block) {
  if (op) return op
  const toolUseResult = block?.result?.tool_use_result || block?.result?.toolUseResult || null
  return {
    id: block?.id,
    type: block?.name?.toLowerCase(),
    filePath: block?.filePath || block?.input?.file_path || '',
    status: block?.status,
    input: block?.input,
    content: block?.input?.content || toolUseResult?.content || toolUseResult?.new_content || null,
    originalFile: toolUseResult?.original_file || toolUseResult?.originalFile || null,
    structuredPatch: toolUseResult?.structured_patch || toolUseResult?.structuredPatch || null,
    resultContent: typeof block?.result?.content === 'string' ? block.result.content : null,
    toolUseResult,
  }
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

function getToolErrorText(opLike, block) {
  const candidates = [
    opLike?.resultContent,
    block?.result?.content,
    opLike?.toolUseResult?.error,
    opLike?.toolUseResult?.message,
    typeof opLike?.toolUseResult === 'string' ? opLike.toolUseResult : null,
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

function DeltaStat({ sign, value, color, fontSize }) {
  const resolvedFontSize = fontSize || 12
  const height = resolvedFontSize <= 11 ? 18 : 20
  return (
    <span
      style={{
        color,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        fontSize: resolvedFontSize,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        height,
        lineHeight: `${height}px`,
        verticalAlign: 'middle',
      }}
    >
      <span>{sign}</span>
      <RollingInteger value={value} height={fontSize || 12} color="currentColor" />
    </span>
  )
}

export default function FileToolCard({ kind, block = null, op = null, reverted = false, compact = false }) {
  const { t } = useTranslation()
  const bodyId = useId()
  const [hovered, setHovered] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const setSelectedFileOpId = useFileOpsStore((s) => s.setSelectedFileOpId)
  const openFile = useFileBrowserStore((s) => s.openFile)

  const opLike = makeOpLike(op, block)
  const resolvedPath = opLike?.filePath || block?.filePath || block?.input?.file_path || ''
  const fileName = fileNameFromPath(resolvedPath)
  const normalizedKind = kind || opLike?.type || block?.name || 'file'
  const displayKind = normalizedKind === 'generated'
    ? 'FILECANVAS'
    : normalizedKind.charAt(0).toUpperCase() + normalizedKind.slice(1)
  const isRead = displayKind === 'Read'
  const isWrite = displayKind === 'Write'
  const isEdit = displayKind === 'Edit'
  const status = opLike?.status || block?.status || 'success'
  const isError = status === 'error' || block?.result?.is_error
  const statusTone = isError ? 'error' : status === 'running' ? 'running' : 'success'
  const errorText = isError ? getToolErrorText(opLike, block) : ''
  const errorSummary = errorText ? getErrorSummary(errorText) : ''
  const hasErrorDetails = Boolean(errorText)
  const statusColor = statusTone === 'error' ? 'var(--red)' : statusTone === 'running' ? 'var(--purple)' : 'var(--green)'
  const accent = isRead ? 'var(--text-dim)' : isWrite ? 'var(--cyan)' : isEdit ? 'var(--yellow)' : 'var(--green)'
  const Icon = isEdit ? FilePen : FileText
  const editStats = isEdit ? getCompactEditStats(opLike) : null
  const writeLines = isWrite ? countContentLines(opLike?.content || opLike?.input?.content) : 0
  const showChangeStats = statusTone === 'success'
  const preview = isEdit ? buildCompactEditRows(opLike, compact ? 10 : 18) : isWrite ? buildCompactWriteRows(opLike, compact ? 10 : 18) : null
  const hasPreview = Boolean(preview?.rows?.length)
  const hasDetails = hasErrorDetails || hasPreview
  const meta = isRead ? getReadMeta(block) : null
  const duration = block?.duration ? formatDuration(block.duration) : null

  useEffect(() => {
    if (isError) setIsOpen(true)
  }, [isError])

  const iconSize = compact ? 11 : 12
  const chevronSize = compact ? 10 : 12
  const textSize = compact ? 11 : 12
  const metaSize = compact ? 10 : 11
  const actionSize = compact ? 18 : 20
  const chipStyle = {
    height: actionSize,
    padding: compact ? '0 5px' : '0 6px',
    fontSize: compact ? 10 : 11,
    lineHeight: `${actionSize - 2}px`,
    display: 'inline-flex',
    alignItems: 'center',
  }

  const openInFileBrowser = () => {
    if (!resolvedPath) return
    openFile({
      filePath: resolvedPath,
      name: fileName,
      mimeType: opLike?.mimeType,
      extension: opLike?.extension,
      size: opLike?.size,
      source: displayKind,
    })
    showCanvas()
    setActiveCanvasTab('file-browser')
  }

  const openInChangeReview = () => {
    if (!opLike?.id || !op) {
      openInFileBrowser()
      return
    }
    showCanvas()
    setActiveCanvasTab('changes')
    setSelectedFileOpId(opLike.id)
  }

  const openExternal = isWrite || isEdit ? openInChangeReview : openInFileBrowser

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
          borderLeft: `${compact ? 2 : 3}px solid ${statusColor}`,
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
            columnGap: compact ? 4 : 6,
            background: hovered ? 'var(--bg-surface)' : 'transparent',
            minWidth: 0,
            overflow: 'hidden',
            padding: compact ? '3px 5px' : '4px 6px',
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
                <ChevronDown size={chevronSize} strokeWidth={1.5} />
              </AnimatedChevron>
            ) : (
              <span style={{ width: chevronSize, height: chevronSize, flexShrink: 0 }} />
            )}
            <Icon size={iconSize} strokeWidth={1.5} style={{ color: accent, flexShrink: 0 }} />
            <span
              className="font-semibold"
              style={{
                color: 'var(--text-primary)',
                fontSize: textSize,
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
                fontSize: textSize,
                fontFamily: 'JetBrains Mono, monospace',
                flex: '0 1 auto',
                maxWidth: compact ? 150 : 180,
                minWidth: 0,
                padding: 0,
                textDecoration: hovered ? 'underline' : 'none',
              }}
              aria-label={resolvedPath ? `Open ${resolvedPath} in file browser` : 'Open file in file browser'}
            >
              {fileName}
            </button>
            <PathCopyButton path={resolvedPath} compact={compact} />
            {errorSummary && (
              <span
                className="truncate"
                title={errorText}
                style={{
                  color: 'var(--red)',
                  fontSize: textSize,
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
                <Clock size={compact ? 9 : 10} strokeWidth={1.5} />
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
              gap: compact ? 4 : 8,
              alignItems: 'center',
              minHeight: actionSize,
              lineHeight: 1,
            }}
          >
            {meta && (
              <span
                className="text-xs"
                style={{ color: 'var(--text-dim)', flexShrink: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: metaSize, whiteSpace: 'nowrap' }}
              >
                · {meta}
              </span>
            )}
            {showChangeStats && isWrite && writeLines > 0 && (
              <DeltaStat sign="+" value={writeLines} color="var(--green)" fontSize={textSize} />
            )}
            {showChangeStats && isEdit && editStats && (editStats.added > 0 || editStats.removed > 0) && (
              <>
                <DeltaStat sign="+" value={editStats.added} color="var(--green)" fontSize={textSize} />
                <DeltaStat sign="-" value={editStats.removed} color="var(--red)" fontSize={textSize} />
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
                width: actionSize,
                height: actionSize,
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
              <ExternalLink size={compact ? 10 : 12} strokeWidth={1.5} />
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
                  ...chipStyle,
                }}
              >
                <AlertTriangle size={compact ? 9 : 10} strokeWidth={1.5} style={{ marginRight: 2 }} /> {t('toolCall.error')}
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
                  ...chipStyle,
                }}
              >
                <Loader size={compact ? 9 : 10} strokeWidth={1.5} className="icon-running" style={{ marginRight: 2 }} />
                <span className="thinking-shimmer" style={{ fontSize: compact ? 10 : 11 }}>{t('toolCall.running')}</span>
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
                  ...chipStyle,
                }}
              >
                <Check size={compact ? 9 : 10} strokeWidth={1.5} style={{ marginRight: 2 }} /> {t('toolCall.success')}
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
                  ...chipStyle,
                }}
              >
                <RotateCcw size={compact ? 9 : 10} strokeWidth={1.5} style={{ marginRight: 2 }} />
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
        <div
          className="overflow-hidden"
        >
          {hasErrorDetails ? (
            <div style={{ padding: compact ? '5px 8px' : '8px 12px' }}>
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
                  lineHeight: compact ? 1.45 : 1.6,
                  maxHeight: compact ? 240 : 400,
                  overflowY: 'auto',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                }}
              >
                {errorText}
              </pre>
            </div>
          ) : hasPreview ? (
            <div style={{ padding: compact ? '5px 8px' : '8px 12px' }}>
            <pre
              className="text-xs overflow-x-auto"
              style={{
                margin: 0,
                lineHeight: compact ? 1.45 : 1.6,
                maxHeight: compact ? 240 : 400,
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
                      gridTemplateColumns: `${compact ? 32 : 40}px minmax(0, 1fr)`,
                      background: rowBg,
                    }}
                  >
                    <span
                      style={{
                        color: numColor,
                        textAlign: 'right',
                        paddingRight: compact ? 8 : 10,
                        userSelect: 'none',
                        fontSize: compact ? 10 : 11,
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
                <div style={{ color: 'var(--text-dim)', paddingLeft: compact ? 40 : 50 }}>...</div>
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
