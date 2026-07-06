import { useState } from 'react'
import { Square, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSchedulerStore from '../../stores/schedulerStore'
import RunOutputDrawer from './RunOutputDrawer'

function formatElapsed(ms) {
  if (!ms) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export default function RunningTasksList() {
  const { t } = useTranslation()
  const runningTasks = useSchedulerStore((s) => s.runningTasks)
  const cancelRun = useSchedulerStore((s) => s.cancelRun)
  const fetchRunning = useSchedulerStore((s) => s.fetchRunning)
  const [viewingRunId, setViewingRunId] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(null)

  if (!runningTasks || runningTasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('scheduler.noRunning')}</span>
      </div>
    )
  }

  const handleCancel = async (runId) => {
    await cancelRun(runId)
    setConfirmCancel(null)
    setTimeout(() => fetchRunning(), 1000)
  }

  return (
    <>
      <div className="flex flex-col">
        {runningTasks.map((task) => (
          <div
            key={task.run_id}
            className="flex items-center gap-3 px-3 py-2"
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              borderLeft: '2px solid var(--status-running)',
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {task.job_name}
              </div>
              <div className="text-xs font-light" style={{ color: 'var(--text-secondary)' }}>
                {formatElapsed(task.elapsed_ms)} {t('scheduler.elapsed')}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: 4,
                  transition: 'color 150ms ease',
                }}
                onClick={() => setViewingRunId(task.run_id)}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                title={t('scheduler.viewOutput')}
              >
                <Eye size={14} strokeWidth={1.5} />
              </button>

              {confirmCancel === task.run_id ? (
                <div className="flex items-center gap-1">
                  <button
                    className="px-2 py-1 text-xs"
                    style={{
                      background: 'var(--red)',
                      color: 'var(--text-inverse)',
                      border: 'none',
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleCancel(task.run_id)}
                  >
                    {t('confirm.confirm')}
                  </button>
                  <button
                    className="px-2 py-1 text-xs"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setConfirmCancel(null)}
                  >
                    {t('confirm.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    padding: 4,
                    transition: 'color 150ms ease',
                  }}
                  onClick={() => setConfirmCancel(task.run_id)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  title={t('scheduler.cancel')}
                >
                  <Square size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewingRunId && (
        <RunOutputDrawer runId={viewingRunId} onClose={() => setViewingRunId(null)} />
      )}
    </>
  )
}
