import { useState } from 'react'
import { Pause, Play, Zap, Edit3, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSchedulerStore from '../../stores/schedulerStore'
import { formatDateTime } from '../../utils/formatTime'

export default function JobDetail() {
  const { t } = useTranslation()
  const selectedJobId = useSchedulerStore((s) => s.selectedJobId)
  const jobs = useSchedulerStore((s) => s.jobs)
  const pauseJob = useSchedulerStore((s) => s.pauseJob)
  const resumeJob = useSchedulerStore((s) => s.resumeJob)
  const triggerJob = useSchedulerStore((s) => s.triggerJob)
  const deleteJob = useSchedulerStore((s) => s.deleteJob)
  const setEditingJob = useSchedulerStore((s) => s.setEditingJob)
  const setSelectedJobId = useSchedulerStore((s) => s.setSelectedJobId)

  const [confirmDelete, setConfirmDelete] = useState(false)

  const job = jobs.find((j) => j.id === selectedJobId)
  if (!selectedJobId || !job) return null

  const handleDelete = async () => {
    await deleteJob(job.id)
    setConfirmDelete(false)
    setSelectedJobId(null)
  }

  return (
    <div
      className="flex flex-col overflow-hidden flex-shrink-0"
      style={{
        width: 340,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
          {job.name}
        </span>
        <span
          className="text-xs uppercase font-semibold flex-shrink-0"
          style={{
            color: job.status === 'active' ? 'var(--green)' : 'var(--yellow)',
            letterSpacing: '0.06em',
          }}
        >
          {job.status}
        </span>
      </div>

      {/* Action buttons */}
      <div
        className="flex items-center gap-1 px-4 py-2 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {job.status === 'active' ? (
          <ActionBtn icon={Pause} label={t('scheduler.pause')} onClick={() => pauseJob(job.id)} />
        ) : (
          <ActionBtn icon={Play} label={t('scheduler.resume')} onClick={() => resumeJob(job.id)} />
        )}
        <ActionBtn icon={Zap} label={t('scheduler.triggerNow')} color="var(--yellow)" onClick={() => triggerJob(job.id)} />
        <ActionBtn icon={Edit3} label={t('scheduler.edit')} onClick={() => setEditingJob(job)} />

        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 text-xs"
              style={{ background: 'var(--red)', color: 'var(--text-inverse)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
              onClick={handleDelete}
            >
              {t('confirm.confirm')}
            </button>
            <button
              className="px-2 py-1 text-xs"
              style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '2px', cursor: 'pointer' }}
              onClick={() => setConfirmDelete(false)}
            >
              {t('confirm.cancel')}
            </button>
          </div>
        ) : (
          <ActionBtn icon={Trash2} label={t('scheduler.delete')} color="var(--red)" onClick={() => setConfirmDelete(true)} />
        )}
      </div>

      {/* Job details — scrollable */}
      <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
        <DetailRow label={t('scheduler.trigger', 'Trigger')} value={triggerLabel(job.trigger)} mono />
        <DetailRow label={t('scheduler.timezone')} value={job.timezone} mono />
        <DetailRow
          label={t('scheduler.nextRun')}
          value={job.next_run_time ? formatDateTime(job.next_run_time) : '-'}
        />
        <DetailRow label={t('scheduler.model')} value={job.model || t('scheduler.defaultModel', 'default')} mono />
        <DetailRow
          label={t('scheduler.createdAt', 'Created')}
          value={job.created_at ? formatDateTime(job.created_at) : '-'}
        />

        {/* Prompt */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
            {t('scheduler.prompt')}
          </span>
          <div
            className="text-xs p-2 overflow-y-auto"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '2px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              maxHeight: 200,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {job.prompt}
          </div>
        </div>
      </div>
    </div>
  )
}

function triggerLabel(trigger) {
  if (!trigger) return '-'
  if (trigger.type === 'cron') return `cron ${trigger.expr || '* * * * *'}`
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

function ActionBtn({ icon: Icon, label, color, onClick }) {
  return (
    <button
      className="flex items-center gap-1 px-2 py-1 text-xs"
      style={{
        background: 'transparent',
        color: 'var(--text-dim)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '2px',
        cursor: 'pointer',
        transition: 'color 150ms ease, border-color 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = color || 'var(--text-secondary)'
        e.currentTarget.style.borderColor = color || 'var(--border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-dim)'
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
      }}
      title={label}
    >
      <Icon size={12} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className="text-xs truncate"
        style={{
          color: 'var(--text-primary)',
          fontFamily: mono ? "'JetBrains Mono', 'Source Han Mono SC', monospace" : undefined,
          textAlign: 'right',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
