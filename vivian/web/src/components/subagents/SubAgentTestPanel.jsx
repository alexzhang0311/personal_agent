import { useState, useMemo } from 'react'
import { Play, Square, Trash2, FlaskConical, Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSubagentsStore from '../../stores/subagentsStore'
import { useAutoScroll } from '../../hooks/useAutoScroll'

const monoFont = "'JetBrains Mono', 'Source Han Mono SC', monospace"

function renderContentBlocks(content) {
  if (!Array.isArray(content)) return null
  return content.map((block, idx) => {
    if (!block || typeof block !== 'object') return null
    if (block.type === 'text') {
      return (
        <div
          key={idx}
          style={{
            fontSize: 12,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
          }}
        >
          {block.text}
        </div>
      )
    }
    if (block.type === 'thinking') {
      return (
        <div
          key={idx}
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontStyle: 'italic',
          }}
        >
          {block.thinking || block.text}
        </div>
      )
    }
    if (block.type === 'tool_use') {
      const isAgent = block.name === 'Agent' || block.name === 'Task'
      return (
        <div
          key={idx}
          className="flex items-center gap-2"
          style={{
            fontSize: 11,
            color: isAgent ? 'var(--blue)' : 'var(--cyan)',
            fontFamily: monoFont,
            background: 'var(--bg-elevated)',
            padding: '4px 8px',
            borderRadius: '2px',
          }}
        >
          {isAgent ? '▶ subagent dispatch' : '▶'} {block.name}
        </div>
      )
    }
    if (block.type === 'tool_result') {
      const isErr = block.is_error === true
      let text = ''
      if (typeof block.content === 'string') {
        text = block.content
      } else if (Array.isArray(block.content)) {
        text = block.content.map((c) => c?.text || '').filter(Boolean).join('\n')
      }
      return (
        <div
          key={idx}
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: monoFont,
            borderLeft: `2px solid ${isErr ? 'var(--red)' : 'var(--green)'}`,
            padding: '2px 8px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {text || '(no output)'}
        </div>
      )
    }
    return null
  })
}

function EventRow({ event, data }) {
  const parentToolUseId = data?.parent_tool_use_id
  const isSub = !!parentToolUseId
  const indent = isSub ? 16 : 0
  const accent = isSub ? 'var(--purple)' : 'var(--blue)'

  if (event === 'assistant') {
    const content = data?.content
    return (
      <div
        className="flex flex-col gap-1"
        style={{
          paddingLeft: indent,
          marginLeft: 4,
          borderLeft: `2px solid ${accent}`,
          padding: '6px 12px',
        }}
      >
        {renderContentBlocks(content)}
      </div>
    )
  }

  if (event === 'tool_result' || event === 'user') {
    const content = data?.content
    return (
      <div
        className="flex flex-col gap-1"
        style={{
          paddingLeft: indent,
          marginLeft: 4,
          padding: '4px 12px',
        }}
      >
        {renderContentBlocks(content)}
      </div>
    )
  }

  if (event === 'result') {
    const cost = data?.total_cost_usd ?? data?.usage?.total_cost_usd
    const dur = data?.duration_ms
    const turns = data?.num_turns
    return (
      <div
        className="flex items-center gap-3 px-3 py-2"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          fontFamily: monoFont,
          margin: '8px 12px',
        }}
      >
        <span>turns: {turns ?? '—'}</span>
        <span>{dur != null ? `${(dur / 1000).toFixed(1)}s` : '—'}</span>
        {cost != null && <span>${cost.toFixed(5)}</span>}
        {data?.is_error && <span style={{ color: 'var(--red)' }}>error</span>}
      </div>
    )
  }

  if (event === 'error') {
    return (
      <div
        className="px-3 py-2"
        style={{
          fontSize: 12,
          color: 'var(--red)',
          fontFamily: monoFont,
          borderLeft: '2px solid var(--red)',
          margin: '4px 12px',
        }}
      >
        {data?.message || 'error'}
      </div>
    )
  }

  return null
}

