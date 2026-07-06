import { Pause, Play, Zap, Edit3, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSchedulerStore from '../../stores/schedulerStore'

const statusColor = {
  active: 'var(--green)',
  paused: 'var(--yellow)',
}

function triggerSummary(trigger) {
  if (!trigger) return '-'
  if (trigger.type === 'cron') {
    return `cron ${trigger.expr || '* * * * *'}`
  }
  if (trigger.type === 'interval') {
    const parts = []
    if (trigger.weeks) parts.push(`${trigger.weeks}w`)
    if (trigger.days) parts.push(`${trigger.days}d`)
    if (trigger.hours) parts.push(`${trigger.hours}h`)
    if (trigger.minutes) parts.push(`${trigger.minutes}m`)
    if (trigger.seconds) parts.push(`${trigger.seconds}s`)
    return `every ${parts.join(' ')}`
  }
  return trigger.type
}

function formatNextRun(iso) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function JobList() {
  const { t } = useTranslation()
  const jobs = useSchedulerStore((s) => s.jobs)
  const jobsLoading = useSchedulerStore((s) => s.jobsLoading)
  const setEditingJob = useSchedulerStore((s) => s.setEditingJob)
  const setSelectedJobId = useSchedulerStore((s) => s.setSelectedJobId)
  const deleteJob = useSchedulerStore((s) => s.deleteJob)
  const pauseJob = useSchedulerStore((s) => s.pauseJob)
  const resumeJob = useSchedulerStore((s) => s.resumeJob)
  const triggerJob = useSchedulerStore((s) => s.triggerJob)
  const [confirmDelete, setConfirmDelete] = useState(null)

  if (jobsLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
        ))}
      </div>
    )
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('scheduler.noJobs')}</span>
      </div>
    )
  }

  const handleDelete = async (jobId) => {
    await deleteJob(jobId)
    setConfirmDelete(null)
  }

  return (
    <div className="flex flex-col">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center gap-3 px-3 py-2"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            borderLeft: `2px solid ${statusColor[job.status] || 'var(--border)'}`,
            cursor: 'pointer',
            transition: 'background 150ms ease',
          }}
          onClick={() => setSelectedJobId(job.id)}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {job.name}
              </span>
              <span
                className="text-xs uppercase font-semibold flex-shrink-0"
                style={{ color: statusColor[job.status], letterSpacing: '0.06em' }}
              >
                {job.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                {triggerSummary(job.trigger)}
              </span>
              <span className="text-xs font-light" style={{ color: 'var(--text-dim)' }}>
                {t('scheduler.nextRun')}: {formatNextRun(job.next_run_time)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {job.status === 'active' ? (
              <IconBtn icon={Pause} title={t('scheduler.pause')} onClick={() => pauseJob(job.id)} />
            ) : (
              <IconBtn icon={Play} title={t('scheduler.resume')} onClick={() => resumeJob(job.id)} />
            )}
            <IconBtn icon={Zap} title={t('scheduler.triggerNow')} color="var(--yellow)" onClick={() => triggerJob(job.id)} />
            <IconBtn icon={Edit3} title={t('scheduler.edit')} onClick={() => setEditingJob(job)} />

            {confirmDelete === job.id ? (
              <div className="flex items-center gap-1">
                <button
                  className="px-2 py-1 text-xs"
                  style={{ background: 'var(--red)', color: 'var(--text-inverse)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
                  onClick={() => handleDelete(job.id)}
                >
                  {t('confirm.confirm')}
                </button>
                <button
                  className="px-2 py-1 text-xs"
                  style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '2px', cursor: 'pointer' }}
                  onClick={() => setConfirmDelete(null)}
                >
                  {t('confirm.cancel')}
                </button>
              </div>
            ) : (
              <IconBtn icon={Trash2} title={t('scheduler.delete')} color="var(--red)" onClick={() => setConfirmDelete(job.id)} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function IconBtn({ icon: Icon, title, color, onClick }) {
  return (
    <button
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-dim)',
        padding: 4,
        transition: 'color 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.color = color || 'var(--text-secondary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      title={title}
    >
      <Icon size={14} strokeWidth={1.5} />
    </button>
  )
}
