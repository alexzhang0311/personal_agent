import { useId, useState } from 'react'
import { CheckCircle, Loader, Circle, ChevronDown } from 'lucide-react'
import { AnimatedChevron, AnimatedCollapse } from './Accordion'

const todoStatusConfig = {
  completed: { icon: CheckCircle, color: 'var(--green)' },
  in_progress: { icon: Loader, color: 'var(--purple)', spinning: true },
  pending: { icon: Circle, color: 'var(--text-dim)' },
}

/**
 * Compact todo row shared between the inline TodoWriteCard (message timeline)
 * and the Canvas TodoInspector. Matches the `☐ / ⏳ / ☑` reference widget.
 *
 * Props:
 *   todo                — { content, status, toolUses? }
 *   indent              — left padding (default 24, Canvas uses 12)
 *   onClick             — optional; when passed the row becomes a button
 *   expandable          — if true, clicking toggles children; caller must pass `children`
 *   children            — rendered when expanded and expandable
 *   rightBadge          — optional node rendered on the right (e.g. "3 tool calls ▸")
 *   active              — highlight as the focused row (from activeTodoId)
 */
export default function TodoItem({
  todo,
  indent = 24,
  onClick = null,
  expandable = false,
  children = null,
  rightBadge = null,
  active = false,
}) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const status = todo.status || 'pending'
  const config = todoStatusConfig[status] || todoStatusConfig.pending
  const Icon = config.icon
  const label = todo.content || todo.text || todo.description || ''

  const handleClick = (e) => {
    if (expandable) setExpanded((v) => !v)
    if (onClick) onClick(e)
  }

  const isInteractive = expandable || !!onClick

  return (
    <div>
      <button
        type="button"
        aria-label={`${status}: ${label}`}
        className="quiet-toggle flex items-center gap-1 w-full text-xs"
        style={{
          background: active ? 'var(--bg-elevated)' : 'transparent',
          border: 'none',
          borderLeft: active ? '2px solid var(--purple)' : '2px solid transparent',
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: isInteractive ? 'pointer' : 'default',
          textAlign: 'left',
          transition: 'background 150ms ease, border-left-color 150ms ease',
          color: status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
        }}
        onClick={isInteractive ? handleClick : undefined}
        onMouseEnter={(e) => { if (isInteractive && !active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
        aria-expanded={expandable ? expanded : undefined}
        aria-controls={expandable ? bodyId : undefined}
      >
        {expandable ? (
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={10} strokeWidth={1.5} />
          </AnimatedChevron>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <Icon
          size={12}
          strokeWidth={1.5}
          style={{ color: config.color, flexShrink: 0 }}
          className={config.spinning ? 'icon-running' : ''}
          aria-label={status}
        />
        <span
          className="min-w-0 flex-1"
          style={{
            wordBreak: 'break-word',
            textDecoration: status === 'completed' ? 'line-through' : 'none',
          }}
        >
          {label}
        </span>
        {rightBadge && (
          <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {rightBadge}
          </span>
        )}
      </button>
      <AnimatedCollapse open={expandable && expanded} id={bodyId} animateHeight={false}>
        {() => children}
      </AnimatedCollapse>
    </div>
  )
}