export default function SubAgentTestPanel({ onResize, dragging }) {
  const { t } = useTranslation()
  const selectedName = useSubagentsStore((s) => s.selectedName)
  const testRunning = useSubagentsStore((s) => s.testRunning)
  const testEvents = useSubagentsStore((s) => s.testEvents)
  const runTest = useSubagentsStore((s) => s.runTest)
  const stopTest = useSubagentsStore((s) => s.stopTest)
  const clearTestEvents = useSubagentsStore((s) => s.clearTestEvents)

  const [prompt, setPrompt] = useState('')
  const { containerRef } = useAutoScroll([testEvents.length])

  const visible = useMemo(
    () => testEvents.filter((e) => !['stream_init', 'keepalive'].includes(e.event)),
    [testEvents]
  )

  const canRun = !!selectedName && !testRunning && prompt.trim().length > 0

  const handleRun = () => {
    if (!canRun) return
    runTest(prompt.trim())
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-surface)', position: 'relative' }}>
      <style>{`
        @keyframes sa-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes sa-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
      {testRunning && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--purple)',
            animation: 'sa-pulse 1.4s ease-in-out infinite',
            zIndex: 5,
          }}
        />
      )}
      {/* Resize handle */}
      {onResize && (
        <div
          onMouseDown={onResize}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: 'col-resize',
            background: dragging ? 'var(--blue)' : 'transparent',
            transition: 'background 100ms ease',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            if (!dragging) e.currentTarget.style.background = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            if (!dragging) e.currentTarget.style.background = 'transparent'
          }}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{ height: 48, borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="uppercase font-semibold"
            style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.06em' }}
          >
            {t('subagents.test.title')}
          </span>
          {testRunning && (
            <span
              className="inline-flex items-center gap-1 px-2"
              style={{
                background: 'transparent',
                border: '1px solid var(--purple)',
                borderLeft: '2px solid var(--purple)',
                borderRadius: '3px',
                color: 'var(--purple)',
                fontSize: 10,
                height: 20,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              <Loader
                size={10}
                strokeWidth={1.5}
                style={{ animation: 'sa-spin 1s linear infinite' }}
              />
              {t('subagents.test.running')}
            </span>
          )}
        </div>
        <button
          onClick={clearTestEvents}
          className="flex items-center gap-1 px-2"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            fontSize: 11,
            transition: 'color 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <Trash2 size={11} strokeWidth={1.5} />
          {t('subagents.test.clear')}
        </button>
      </div>

      {/* Composer */}
      <div className="flex flex-col gap-2 p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px dashed var(--border)',
            borderRadius: '4px',
            color: 'var(--text-dim)',
            fontFamily: monoFont,
            fontSize: 12,
          }}
        >
          {t('subagents.test.agentLabel')}: {selectedName || '—'}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('subagents.test.placeholder')}
          rows={3}
          disabled={!selectedName || testRunning}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '6px 8px',
            outline: 'none',
            resize: 'vertical',
            minHeight: 60,
            fontFamily: monoFont,
          }}
        />

        <div className="flex items-center gap-2">
          {!testRunning ? (
            <button
              onClick={handleRun}
              disabled={!canRun}
              className="flex items-center gap-1 px-3"
              style={{
                background: canRun ? 'var(--blue)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: '4px',
                color: canRun ? 'var(--text-inverse)' : 'var(--text-dim)',
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontSize: 12,
                height: 28,
                opacity: canRun ? 1 : 0.5,
              }}
            >
              <Play size={12} strokeWidth={1.5} />
              {t('subagents.test.run')}
            </button>
          ) : (
            <button
              onClick={stopTest}
              className="flex items-center gap-1 px-3"
              style={{
                background: 'var(--red)',
                border: 'none',
                borderRadius: '4px',
                color: 'var(--text-inverse)',
                cursor: 'pointer',
                fontSize: 12,
                height: 28,
              }}
            >
              <Square size={12} strokeWidth={1.5} />
              {t('subagents.test.stop')}
            </button>
          )}
        </div>
      </div>

      {/* Event log */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-2">
        {visible.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-8 px-4"
            style={{ color: 'var(--text-dim)', textAlign: 'center', height: '100%' }}
          >
            <FlaskConical size={28} strokeWidth={1.5} />
            <div style={{ fontSize: 12, marginTop: 8 }}>
              {selectedName ? t('subagents.test.empty') : t('subagents.test.selectFirst')}
            </div>
          </div>
        )}
        {visible.map((entry, idx) => (
          <EventRow key={idx} event={entry.event} data={entry.data} />
        ))}
      </div>
    </div>
  )
}
