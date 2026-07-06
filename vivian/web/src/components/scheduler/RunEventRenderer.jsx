/**
 * RunEventRenderer — renders scheduler run output events with job-type-specific formatting.
 *
 * Agent run events:   system, assistant, tool_use, tool_result, result, task_*, permission_request
 * HTTP call events:   http_request, http_response, http_error
 * User script events: script_start, script_output, script_exit, script_error
 * Legacy:             assistant_message
 */

import { useState, useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Copy, Check, Code, AlignLeft } from 'lucide-react'
import CopyButton from '../shared/CopyButton'
import { copyTextToClipboard } from '../../utils/clipboard'
import Tabs from '../shared/Tabs'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const HIDDEN_EVENTS = new Set(['keepalive', 'stream_init'])
const AGENT_EVENTS = new Set(['system', 'assistant', 'tool_use', 'tool_result', 'result', 'permission_request', 'task_started', 'task_progress', 'task_notification'])

export default function RunEventRenderer({ events }) {
  const visible = events.filter((ev) => !HIDDEN_EVENTS.has(ev.event))
  if (visible.length === 0) return null

  const hasScriptEvents = visible.some((ev) => ev.event.startsWith('script_'))
  if (hasScriptEvents) {
    return <ScriptRunView events={visible} />
  }

  return visible.map((ev, i) => {
    if (AGENT_EVENTS.has(ev.event)) {
      return <AgentEventBlock key={i} ev={ev} />
    }
    return <EventBlock key={i} ev={ev} />
  })
}

// ─── Agent run: collapsible blocks with copy + format toggle ───

