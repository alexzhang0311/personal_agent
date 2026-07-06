import { useState, useMemo, useCallback, useId, useRef } from 'react'
import { FileText, FilePen, Check, X, Loader, Copy, ChevronDown, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useFileOpsStore from '../../stores/fileOpsStore'
import useChatStore from '../../stores/chatStore'
import { copyTextToClipboard } from '../../utils/clipboard'
import { downloadFile } from '../../api/userFiles'
import RichFilePreview from '../shared/RichFilePreview'
import { RollingInteger } from '../shared/Odometer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import safeStorage from '../../utils/safeStorage'

const STORAGE_KEY_SPLIT = 'fileops-split-width'

function getStoredSplitPct() {
  return safeStorage.getNumber(STORAGE_KEY_SPLIT, 40, { min: 15, max: 70 })
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
      }}
    >
      {copied
        ? <Check size={12} strokeWidth={1.5} />
        : <Copy size={12} strokeWidth={1.5} />}
    </span>
  )
}

function StatusIcon({ status }) {
  if (status === 'running') {
    return <Loader size={12} strokeWidth={1.5} className="icon-running" style={{ color: 'var(--purple)' }} />
  }
  if (status === 'error') {
    return <X size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
  }
  return <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
}

function getFileOpMeta(op) {
  if (op.type === 'write') {
    return {
      Icon: FileText,
      color: 'var(--cyan)',
      label: 'WRITE',
    }
  }

  if (op.type === 'generated') {
    return {
      Icon: FileText,
      color: 'var(--green)',
      label: 'FILECANVAS',
    }
  }

  return {
    Icon: FilePen,
    color: 'var(--orange)',
    label: 'EDIT',
  }
}

function TypeIcon({ op }) {
  const { Icon, color } = getFileOpMeta(op)
  return <Icon size={14} strokeWidth={1.5} style={{ color }} />
}

function fileName(filePath) {
  if (!filePath) return ''
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}

