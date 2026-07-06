import { useId, useState } from 'react'
import { ChevronDown, ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useTaskStore from '../../stores/taskStore'
import TodoItem from '../shared/TodoItem'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

/**
 * Canvas inspector mirror for the current TodoWrite plan.
 * Renamed and refactored from the old TodoList. Clicking a todo sets
 * `activeTodoId` in taskStore so the corresponding message-flow TodoWrite
 * card scrolls into focus.
 */
export default function TodoInspector() {
  const { t } = useTranslation()
  const todos = useTaskStore((s) => s.todos)
  const todoWriteInfo = useTaskStore((s) => s.todoWriteInfo)
  const activeTodoId = useTaskStore((s) => s.activeTodoId)
  const setActiveTodoId = useTaskStore((s) => s.setActiveTodoId)
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId)
  const [sectionExpanded, setSectionExpanded] = useState(true)
  const bodyId = useId()

  if ((!todos || todos.length === 0) && !todoWriteInfo) return null

  const total = todos ? todos.length : 0
  const done = todos ? todos.filter((tt) => tt.status === 'completed').length : 0

  return (
    <div className="py-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <button
        className="quiet-toggle flex items-center gap-1 w-full px-3 py-1"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', textAlign: 'left',
        }}
        onClick={() => setSectionExpanded(!sectionExpanded)}
        aria-expanded={sectionExpanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={sectionExpanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        <ListTodo size={12} strokeWidth={1.5} />
        <span className="flex-1">{t('todo.todoList') || 'TODO'}</span>
        {total > 0 && (
          <span className="font-light" style={{ letterSpacing: 0 }}>
            {done}/{total}
          </span>
        )}
      </button>

      <AnimatedCollapse open={sectionExpanded && Boolean(todos)} id={bodyId} animateHeight={false}>
        {() => todos && todos.map((todo, i) => {
          const todoKey = todo.id != null ? String(todo.id) : `idx-${i}`
          const active = activeTodoId === todoKey
          return (
            <TodoItem
              key={todoKey}
              todo={todo}
              indent={20}
              active={active}
              onClick={() => {
                setActiveTodoId(todoKey)
                // Bring the latest TodoWrite call-site into view in the message
                // flow so the user sees the inline plan update its context.
                if (todoWriteInfo?.tool_use_id) setActiveTaskId(todoWriteInfo.tool_use_id)
              }}
            />
          )
        })}
      </AnimatedCollapse>
    </div>
  )
}