function AgentEventBlock({ ev }) {
  const [expanded, setExpanded] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyId = useId()

  const rawJson = JSON.stringify(ev.data, null, 2)

  const handleCopy = useCallback((e) => {
    e.stopPropagation()
    copyTextToClipboard(rawJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 800)
  }, [rawJson])

  const handleToggleFormat = useCallback((e) => {
    e.stopPropagation()
    setShowRaw((v) => !v)
  }, [])

  const { border, label, summary } = getAgentEventMeta(ev)

  return (
    <div
      className="mb-1"
      style={{
        borderLeft: `2px solid ${border}`,
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}
    >
      {/* Clickable header row */}
      <div
        className="flex items-center gap-1 px-2 py-1"
        style={{
          transition: 'background 150ms ease',
          background: 'transparent',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <button
          type="button"
          className="flex items-center gap-1 min-w-0 flex-1"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 0,
            padding: 0,
            textAlign: 'left',
          }}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
          <span
            className="text-xs uppercase font-semibold"
            style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', flexShrink: 0 }}
          >
            {label}
          </span>
          {/* Summary (shown always, truncated) */}
          <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 4 }}>
            {summary}
          </span>
        </button>
        {/* Action buttons (visible on row) */}
        <div className="flex items-center gap-1 flex-shrink-0" style={{ marginLeft: 'auto' }}>
          <button
            onClick={handleToggleFormat}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
              color: showRaw ? 'var(--blue)' : 'var(--text-dim)',
              transition: 'color 150ms ease',
            }}
            title={showRaw ? 'Formatted' : 'Raw JSON'}
          >
            {showRaw
              ? <AlignLeft size={12} strokeWidth={1.5} />
              : <Code size={12} strokeWidth={1.5} />}
          </button>
          <button
            onClick={handleCopy}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
              color: copied ? 'var(--green)' : 'var(--text-dim)',
              transition: 'color 150ms ease',
            }}
            title="Copy raw JSON"
          >
            {copied
              ? <Check size={12} strokeWidth={1.5} />
              : <Copy size={12} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatedCollapse
        open={expanded}
        id={bodyId}
        innerClassName="px-2 pb-2"
        innerStyle={{ paddingLeft: 20 }}
      >
          {showRaw ? (
            <pre
              className="p-2 overflow-x-auto"
              style={{
                background: 'var(--bg-base)',
                borderRadius: 2,
                color: 'var(--text-secondary)',
                fontSize: 11,
                lineHeight: 1.4,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {rawJson}
            </pre>
          ) : (
            <AgentEventContent ev={ev} />
          )}
      </AnimatedCollapse>
    </div>
  )
}

function getAgentEventMeta(ev) {
  switch (ev.event) {
    case 'system':
      return {
        border: 'var(--border)',
        label: 'SYSTEM',
        summary: ev.data?.subtype === 'init'
          ? `session started${ev.data?.data?.session_id ? ` · ${ev.data.data.session_id.slice(0, 8)}...` : ''}`
          : ev.data?.subtype || '',
      }
    case 'assistant': {
      const texts = (ev.data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ')
      const tools = (ev.data?.content || []).filter((b) => b.type === 'tool_use').map((b) => b.name)
      const parts = []
      if (texts) parts.push(texts.slice(0, 100))
      if (tools.length) parts.push(`[${tools.join(', ')}]`)
      return { border: 'var(--purple)', label: 'ASSISTANT', summary: parts.join(' ') || '' }
    }
    case 'tool_use': {
      const names = (ev.data?.content || []).filter((b) => b.type === 'tool_use').map((b) => b.name)
      return { border: 'var(--cyan)', label: 'TOOL USE', summary: names.join(', ') || ev.data?.name || '' }
    }
    case 'tool_result': {
      const results = (ev.data?.content || []).filter((b) => b.type === 'tool_result')
      const hasError = results.some((b) => b.is_error)
      const preview = results.map((b) => typeof b.content === 'string' ? b.content.slice(0, 60) : '').join(' ')
      return {
        border: hasError ? 'var(--red)' : 'var(--border)',
        label: 'TOOL RESULT',
        summary: hasError ? `error: ${preview}` : preview,
      }
    }
    case 'result': {
      const parts = []
      if (ev.data?.is_error) parts.push('ERROR')
      else parts.push('SUCCESS')
      if (ev.data?.num_turns != null) parts.push(`${ev.data.num_turns} turns`)
      // cost intentionally omitted from summary
      return { border: ev.data?.is_error ? 'var(--red)' : 'var(--green)', label: 'RESULT', summary: parts.join(' · ') }
    }
    case 'permission_request':
      return { border: 'var(--yellow)', label: 'PERMISSION', summary: ev.data?.tool_name || '' }
    case 'task_started':
    case 'task_progress':
    case 'task_notification':
      return { border: 'var(--border)', label: ev.event.replace(/_/g, ' ').toUpperCase(), summary: '' }
    default:
      return { border: 'var(--border)', label: ev.event, summary: '' }
  }
}

function AgentEventContent({ ev }) {
  switch (ev.event) {
    case 'system':
      return (
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text-dim)' }}>
            {ev.data?.subtype === 'init' ? 'Session started' : ev.data?.subtype || 'system'}
          </span>
          {ev.data?.data?.session_id && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>
              session: {ev.data.data.session_id}
            </div>
          )}
          {ev.data?.data?.model && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              model: {ev.data.data.model}
            </div>
          )}
        </div>
      )

    case 'assistant':
      return (
        <div style={{ fontSize: 12 }}>
          {ev.data?.content?.map((block, bi) => (
            <div key={bi} className="mb-1">
              {block.type === 'text' && (
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{block.text}</span>
              )}
              {block.type === 'thinking' && (
                <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                  {block.thinking}
                </div>
              )}
              {block.type === 'tool_use' && (
                <div>
                  <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{block.name}</span>
                  {block.input && (
                    <pre className="mt-1 p-2 overflow-x-auto" style={{
                      background: 'var(--bg-base)', borderRadius: 2, color: 'var(--text-secondary)',
                      fontSize: 11, lineHeight: 1.4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )) || (
            <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2)}
            </span>
          )}
        </div>
      )

    case 'tool_use':
      return (
        <div style={{ fontSize: 12 }}>
          {ev.data?.content?.map((block, bi) => (
            <div key={bi} className="mb-1">
              {block.type === 'tool_use' && (
                <div>
                  <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{block.name}</span>
                  {block.input && (
                    <pre className="mt-1 p-2 overflow-x-auto" style={{
                      background: 'var(--bg-base)', borderRadius: 2, color: 'var(--text-secondary)',
                      fontSize: 11, lineHeight: 1.4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
                    </pre>
                  )}
                </div>
              )}
              {block.type === 'text' && (
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{block.text}</span>
              )}
            </div>
          )) || (
            <span style={{ color: 'var(--cyan)' }}>{ev.data?.name || JSON.stringify(ev.data)}</span>
          )}
        </div>
      )

    case 'tool_result':
      return (
        <div style={{ fontSize: 12 }}>
          {ev.data?.content?.map((block, bi) => (
            <div key={bi} className="mb-1">
              {block.type === 'tool_result' && (
                <pre className="p-2 overflow-x-auto" style={{
                  background: 'var(--bg-base)', borderRadius: 2,
                  color: block.is_error ? 'var(--red)' : 'var(--text-secondary)',
                  fontSize: 11, lineHeight: 1.4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
                </pre>
              )}
            </div>
          )) || (
            <span style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: 11 }}>
              {typeof ev.data === 'string' ? ev.data : (typeof ev.data?.content === 'string' ? ev.data.content : JSON.stringify(ev.data, null, 2))}
            </span>
          )}
        </div>
      )

    case 'result':
      return (
        <div style={{ fontSize: 12 }}>
          <div className="flex flex-wrap items-center gap-3 mb-1" style={{ fontSize: 11 }}>
            {ev.data?.is_error != null && (
              <span style={{ color: ev.data.is_error ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                {ev.data.is_error ? 'ERROR' : 'SUCCESS'}
              </span>
            )}
            {ev.data?.num_turns != null && <span style={{ color: 'var(--text-dim)' }}>{ev.data.num_turns} turns</span>}
            {ev.data?.duration_ms != null && <span style={{ color: 'var(--text-dim)' }}>{Math.round(ev.data.duration_ms / 1000)}s</span>}
            {ev.data?.stop_reason && <span style={{ color: 'var(--text-dim)' }}>{ev.data.stop_reason}</span>}
          </div>
          {ev.data?.result && (
            <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {ev.data.result}
            </div>
          )}
        </div>
      )

    case 'permission_request':
      return (
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--yellow)' }}>{ev.data?.tool_name || 'Permission requested'}</span>
          {ev.data?.description && (
            <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>{ev.data.description}</div>
          )}
        </div>
      )

    default:
      return (
        <pre className="p-1 overflow-x-auto" style={{
          background: 'var(--bg-base)', borderRadius: 2, color: 'var(--text-dim)',
          fontSize: 11, lineHeight: 1.4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {JSON.stringify(ev.data, null, 2)}
        </pre>
      )
  }
}

// ─── Script run: grouped view with stdout/stderr tabs ───

function ScriptRunView({ events }) {
  const [activeTab, setActiveTab] = useState('all')

  const startEvent = events.find((ev) => ev.event === 'script_start')
  const exitEvent = events.find((ev) => ev.event === 'script_exit')
  const errorEvent = events.find((ev) => ev.event === 'script_error')
  const outputEvents = events.filter((ev) => ev.event === 'script_output')
  const stdoutLines = outputEvents.filter((ev) => ev.data.stream === 'stdout')
  const stderrLines = outputEvents.filter((ev) => ev.data.stream === 'stderr')

  const tabs = [
    { key: 'all', label: 'ALL', count: outputEvents.length },
    { key: 'stdout', label: 'STDOUT', count: stdoutLines.length },
    { key: 'stderr', label: 'STDERR', count: stderrLines.length },
  ]

  const filteredOutput = activeTab === 'stdout' ? stdoutLines
    : activeTab === 'stderr' ? stderrLines
    : outputEvents

  return (
    <>
      {startEvent && (
        <div className="px-2 py-2 mb-2" style={{ borderLeft: '2px solid var(--cyan)' }}>
          <div className="text-xs uppercase font-semibold mb-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
            {(startEvent.data.language || 'script').toUpperCase()}
          </div>
          <div className="flex flex-col gap-1" style={{ fontSize: 12 }}>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>$</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{startEvent.data.command}</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>cwd</span>
              <span style={{ color: 'var(--text-secondary)' }}>{startEvent.data.cwd}</span>
            </div>
          </div>
        </div>
      )}

      {outputEvents.length > 0 && (
        <Tabs
          tabs={tabs.map((tab) => ({ id: tab.key, ...tab }))}
          activeKey={activeTab}
          onChange={(_, tab) => setActiveTab(tab.key)}
          className="flex items-center gap-0 mb-2"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          buttonClassName="px-3 py-1 text-xs uppercase font-semibold"
          buttonStyle={{ letterSpacing: '0.06em' }}
          getButtonStyle={({ active }) => ({
            color: active ? 'var(--text-primary)' : 'var(--text-dim)',
          })}
          renderLabel={(tab) => (
            <>
              {tab.label}
              {tab.count > 0 && (
                <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 4 }}>{tab.count}</span>
              )}
            </>
          )}
        />
      )}

      <div style={{ fontSize: 12 }}>
        {filteredOutput.map((ev, i) => {
          const isStderr = ev.data.stream === 'stderr'
          return (
            <div key={i} className="px-2 py-0" style={{
              borderLeft: `2px solid ${isStderr ? 'var(--red)' : 'var(--border-subtle)'}`,
              color: isStderr ? 'var(--red)' : 'var(--text-primary)', lineHeight: 1.6,
            }}>
              {ev.data.line}
            </div>
          )
        })}
        {filteredOutput.length === 0 && outputEvents.length > 0 && (
          <div className="px-2 py-2" style={{ color: 'var(--text-dim)' }}>
            {activeTab === 'stderr' ? 'No stderr output' : 'No stdout output'}
          </div>
        )}
      </div>

      {exitEvent && (
        <div className="px-2 py-1 mt-2" style={{ borderLeft: `2px solid ${exitEvent.data.exit_code === 0 ? 'var(--green)' : 'var(--red)'}` }}>
          <div className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <span style={{ color: exitEvent.data.exit_code === 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              {exitEvent.data.timed_out ? 'TIMED OUT' : `exit ${exitEvent.data.exit_code}`}
            </span>
            {exitEvent.data.elapsed_ms != null && (
              <span style={{ color: 'var(--text-dim)' }}>{exitEvent.data.elapsed_ms}ms</span>
            )}
          </div>
        </div>
      )}

      {errorEvent && (
        <div className="px-2 py-1 mt-1" style={{ borderLeft: '2px solid var(--red)' }}>
          <div className="text-xs uppercase font-semibold mb-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>ERROR</div>
          <span style={{ color: 'var(--red)', fontSize: 12 }}>{errorEvent.data.error}</span>
        </div>
      )}
    </>
  )
}

// ─── Non-agent event block (HTTP, legacy) ───

function EventBlock({ ev }) {
  const { t } = useTranslation()
  switch (ev.event) {
    case 'http_request':
      return (
        <Block border="var(--cyan)" label={t('scheduler.eventRequest')}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{ev.data.method}</span>
          {' '}
          <span style={{ color: 'var(--cyan)' }}>{ev.data.url}</span>
          {ev.data.headers && Object.keys(ev.data.headers).length > 0 && (
            <div className="mt-1" style={{ color: 'var(--text-dim)' }}>
              {Object.entries(ev.data.headers).map(([k, v]) => (
                <div key={k}>{k}: {v}</div>
              ))}
            </div>
          )}
        </Block>
      )

    case 'http_response': {
      const code = ev.data.status_code
      const isOk = code >= 200 && code < 400
      const color = isOk ? 'var(--green)' : 'var(--red)'
      return (
        <Block border={color} label={t('scheduler.eventResponse')}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color, fontWeight: 700, fontSize: 13 }}>{code}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{ev.data.reason}</span>
            {ev.data.elapsed_ms != null && (
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{ev.data.elapsed_ms}ms</span>
            )}
          </div>
          {ev.data.body && (
            <div className="relative copyable mt-1">
              <CopyButton content={ev.data.body} />
              <pre className="p-2 overflow-x-auto" style={{
                background: 'var(--bg-base)', borderRadius: 2, color: 'var(--text-primary)',
                fontSize: 12, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {ev.data.body}
              </pre>
            </div>
          )}
        </Block>
      )
    }

    case 'http_error':
      return (
        <Block border="var(--red)" label={t('scheduler.eventError')}>
          <span style={{ color: 'var(--red)' }}>{ev.data.error}</span>
          {ev.data.elapsed_ms != null && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 8 }}>{ev.data.elapsed_ms}ms</span>
          )}
        </Block>
      )

    case 'assistant_message':
      return (
        <Block border="var(--blue)" label={t('scheduler.eventOutput')}>
          <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {ev.data?.message || (typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2))}
          </span>
        </Block>
      )

    default:
      return (
        <Block border="var(--border)" label={ev.event}>
          <span style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2)}
          </span>
        </Block>
      )
  }
}

function Block({ border, label, children }) {
  return (
    <div className="py-1 px-2 mb-1" style={{
      borderLeft: `2px solid ${border}`, wordBreak: 'break-word', overflowWrap: 'break-word',
    }}>
      <div className="text-xs uppercase font-semibold mb-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  )
}