function FileOpItem({ op, selected, onClick, reverted = false }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const { color, label } = getFileOpMeta(op)
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        cursor: 'pointer',
        background: selected ? 'var(--bg-elevated)' : hovered ? 'rgba(33, 38, 45, 0.5)' : 'transparent',
        borderLeft: selected ? '2px solid var(--blue)' : '2px solid transparent',
        opacity: reverted ? 0.55 : 1,
        transition: 'background 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TypeIcon op={op} />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1 min-w-0">
          <span
            className="text-xs font-semibold uppercase flex-shrink-0"
            style={{
              color,
              letterSpacing: '0.06em',
            }}
          >
            {label}
          </span>
          <StatusIcon status={op.status} />
          {reverted && (
            <span
              className="uppercase flex-shrink-0"
              style={{
                color: 'var(--text-dim)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                padding: '0 4px',
                lineHeight: 1.4,
              }}
              title={t('rewind.revertedTitle')}
            >
              {t('rewind.rev')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 min-w-0">
          <div className="file-path-marquee min-w-0 overflow-hidden" style={{ maxWidth: '100%' }}>
            <span
              className="text-xs whitespace-nowrap"
              style={{
                color: 'var(--text-secondary)',
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                display: 'inline-block',
              }}
              title={op.filePath}
            >
              {fileName(op.filePath)}
            </span>
          </div>
          <InlineCopyButton content={op.filePath} />
        </div>
      </div>
    </div>
  )
}

function TurnGroup({ turnIndex, ops, selectedFileOpId, onSelect, defaultOpen, revertedSet }) {
  const { t } = useTranslation()
  const bodyId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const [hovered, setHovered] = useState(false)
  const operationCount = ops.length
  const allDone = ops.every((op) => op.status === 'success' || op.status === 'error')
  const hasError = ops.some((op) => op.status === 'error')

  return (
    <div>
      {/* Turn header */}
      <button
        className="flex items-center gap-2 w-full px-3 py-1"
        style={{
          background: hovered ? 'rgba(33, 38, 45, 0.5)' : 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 150ms ease',
        }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <AnimatedChevron open={open} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('fileOps.turn', { num: turnIndex + 1 })}
        </span>
        <span
          className="text-xs"
          style={{
            color: 'var(--text-dim)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            lineHeight: '12px',
          }}
        >
          <span>(</span>
          <RollingInteger value={operationCount} height={11} color="currentColor" fontSize={11} fontWeight={400} verticalAlign="middle" />
          <span>{operationCount > 1 ? t('fileOps.operations') : t('fileOps.operation')}</span>
          <span>)</span>
        </span>
        {/* Status indicator */}
        {allDone && !hasError && (
          <Check size={10} strokeWidth={1.5} style={{ color: 'var(--green)', flexShrink: 0 }} />
        )}
        {hasError && (
          <X size={10} strokeWidth={1.5} style={{ color: 'var(--red)', flexShrink: 0 }} />
        )}
        {!allDone && (
          <Loader size={10} strokeWidth={1.5} className="icon-running" style={{ color: 'var(--purple)', flexShrink: 0 }} />
        )}
      </button>

      {/* Expanded file list */}
      <AnimatedCollapse open={open} id={bodyId}>
        {ops.map((op) => (
          <FileOpItem
            key={op.id}
            op={op}
            selected={op.id === selectedFileOpId}
            onClick={() => onSelect(op.id)}
            reverted={revertedSet?.has(op.id) || false}
          />
        ))}
      </AnimatedCollapse>
    </div>
  )
}

/* ── Line number gutter for diff lines ── */

const LINE_NUM_STYLE = {
  color: 'var(--text-dim)',
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  userSelect: 'none',
  minWidth: 32,
  textAlign: 'right',
  paddingRight: 6,
  flexShrink: 0,
  fontSize: 11,
}

function DiffLine({ oldNum, newNum, line, lineStyle }) {
  return (
    <div className="flex text-xs" style={{ ...lineStyle, lineHeight: 1.6 }}>
      <span style={LINE_NUM_STYLE}>{oldNum ?? ''}</span>
      <span style={LINE_NUM_STYLE}>{newNum ?? ''}</span>
      <span
        className="px-2 flex-1"
        style={{
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          whiteSpace: 'pre',
        }}
      >
        {line}
      </span>
    </div>
  )
}

function DiffView({ op }) {
  const patch = op.structuredPatch
  if (patch && Array.isArray(patch.hunks)) {
    return (
      <div className="overflow-y-auto" style={{ flex: 1 }}>
        {patch.hunks.map((hunk, hi) => {
          let oldLine = hunk.oldStart
          let newLine = hunk.newStart
          return (
            <div key={hi}>
              <div
                className="px-3 py-1 text-xs"
                style={{
                  color: 'var(--cyan)',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  background: 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunk.lines.map((line, li) => {
                const prefix = line[0]
                let lineStyle = { color: 'var(--text-secondary)', background: 'transparent' }
                let oNum = null
                let nNum = null
                if (prefix === '+') {
                  lineStyle = { color: 'var(--green)', background: 'rgba(63,185,80,0.1)' }
                  nNum = newLine++
                } else if (prefix === '-') {
                  lineStyle = { color: 'var(--red)', background: 'rgba(248,81,73,0.1)' }
                  oNum = oldLine++
                } else {
                  oNum = oldLine++
                  nNum = newLine++
                }
                return (
                  <DiffLine key={li} oldNum={oNum} newNum={nNum} line={line} lineStyle={lineStyle} />
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  // Fallback: show old_string → new_string from input with actual line numbers
  if (op.input?.old_string != null && op.input?.new_string != null) {
    const oldLines = op.input.old_string.split('\n')
    const newLines = op.input.new_string.split('\n')

    // Find the actual starting line in the original file
    let oldStartLine = 1
    const origFile = op.originalFile
      || op.toolUseResult?.original_file
      || op.toolUseResult?.originalFile
      || op.resultContent
    if (origFile && typeof origFile === 'string') {
      const idx = origFile.indexOf(op.input.old_string)
      if (idx >= 0) {
        oldStartLine = origFile.substring(0, idx).split('\n').length
      }
    }
    // new_string replaces old_string at the same position
    const newStartLine = oldStartLine

    return (
      <div className="overflow-y-auto" style={{ flex: 1 }}>
        {oldLines.map((line, i) => (
          <DiffLine
            key={`old-${i}`}
            oldNum={oldStartLine + i}
            newNum={null}
            line={`-${line}`}
            lineStyle={{ color: 'var(--red)', background: 'rgba(248,81,73,0.1)' }}
          />
        ))}
        {newLines.map((line, i) => (
          <DiffLine
            key={`new-${i}`}
            oldNum={null}
            newNum={newStartLine + i}
            line={`+${line}`}
            lineStyle={{ color: 'var(--green)', background: 'rgba(63,185,80,0.1)' }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="px-3 py-4 text-xs" style={{ color: 'var(--text-dim)' }}>
      {/* i18n handled at component level */}
      No diff data available
    </div>
  )
}

function CodeView({ content }) {
  if (!content) {
    return (
      <div className="px-3 py-4 text-xs" style={{ color: 'var(--text-dim)' }}>
        No content available
      </div>
    )
  }
  const lines = content.split('\n')
  return (
    <div className="overflow-y-auto" style={{ flex: 1 }}>
      {lines.map((line, i) => (
        <div key={i} className="flex text-xs" style={{ lineHeight: 1.6 }}>
          <span
            className="text-xs flex-shrink-0 px-2"
            style={{
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              userSelect: 'none',
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {i + 1}
          </span>
          <span
            className="px-2"
            style={{
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              whiteSpace: 'pre',
            }}
          >
            {line}
          </span>
        </div>
      ))}
    </div>
  )
}

function WorkspaceFilePreview({ op }) {
  const fallbackText = op.type === 'write'
    ? (op.content || op.input?.content || '')
    : null
  const previewVersion = op.endTime || op.startTime || op.toolUseId || op.id

  const previewFile = useMemo(() => {
    const parts = (op.filePath || '').split('/')
    const name = parts[parts.length - 1] || op.filePath || '(untitled)'
    const dotIndex = name.lastIndexOf('.')
    return {
      name,
      path: op.filePath,
      ext: dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '',
      mime_type: op.mimeType || null,
    }
  }, [op.filePath, op.mimeType])

  const loadBlob = useCallback(
    async () => downloadFile(op.filePath, { cacheBustKey: previewVersion, cacheMode: 'no-store' }),
    [op.filePath, previewVersion]
  )

  const loadText = useCallback(async () => {
    const blob = await downloadFile(op.filePath, { cacheBustKey: previewVersion, cacheMode: 'no-store' })
    return blob.text()
  }, [op.filePath, previewVersion])

  const loadArrayBuffer = useCallback(async () => {
    const blob = await downloadFile(op.filePath, { cacheBustKey: previewVersion, cacheMode: 'no-store' })
    return blob.arrayBuffer()
  }, [op.filePath, previewVersion])

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <RichFilePreview
        file={previewFile}
        cacheKey={`${op.id}:${op.status}:${op.filePath}:${op.mimeType || ''}:${previewVersion}`}
        loadText={loadText}
        loadArrayBuffer={loadArrayBuffer}
        loadBlob={loadBlob}
        fallbackText={fallbackText}
      />
    </div>
  )
}

function PreviewPanel({ op }) {
  const { t } = useTranslation()
  if (!op) {
    return (
      <div className="flex items-center justify-center flex-1" style={{ color: 'var(--text-dim)' }}>
        <span className="text-xs">{t('fileOps.selectPreview')}</span>
      </div>
    )
  }

  const fullContent = op.type === 'write'
    ? (op.content || op.input?.content || '')
    : null
  const { color, label } = getFileOpMeta(op)

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Preview header */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="text-xs truncate flex-1"
          style={{
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
          title={op.filePath}
        >
          {op.filePath}
        </span>
        <span
          className="text-xs font-semibold uppercase flex-shrink-0 px-1"
          style={{
            color,
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
        {fullContent && <InlineCopyButton content={fullContent} />}
      </div>

      {/* Content */}
      {op.type === 'edit' ? (
        <DiffView op={op} />
      ) : (
        <WorkspaceFilePreview op={op} />
      )}
    </div>
  )
}

/* ── Resizable split hook (horizontal, percentage-based) ── */

function useSplitResize(containerRef, initialPct) {
  const [splitPct, setSplitPct] = useState(initialPct)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const container = containerRef.current
    if (!container) return

    const onMouseMove = (ev) => {
      const rect = container.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const pct = Math.min(70, Math.max(15, (x / rect.width) * 100))
      setSplitPct(pct)
      safeStorage.setItem(STORAGE_KEY_SPLIT, String(Math.round(pct)))
    }

    const onMouseUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [containerRef])

  return { splitPct, dragging, onMouseDown }
}

export default function FileOpsPanel() {
  const { t } = useTranslation()
  const fileOps = useFileOpsStore((s) => s.fileOps)
  const selectedFileOpId = useFileOpsStore((s) => s.selectedFileOpId)
  const setSelectedFileOpId = useFileOpsStore((s) => s.setSelectedFileOpId)
  const rewindMarker = useChatStore((s) => s.rewindMarker)
  const containerRef = useRef(null)
  const { splitPct, dragging, onMouseDown } = useSplitResize(containerRef, getStoredSplitPct())
  const changeOps = useMemo(
    () => fileOps.filter((op) => op.type === 'write' || op.type === 'edit'),
    [fileOps]
  )

  const selectedOp = useMemo(
    () => changeOps.find((op) => op.id === selectedFileOpId) || null,
    [changeOps, selectedFileOpId]
  )

  const revertedSet = useMemo(
    () => new Set(rewindMarker?.revertedToolUseIds || []),
    [rewindMarker]
  )
  const revertedCount = useMemo(
    () => changeOps.reduce((acc, op) => acc + (revertedSet.has(op.id) ? 1 : 0), 0),
    [changeOps, revertedSet]
  )

  // Group by round into turns
  const turns = useMemo(() => {
    const map = new Map()
    for (const op of changeOps) {
      if (!map.has(op.roundId)) map.set(op.roundId, [])
      map.get(op.roundId).push(op)
    }
    return Array.from(map.entries()).map(([roundId, ops]) => ({ roundId, ops }))
  }, [changeOps])

  if (changeOps.length === 0) {
    return (
      <div
        className="flex items-center justify-center flex-1"
        style={{ color: 'var(--text-dim)' }}
      >
        <span className="text-xs">{t('fileOps.noChanges', 'No file changes')}</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-1 min-w-0 overflow-hidden relative">
      {/* Left column: operation list */}
      <div
        className="flex flex-col overflow-y-auto flex-shrink-0"
        style={{
          width: `${splitPct}%`,
          minWidth: 100,
        }}
      >
        {rewindMarker && (
          <div
            className="flex items-start gap-2"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              background: 'var(--bg-elevated)',
              borderLeft: '2px solid var(--purple)',
              borderBottom: '1px solid var(--border-subtle)',
              padding: '6px 12px',
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}
          >
            <RotateCcw size={12} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0, marginTop: 2 }} />
            <div className="flex flex-col min-w-0">
              <span>
                {t('rewind.onDiskHeader', {
                  time: new Date(rewindMarker.rewindTs).toTimeString().slice(0, 5),
                })}
              </span>
              <span style={{ color: 'var(--text-dim)' }}>
                {t('rewind.onDiskSubtitle', { count: revertedCount })}
              </span>
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnGroup
            key={turn.roundId}
            turnIndex={i}
            ops={turn.ops}
            selectedFileOpId={selectedFileOpId}
            onSelect={setSelectedFileOpId}
            defaultOpen={i === turns.length - 1}
            revertedSet={revertedSet}
          />
        ))}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: dragging ? 'var(--blue)' : 'var(--border-subtle)',
          transition: dragging ? 'none' : 'background 100ms ease',
          flexShrink: 0,
          zIndex: 5,
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.background = 'var(--blue)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.background = 'var(--border-subtle)'
        }}
      />

      {/* Right column: preview */}
      <div className="flex flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--bg-base)' }}>
        <PreviewPanel op={selectedOp} />
      </div>

      {dragging && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            cursor: 'col-resize',
            background: 'transparent',
          }}
        />
      )}
    </div>
  )
}
