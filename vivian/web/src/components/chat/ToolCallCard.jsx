import { useState, useEffect, useId, useMemo, useRef } from 'react'
import {
  ChevronDown, Check, X, Terminal, FileText,
  Search, Globe, Clock, Loader, StopCircle, Copy, Send, RotateCcw,
  AlertTriangle, Bot, ListTodo, Radio, FolderOpen, ScrollText,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Chip from '../shared/Chip'
import { copyTextToClipboard } from '../../utils/clipboard'
import useTaskStore from '../../stores/taskStore'
import { GENERATED_TOOL_LABEL, GENERATED_TOOL_NAME, getToolDisplayName } from '../../utils/generatedTool'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const TOOL_ICONS = {
  Bash: Terminal,
  Read: FileText,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  delegate_to_openclaw: Send,
  mcp__vivian_openclaw__delegate_to_openclaw: Send,
  [GENERATED_TOOL_NAME]: FileText,
  [GENERATED_TOOL_LABEL]: FileText,
  Agent: Bot,
  Task: Bot,
  TodoWrite: ListTodo,
  Monitor: Radio,
  Skill: ScrollText,
}

// Tools where the inline (message-box) expanded pane hides the INPUT block
// because the header + row-2 already carry all the relevant input context.
// Canvas detail renders a separate component and is unaffected.
const HIDE_INLINE_INPUT = new Set(['Bash', 'Read', 'Glob', 'Grep', 'Monitor'])

// One-line inline meta for tools that fold their full command into row 1.
// Returns { prefix?: { text, color }, text, copyable } or null.
function getRichMeta(block) {
  const input = block.input || {}
  if (block.name === 'Bash') {
    if (!input.command) return null
    return {
      prefix: { text: '$', color: 'var(--green)' },
      text: String(input.command),
      copyable: String(input.command),
    }
  }
  if (block.name === 'Glob') {
    const parts = []
    if (input.pattern) parts.push(String(input.pattern))
    if (input.path) parts.push(String(input.path))
    if (parts.length === 0) parts.push('(cwd)')
    return { text: parts.join(' · '), copyable: input.pattern ? String(input.pattern) : (input.path || '(cwd)') }
  }
  if (block.name === 'Grep') {
    const parts = []
    if (input.pattern) parts.push(`"${input.pattern}"`)
    if (input.path) parts.push(String(input.path))
    if (input.glob) parts.push(String(input.glob))
    if (input.type) parts.push(`type:${input.type}`)
    if (parts.length === 0) parts.push('(cwd)')
    return { text: parts.join(' · '), copyable: input.pattern ? String(input.pattern) : (input.path || '(cwd)') }
  }
  return null
}

function getToolMeta(block) {
  const input = block.input || {}
  const result = block.result
  if (block.name === 'Bash') {
    // Bash now uses richMeta on row 1; description surfaces in the expanded pane.
    return null
  }
  if (block.name === 'Read') {
    const offset = input.offset
    const limit = input.limit
    let actual = null
    if (result && typeof result.content === 'string' && result.content) {
      actual = result.content.split('\n').filter((l) => l.length > 0).length
    }
    const linesSuffix = actual != null ? ` · ${actual} lines` : ''
    if (offset != null && limit != null) return `L${offset}–L${offset + limit - 1}${linesSuffix}`
    if (limit != null) return `L1–L${limit}${linesSuffix}`
    if (offset != null) return `from L${offset}${linesSuffix}`
    return `full file${linesSuffix}`
  }
  if (block.name === 'Glob' || block.name === 'Grep') {
    // Handled by richMeta on row 1.
    return null
  }
  if (block.name === 'Skill') {
    const name = input.skill || input.name || input.skill_name
    return name ? String(name) : null
  }
  if (block.name === 'Monitor') {
    const parts = []
    if (input.description) parts.push(String(input.description))
    if (input.persistent) {
      parts.push('persistent')
    } else if (typeof input.timeout_ms === 'number') {
      const sec = input.timeout_ms / 1000
      const label = sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`
      parts.push(`timeout ${label}`)
    }
    return parts.length ? parts.join(' · ') : null
  }
  return null
}

function getStatusOverride(block, status) {
  if (block.name === 'Grep' && status === 'success' && block.result?.content) {
    const text = typeof block.result.content === 'string' ? block.result.content : ''
    if (!text.trim()) return '0 matches'
    const count = text.split('\n').filter((l) => l.length > 0).length
    return count === 1 ? '1 match' : `${count} matches`
  }
  return null
}

function formatInput(input) {
  if (!input) return ''
  if (typeof input === 'string') return input
  return JSON.stringify(input, null, 2)
}

function formatOutput(result) {
  if (!result) return ''
  if (result.content) {
    if (typeof result.content === 'string') return result.content
    if (Array.isArray(result.content)) {
      return result.content
        .map((c) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
        .join('\n')
    }
    return JSON.stringify(result.content, null, 2)
  }
  return JSON.stringify(result, null, 2)
}

function getCommandLine(block) {
  const input = block.input
  if (!input) return null
  if (block.name === 'Bash' && input.command) return { prefix: '$', text: input.command }
  if (block.name === 'Agent' || block.name === 'Task') {
    const desc = input.description || input.prompt || input.subagent_type
    if (desc) return { prefix: '', text: String(desc) }
  }
  if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
    const total = input.todos.length
    const done = input.todos.filter((t) => t.status === 'completed').length
    return { prefix: '', text: `${done}/${total} done` }
  }
  if (block.name === 'Read' && input.file_path) {
    return { prefix: '', text: input.file_path }
  }
  // Glob & Grep are handled by richMeta on row 1; flags surface in expanded INPUT pane.
  if (block.name === 'Monitor' && input.command) {
    return { prefix: '$', text: input.command }
  }
  if (getToolDisplayName(block.name) === GENERATED_TOOL_LABEL && Array.isArray(input.paths) && input.paths.length > 0) {
    return { prefix: '', text: input.paths.join(' · ') }
  }
  if (input.file_path) return { prefix: '', text: input.file_path }
  if (input.pattern) return { prefix: '', text: `${input.path ? input.path + '/' : ''}${input.pattern}` }
  if (input.url) return { prefix: '', text: input.url }
  if (input.query) return { prefix: '', text: input.query }
  // mcp__* tools: first non-empty string field
  if (typeof block.name === 'string' && block.name.startsWith('mcp__')) {
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === 'string' && v.trim()) return { prefix: '', text: `${k}: ${v}` }
    }
  }
  return null
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

function LiveTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(Date.now() - startTime)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 100)
    return () => clearInterval(id)
  }, [startTime])
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
      <Clock size={10} strokeWidth={1.5} />
      {formatDuration(elapsed)}
    </span>
  )
}

function hookPillDescriptor(evt) {
  const data = evt?.data || {}
  const decision = data.decision || data.permissionDecision || null
  const updatedOutput =
    data.updatedToolOutput ?? data.updated_tool_output ?? data.updatedMCPToolOutput ?? null
  const reason = data.reason || data.permissionDecisionReason || data.message || null
  const eventName = String(evt?.hook_event_name || '').toUpperCase()

  let color = 'var(--text-dim)'
  let label = ''
  if (decision === 'block' || decision === 'deny') {
    color = 'var(--red)'
    label = 'BLOCKED'
  } else if (decision === 'defer' || decision === 'ask') {
    color = 'var(--yellow)'
    label = 'DEFERRED'
  } else if (updatedOutput != null) {
    color = 'var(--cyan)'
    label = 'REDACTED'
  } else if (decision === 'allow' || evt?.subtype === 'hook_response') {
    color = 'var(--text-dim)'
    label = 'OK'
  } else if (evt?.subtype === 'hook_started') {
    color = 'var(--text-dim)'
    label = 'RUN'
  } else {
    color = 'var(--text-dim)'
    label = 'OK'
  }

  return { color, label, eventName, reason }
}

function HookEventPills({ events, compact }) {
  if (!Array.isArray(events) || events.length === 0) return null
  // Collapse to one pill per (eventName + final state). For matched
  // hook_started + hook_response with the same uuid, the response wins.
  const byKey = new Map()
  for (const evt of events) {
    const key = evt?.uuid || `${evt?.hook_event_name}-${byKey.size}`
    const prev = byKey.get(key)
    if (!prev || (prev.subtype !== 'hook_response' && evt?.subtype === 'hook_response')) {
      byKey.set(key, evt)
    }
  }
  const fontSize = compact ? 9 : 10
  const padding = compact ? '0px 4px' : '1px 6px'
  return (
    <div className="flex items-center" style={{ gap: 4, flexShrink: 0 }}>
      {[...byKey.values()].map((evt) => {
        const d = hookPillDescriptor(evt)
        return (
          <span
            key={evt._key || evt.uuid || `${d.eventName}-${d.label}`}
            title={d.reason || `${d.eventName} ${d.label}`}
            className="uppercase"
            style={{
              fontSize,
              letterSpacing: '0.06em',
              padding,
              background: 'var(--bg-elevated)',
              color: 'var(--purple)',
              border: '1px solid var(--border-subtle)',
              borderLeft: `2px solid ${d.color}`,
              borderRadius: 2,
              lineHeight: 1.4,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
          >
            {d.eventName} {d.label}
          </span>
        )
      })}
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

export default function ToolCallCard({ block, reverted = false, compact = false }) {
  const { t } = useTranslation()
  const bodyId = useId()
  const status = block.status || 'running'
  const isError = status === 'error' || block.result?.is_error
  // Errored tool calls auto-expand by default (per design §4 "Error is
  // first-class"). Running/success cards stay collapsed until user opens.
  const [isOpen, setIsOpen] = useState(() => Boolean(isError))
  const lastErrorRef = useRef(isError)
  useEffect(() => {
    // If a running tool transitions to error later, auto-open.
    if (isError && !lastErrorRef.current) setIsOpen(true)
    lastErrorRef.current = isError
  }, [isError])

  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId)
  const cardRef = useRef(null)
  const isActive = activeTaskId && activeTaskId === block.id
  const displayName = getToolDisplayName(block.name)
  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isActive])

  const isComplete = status === 'success' || status === 'error'
  const Icon = TOOL_ICONS[block.name] || TOOL_ICONS[displayName] || Terminal
  const richMeta = getRichMeta(block)
  const commandLine = !richMeta ? getCommandLine(block) : null
  const toolMeta = getToolMeta(block)
  const statusOverride = getStatusOverride(block, status)
  const hideInlineInput = HIDE_INLINE_INPUT.has(block.name)
  const inputStr = useMemo(() => formatInput(block.input), [block.input])
  const outputStr = useMemo(() => block.result ? formatOutput(block.result) : '', [block.result])
  const showInputPane = !hideInlineInput && inputStr
  const bashDescription = block.name === 'Bash' && block.input?.description
    ? String(block.input.description)
    : ''
  const chevronSize = compact ? 10 : 12
  const iconSize = compact ? 11 : 12
  const statusIconSize = compact ? 9 : 10
  const nameFontSize = compact ? 11 : 12
  const metaFontSize = compact ? 10 : 11
  const commandMarginLeft = compact ? 18 : 22
  const commandIconSize = compact ? 10 : 11
  const contentPadding = compact ? '5px 8px' : '8px 12px'
  const codeLineHeight = compact ? 1.45 : 1.6
  const chipCompactStyle = compact
    ? { padding: '1px 4px', fontSize: 10, lineHeight: '12px' }
    : {}

  // Status-based background tint
  const bgTint = isActive
    ? 'var(--bg-elevated)'
    : status === 'running'
      ? 'rgba(88, 166, 255, 0.03)'
      : isError
        ? 'rgba(248, 81, 73, 0.06)'
        : status === 'success'
          ? 'rgba(63, 185, 80, 0.03)'
          : 'transparent'

  const detailsNode = useMemo(() => (
    <div className="overflow-hidden">
      {/* Input section */}
      {showInputPane && (
        <div style={{ padding: contentPadding }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {t('toolCall.input')}
            </span>
            <InlineCopyButton content={inputStr} />
          </div>
          <pre
            className="text-xs overflow-x-auto"
            style={{
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              lineHeight: codeLineHeight,
              maxHeight: compact ? 160 : 200,
              overflowY: 'auto',
            }}
          >
            {inputStr}
          </pre>
        </div>
      )}

      {/* Bash description (shown above OUTPUT since INPUT pane is suppressed) */}
      {bashDescription && (
        <div style={{ padding: contentPadding }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {t('toolCall.description')}
            </span>
          </div>
          <div
            className="text-xs"
            style={{
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: codeLineHeight,
            }}
          >
            {bashDescription}
          </div>
        </div>
      )}

      {/* Divider */}
      {(showInputPane || bashDescription) && outputStr && (
        <div style={{ height: 1, background: 'var(--border)', margin: compact ? '0 8px' : '0 12px' }} />
      )}

      {/* Output section */}
      {outputStr && (
        <div style={{ padding: contentPadding }}>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-semibold uppercase"
              style={{
                color: block.result?.is_error ? 'var(--red)' : 'var(--text-dim)',
                letterSpacing: '0.06em',
              }}
            >
              {block.result?.is_error ? t('toolCall.error') : t('toolCall.output')}
            </span>
            <InlineCopyButton content={outputStr} />
          </div>
          <pre
            className="text-xs overflow-x-auto"
            style={{
              color: block.result?.is_error ? 'var(--red)' : 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              lineHeight: codeLineHeight,
              maxHeight: compact ? 240 : 400,
              overflowY: 'auto',
            }}
          >
            {outputStr}
          </pre>
        </div>
      )}
    </div>
  ), [
    bashDescription,
    block.result?.is_error,
    codeLineHeight,
    compact,
    contentPadding,
    inputStr,
    outputStr,
    showInputPane,
    t,
  ])

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden${compact ? ' tool-call-card-compact' : ''}`}
      data-tool-card
      data-tool-use-id={block.id}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: status === 'success'
          ? `${compact ? 2 : 3}px solid var(--green)`
          : isError
            ? `${compact ? 2 : 3}px solid var(--red)`
            : status === 'running'
              ? `${compact ? 2 : 3}px solid var(--purple)`
              : '1px solid var(--border)',
        borderRadius: '4px',
        opacity: reverted ? 0.55 : 1,
        filter: reverted ? 'grayscale(0.4)' : 'none',
      }}
    >
      {/* Collapsed header */}
      <button
        type="button"
        className={`quiet-toggle flex flex-col w-full ${compact ? 'text-xs' : 'text-sm'}`}
        style={{
          gap: compact ? 2 : 4,
          background: bgTint,
          border: 'none',
          borderRadius: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-primary)',
          padding: compact ? (block.name === 'Skill' ? '3px 5px' : '4px 6px') : (block.name === 'Skill' ? '4px 6px' : '6px 8px'),
          transition: 'background 150ms ease',
        }}
        onClick={() => {
          const nextOpen = !isOpen
          setIsOpen(nextOpen)
          if (nextOpen && block.id && activeTaskId !== block.id) setActiveTaskId(block.id)
        }}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = bgTint }}
      >
        {/* Row 1: chevron + icon + name + duration + status */}
        <div className="flex items-center gap-1 w-full min-w-0">
          <AnimatedChevron open={isOpen} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={chevronSize} strokeWidth={1.5} />
          </AnimatedChevron>

          <Icon size={iconSize} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />

          <span className="font-semibold" style={{ color: 'var(--text-primary)', flexShrink: 0, fontSize: nameFontSize }}>{displayName}</span>

          {richMeta ? (
            <>
              <span
                className="truncate text-xs"
                style={{ color: 'var(--text-dim)', minWidth: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: metaFontSize }}
              >
                ·{' '}
                {richMeta.prefix && (
                  <span style={{ color: richMeta.prefix.color }}>{richMeta.prefix.text} </span>
                )}
                {richMeta.text}
              </span>
              <InlineCopyButton content={richMeta.copyable} />
            </>
          ) : toolMeta && (
            <span
              className="truncate text-xs"
              style={{ color: 'var(--text-dim)', minWidth: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: metaFontSize }}
            >
              · {toolMeta}
            </span>
          )}

          {/* Right-aligned group: hook pills + duration + status + reverted */}
          <div className="flex items-center gap-1" style={{ marginLeft: 'auto', paddingLeft: compact ? 6 : 8, flexShrink: 0 }}>
          <HookEventPills events={block.metadata?.hookEvents} compact={compact} />
          {/* Duration */}
          {status === 'running' && block.startTime && (
            <LiveTimer startTime={block.startTime} />
          )}
          {isComplete && block.duration && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              <Clock size={10} strokeWidth={1.5} />
              {formatDuration(block.duration)}
            </span>
          )}

          {/* Status chip */}
          {isComplete ? (
            isError ? (
              <span className="chip" style={{
                color: 'var(--text-inverse)',
                background: 'var(--red)',
                borderColor: 'var(--red)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                opacity: 1,
                ...chipCompactStyle,
              }}>
                <AlertTriangle size={statusIconSize} strokeWidth={1.5} style={{ marginRight: 2 }} /> {t('toolCall.error')}
              </span>
            ) : (
              <span className="chip" style={{
                color: 'var(--green)',
                background: 'rgba(63, 185, 80, 0.15)',
                borderColor: 'rgba(63, 185, 80, 0.4)',
                opacity: 1,
                ...chipCompactStyle,
              }}>
                <Check size={statusIconSize} strokeWidth={1.5} style={{ marginRight: 2 }} /> {statusOverride || t('toolCall.success')}
              </span>
            )
          ) : (
            <span className="chip" style={{
              color: 'var(--purple)',
              background: 'rgba(188, 140, 255, 0.1)',
              borderColor: 'rgba(188, 140, 255, 0.3)',
              opacity: 1,
              ...chipCompactStyle,
            }}>
              <Loader size={statusIconSize} strokeWidth={1.5} className="icon-running" style={{ marginRight: 2 }} />
              <span className="thinking-shimmer" style={{ fontSize: compact ? 10 : 11 }}>{statusOverride || t('toolCall.running')}</span>
            </span>
          )}

          {reverted && (
            <span className="chip" style={{
              color: 'var(--text-dim)',
              background: 'transparent',
              borderColor: 'var(--border)',
              letterSpacing: '0.06em',
              opacity: 1,
              ...chipCompactStyle,
            }}>
              <RotateCcw size={statusIconSize} strokeWidth={1.5} style={{ marginRight: 2 }} />
              {t('rewind.reverted')}
            </span>
          )}
          </div>
        </div>

        {/* Row 2: command preview */}
        {commandLine && (
          <div
            className="flex items-center gap-1 min-w-0 overflow-hidden text-xs"
            style={{ color: 'var(--text-dim)', marginLeft: commandMarginLeft, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: metaFontSize }}
          >
            {commandLine.prefix === 'folder' ? (
              <FolderOpen size={commandIconSize} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            ) : commandLine.prefix ? (
              <span style={{ color: 'var(--green)' }}>{commandLine.prefix}</span>
            ) : null}
            <span className="truncate">{commandLine.text}</span>
            <InlineCopyButton content={commandLine.text} />
          </div>
        )}
      </button>

      {/* Expanded content */}
      <AnimatedCollapse
        open={isOpen}
        id={bodyId}
        animateHeight={false}
        keepMounted
        deferContentOnClose
        style={{
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {detailsNode}
      </AnimatedCollapse>
    </div>
  )
}
