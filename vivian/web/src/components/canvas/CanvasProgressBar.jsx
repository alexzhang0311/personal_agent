import useTaskStore from '../../stores/taskStore'

export default function CanvasProgressBar() {
  const tasks = useTaskStore((s) => s.tasks)
  const todos = useTaskStore((s) => s.todos)

  const taskTotal = Object.keys(tasks).length
  const taskCompleted = Object.values(tasks).filter(
    (t) => t.status === 'success' || t.status === 'completed'
  ).length
  const hasError = Object.values(tasks).some((t) => t.status === 'error')

  const todoTotal = todos ? todos.length : 0
  const todoCompleted = todos ? todos.filter((t) => t.status === 'completed').length : 0

  const total = taskTotal + todoTotal
  const completed = taskCompleted + todoCompleted

  if (total === 0) return null

  const pct = (completed / total) * 100

  return (
    <div
      className="flex-shrink-0"
      style={{
        height: 2,
        background: 'var(--bg-elevated)',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: hasError ? 'var(--red)' : 'var(--green)',
          transition: 'width 400ms ease',
        }}
      />
    </div>
  )
}
