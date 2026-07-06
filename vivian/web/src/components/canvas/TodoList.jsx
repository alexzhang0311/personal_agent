import { useState, useEffect, useId } from 'react'
import { CheckCircle, Loader, Circle, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import CopyButton from '../shared/CopyButton'
import useTaskStore from '../../stores/taskStore'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const todoStatusConfig = {
  completed: { icon: CheckCircle, color: 'var(--green)' },
  in_progress: { icon: Loader, color: 'var(--purple)', spinning: true },
  pending: { icon: Circle, color: 'var(--text-dim)' },
}

const toolStatusConfig = {
  running: { icon: Loader, color: 'var(--purple)', spinning: true },
  success: { icon: CheckCircle, color: 'var(--green)' },
  error: { icon: Circle, color: 'var(--red)' },
}

function formatDuration(tool) {
  if (!tool.startTime) return ''
  const end = tool.endTime || Date.now()
  const ms = end - tool.startTime
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/* Expandable INPUT/OUTPUT detail block */
function DetailBlock({ input, result, toolUseResult, indent = 48 }) {
  const inputJson = input ? JSON.stringify(input, null, 2) : null
  const rawOutput = result?.content || null
  const turOutput = toolUseResult ? JSON.stringify(toolUseResult, null, 2) : null
  const outputContent = rawOutput || turOutput || null

  if (!inputJson && !outputContent) return null

  return (
    <div
      className="mb-1 overflow-hidden"
      style={{ background: 'var(--bg-elevated)', borderRadius: 2, fontSize: 10, marginLeft: indent, marginRight: 12 }}
    >
      {inputJson && (
        <div
          className="copyable relative"
          style={{ padding: '4px 8px', borderBottom: outputContent ? '1px solid var(--border-subtle)' : 'none' }}
        >
          <div style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', marginBottom: 2 }}>INPUT</div>
          <pre style={{ color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-code)', fontSize: 10 }}>{inputJson}</pre>
          <CopyButton content={inputJson} />
        </div>
      )}
      {outputContent && (
        <div className="copyable relative" style={{ padding: '4px 8px' }}>
          <div style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', marginBottom: 2 }}>OUTPUT</div>
          <pre style={{ color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-code)', fontSize: 10 }}>
            {typeof outputContent === 'string' ? outputContent : JSON.stringify(outputContent, null, 2)}
          </pre>
          <CopyButton content={typeof outputContent === 'string' ? outputContent : JSON.stringify(outputContent, null, 2)} />
        </div>
      )}
    </div>
  )
}

/* A tool execution row (Bash, etc.) nested under a todo item */
function ToolDetail({ tool }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const config = toolStatusConfig[tool.status] || toolStatusConfig.running
  const StatusIcon = config.icon

  return (
    <div>
      <button
        className="quiet-toggle flex items-center gap-1 w-full text-xs py-1"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          color: 'var(--text-secondary)', paddingLeft: 44, paddingRight: 12,
          transition: 'background 150ms ease',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={10} strokeWidth={1.5} />
        </AnimatedChevron>
        <StatusIcon size={10} strokeWidth={1.5} style={{ color: config.color, flexShrink: 0 }} className={config.spinning ? 'icon-running' : ''} />
        <span style={{ color: 'var(--cyan)' }}>{tool.name}</span>
        <span className="flex-1 min-w-0 truncate font-light" style={{ color: 'var(--text-dim)' }}>
          {tool.input?.command ? `$ ${tool.input.command}` : ''}
        </span>
        <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(tool)}
        </span>
      </button>
      <AnimatedCollapse open={expanded} id={bodyId}>
        <DetailBlock input={tool.input} result={tool.result} toolUseResult={tool.toolUseResult} indent={48} />
      </AnimatedCollapse>
    </div>
  )
}

/* A single todo item, expandable to show associated tool executions */
function TodoItem({ todo }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const status = todo.status || 'pending'
  const config = todoStatusConfig[status] || todoStatusConfig.pending
  const Icon = config.icon
  const label = todo.content || todo.text || todo.description || ''
  const toolUses = todo.toolUses || []
  const hasDetails = toolUses.length > 0

  return (
    <div>
      <button
        className="quiet-toggle flex items-center gap-1 w-full text-xs"
        style={{
          background: 'transparent', border: 'none',
          paddingLeft: 24, paddingRight: 12, paddingTop: 2, paddingBottom: 2,
          cursor: hasDetails ? 'pointer' : 'default', textAlign: 'left',
          transition: 'background 150ms ease',
          color: status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
        }}
        onClick={() => hasDetails && setExpanded(!expanded)}
        onMouseEnter={(e) => { if (hasDetails) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-expanded={hasDetails ? expanded : undefined}
        aria-controls={hasDetails ? bodyId : undefined}
      >
        {hasDetails ? (
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={10} strokeWidth={1.5} />
          </AnimatedChevron>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <Icon size={12} strokeWidth={1.5} style={{ color: config.color, flexShrink: 0 }} className={config.spinning ? 'icon-running' : ''} />
        <span className="min-w-0 flex-1" style={{ wordBreak: 'break-word', textDecoration: status === 'completed' ? 'line-through' : 'none' }}>
          {label}
        </span>
      </button>
      <AnimatedCollapse open={expanded && hasDetails} id={bodyId} animateHeight={false}>
        {() => toolUses.map((tool, i) => (
          <ToolDetail key={tool.tool_use_id || i} tool={tool} />
        ))}
      </AnimatedCollapse>
    </div>
  )
}

/* TodoWrite parent node — expandable to show tool detail + todo items */
function TodoWriteNode({ info, todos }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const [detailExpanded, setDetailExpanded] = useState(false)
  const bodyId = useId()
  const detailBodyId = useId()
  const [, setTick] = useState(0)
  const status = info?.status || 'running'
  const config = toolStatusConfig[status] || toolStatusConfig.running
  const StatusIcon = config.icon

  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [status])

  const completedCount = todos.filter((t) => t.status === 'completed').length

  return (
    <div>
      {/* TodoWrite row */}
      <button
        className="quiet-toggle flex items-center gap-1 w-full text-xs py-1"
        style={{
          background: 'transparent', border: 'none', paddingLeft: 12, paddingRight: 12,
          cursor: 'pointer', textAlign: 'left', transition: 'background 150ms ease',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        <StatusIcon size={12} strokeWidth={1.5} style={{ color: config.color, flexShrink: 0 }} className={config.spinning ? 'icon-running' : ''} />
        <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
          TODO
        </span>
        <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {completedCount}/{todos.length}
        </span>
        {info?.startTime && (
          <span className="flex-shrink-0 font-light ml-1" style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(info)}
          </span>
        )}
      </button>

      <AnimatedCollapse open={expanded} id={bodyId} animateHeight={false}>
        {() => (
        <div>
          {/* Tool detail toggle (INPUT/OUTPUT of TodoWrite itself) */}
          {info?.input && (
            <div style={{ paddingLeft: 24 }}>
              <button
                className="quiet-toggle flex items-center gap-1 text-xs py-1 w-full"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  color: 'var(--text-dim)', paddingRight: 12, transition: 'background 150ms ease',
                }}
                onClick={(e) => { e.stopPropagation(); setDetailExpanded(!detailExpanded) }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                aria-expanded={detailExpanded}
                aria-controls={detailBodyId}
              >
                <AnimatedChevron open={detailExpanded}>
                  <ChevronDown size={10} strokeWidth={1.5} />
                </AnimatedChevron>
                <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>{t('todo.detail')}</span>
              </button>
              <AnimatedCollapse open={detailExpanded} id={detailBodyId}>
                <DetailBlock input={info.input} result={info.result} indent={28} />
              </AnimatedCollapse>
            </div>
          )}

          {/* Todo items */}
          {todos.map((todo, i) => (
            <TodoItem key={i} todo={todo} />
          ))}
        </div>
        )}
      </AnimatedCollapse>
    </div>
  )
}

export default function TodoList() {
  const { t } = useTranslation()
  const todos = useTaskStore((s) => s.todos)
  const todoWriteInfo = useTaskStore((s) => s.todoWriteInfo)
  const [sectionExpanded, setSectionExpanded] = useState(true)
  const sectionBodyId = useId()

  if ((!todos || todos.length === 0) && !todoWriteInfo) return null

  const completedCount = todos ? todos.filter((t) => t.status === 'completed').length : 0
  const totalCount = todos ? todos.length : 0
  return (
    <div className="py-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      {/* Section header */}
      <button
        className="quiet-toggle flex items-center gap-1 w-full px-3 py-1"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', textAlign: 'left',
        }}
        onClick={() => setSectionExpanded(!sectionExpanded)}
        aria-expanded={sectionExpanded}
        aria-controls={sectionBodyId}
      >
        <AnimatedChevron open={sectionExpanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        <span className="flex-1">{t('todo.todoList')}</span>
        {totalCount > 0 && (
          <span className="font-light" style={{ letterSpacing: 0 }}>
            {completedCount}/{totalCount}
          </span>
        )}
      </button>

      <AnimatedCollapse open={sectionExpanded} id={sectionBodyId} animateHeight={false}>
        {() => (
          <TodoWriteNode
            info={todoWriteInfo}
            todos={todos || []}
          />
        )}
      </AnimatedCollapse>
    </div>
  )
}
