import { useState, useEffect, useId, useRef } from 'react'
import { ChevronDown, ListTodo } from 'lucide-react'
import TodoItem from '../shared/TodoItem'
import useTaskStore from '../../stores/taskStore'
import useUiStore from '../../stores/uiStore'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

/**
 * Inline TodoWrite card shown in the message timeline in place of the
 * generic ToolCallCard when a block.name === 'TodoWrite'.
 *
 * Two render modes:
 *   - full   (the latest TodoWrite in the conversation): shows the full
 *            list of todos, renders like the reference "plan" widget.
 *   - collapsed (earlier TodoWrite calls): renders as a one-line
 *            `▸ TodoWrite updated · N/M done` stub so the thread stays
 *            scannable.
 */
export default function TodoWriteCard({ block, mode = 'full' }) {
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const focusTodoWrite = useTaskStore((s) => s.focusTodoWrite)
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const cardRef = useRef(null)
  const bodyId = useId()
  const isActive = activeTaskId && activeTaskId === block.id

  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isActive])

  const todos = Array.isArray(block.input?.todos) ? block.input.todos : []
  const total = todos.length
  const done = todos.filter((t) => t.status === 'completed').length

  const [expanded, setExpanded] = useState(mode === 'full')
  useEffect(() => { setExpanded(mode === 'full') }, [mode])

  const bgTint = isActive ? 'var(--bg-elevated)' : 'rgba(188, 140, 255, 0.04)'
  const handleToggle = () => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded && block.id) {
      focusTodoWrite(block.id)
      showCanvas()
      setActiveCanvasTab('tasks')
    }
  }

  return (
    <div
      ref={cardRef}
      className="overflow-hidden"
      data-tool-card
      data-tool-use-id={block.id}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--purple)',
        borderRadius: 4,
      }}
    >
      <button
        type="button"
        className="quiet-toggle flex items-center gap-2 w-full px-3 py-2 text-sm"
        style={{
          background: bgTint,
          border: 'none',
          borderRadius: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-primary)',
          transition: 'background 150ms ease',
        }}
        onClick={handleToggle}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = bgTint }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={14} strokeWidth={1.5} />
        </AnimatedChevron>
        <ListTodo size={14} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0 }} />
        <span className="font-semibold" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>
          TODO
        </span>
        <span className="flex-1" />
        <span
          className="flex-shrink-0 font-light text-xs"
          style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}
        >
          {mode === 'full' ? `${done}/${total}` : `updated · ${done}/${total}`}
        </span>
      </button>

      <AnimatedCollapse
        open={expanded && total > 0}
        id={bodyId}
        style={{
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border-subtle)',
        }}
        innerClassName="py-1"
        animateHeight={false}
      >
        {() => (
          <>
          {todos.map((todo, i) => (
            <TodoItem key={i} todo={todo} indent={16} />
          ))}
          </>
        )}
      </AnimatedCollapse>
    </div>
  )
}
