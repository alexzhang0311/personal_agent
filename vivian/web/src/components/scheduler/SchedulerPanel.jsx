import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, PanelLeftClose, PanelLeft, Settings, Pause, Play, Zap, Edit3, Trash2, ChevronDown, Globe, Terminal, Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSchedulerStore from '../../stores/schedulerStore'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'
import useToastStore from '../../stores/toastStore'
import SidebarResizer from '../layout/SidebarResizer'
import SettingsPopover from '../settings/SettingsPopover'
import RunHistoryTable from './RunHistoryTable'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import { formatDateTime } from '../../utils/formatTime'

const JobForm = lazy(() => import('./JobForm'))
const RunDetailDrawer = lazy(() => import('./RunDetailDrawer'))

const statusColor = {
  active: 'var(--green)',
  paused: 'var(--yellow)',
}

const jobTypeInfo = {
  scheduled_agent: { icon: Bot, label: 'agentRun', color: 'var(--purple)' },
  http_call: { icon: Globe, label: 'httpCall', color: 'var(--cyan)' },
  user_script: { icon: Terminal, label: 'userScript', color: 'var(--orange)' },
}

function getJobType(job) {
  const t = job.job_config?.job_type
  if (t === 'agent_run') return 'scheduled_agent'
  return t || 'scheduled_agent'
}

function triggerSummary(trigger) {
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

function formatNextRun(iso) {
  if (!iso) return '-'
  try {
    return formatDateTime(iso)
  } catch {
    return iso
  }
}

export default function SchedulerPanel() {
  const { t } = useTranslation()
  const [selectedRun, setSelectedRun] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const limit = 50

  const fetchJobs = useSchedulerStore((s) => s.fetchJobs)
  const fetchRunning = useSchedulerStore((s) => s.fetchRunning)
  const fetchHealth = useSchedulerStore((s) => s.fetchHealth)
  const fetchJobHistory = useSchedulerStore((s) => s.fetchJobHistory)
  const reloadJobs = useSchedulerStore((s) => s.reloadJobs)
  const setFormOpen = useSchedulerStore((s) => s.setFormOpen)
  const setEditingJob = useSchedulerStore((s) => s.setEditingJob)
  const health = useSchedulerStore((s) => s.health)
  const jobs = useSchedulerStore((s) => s.jobs)
  const jobsLoading = useSchedulerStore((s) => s.jobsLoading)
  const selectedJobId = useSchedulerStore((s) => s.selectedJobId)
  const setSelectedJobId = useSchedulerStore((s) => s.setSelectedJobId)
  const pauseJob = useSchedulerStore((s) => s.pauseJob)
  const resumeJob = useSchedulerStore((s) => s.resumeJob)
  const triggerJob = useSchedulerStore((s) => s.triggerJob)
  const deleteJob = useSchedulerStore((s) => s.deleteJob)
  const runHistory = useSchedulerStore((s) => s.runHistory)
  const runHistoryTotal = useSchedulerStore((s) => s.runHistoryTotal)
  const historyCursorStack = useSchedulerStore((s) => s.historyCursorStack)
  const historyNextCursor = useSchedulerStore((s) => s.historyNextCursor)
  const historyNext = useSchedulerStore((s) => s.historyNext)
  const historyPrev = useSchedulerStore((s) => s.historyPrev)
  const resetHistoryCursors = useSchedulerStore((s) => s.resetHistoryCursors)
  const formOpen = useSchedulerStore((s) => s.formOpen)

  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)
  const effectiveWidth = collapsed ? 48 : width

  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  // Auto-refresh
  const intervalRef = useRef(null)
  useEffect(() => {
    fetchJobs()
    fetchRunning()
    fetchHealth()
    intervalRef.current = setInterval(() => {
      fetchRunning()
      fetchHealth()
      const state = useSchedulerStore.getState()
      if (state.selectedJobId && state.historyCursorStack.length === 1) {
        // Only auto-refresh the newest page to avoid disturbing pagination.
        state.fetchJobHistory(state.selectedJobId, { limit })
      }
    }, 5000)
    return () => clearInterval(intervalRef.current)
  }, [])

  // Reset cursors and fetch when the selected job changes
  useEffect(() => {
    // Always drop a pending delete confirmation — leaving it armed would
    // delete whichever job the user selects next.
    setConfirmDelete(false)
    if (selectedJobId) {
      resetHistoryCursors()
      setSelectedRun(null)
    }
  }, [selectedJobId])

  // Refetch whenever the cursor stack changes (initial, next, prev)
  useEffect(() => {
    if (selectedJobId) {
      fetchJobHistory(selectedJobId, { limit })
    }
  }, [selectedJobId, historyCursorStack])

  const handleDelete = async () => {
    if (!selectedJob) return
    await deleteJob(selectedJob.id)
    setConfirmDelete(false)
    setSelectedJobId(null)
  }

  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const pushToast = useToastStore((s) => s.pushToast)
  const handleTrigger = (job) => {
    showConfirmDialog({
      title: t('scheduler.confirmTriggerTitle'),
      message: t('scheduler.confirmTriggerMessage', { name: job.name, status: job.status }),
      confirmLabel: t('scheduler.confirmTriggerConfirm'),
      onConfirm: async () => {
        try {
          await triggerJob(job.id)
          fetchRunning()
        } catch (err) {
          pushToast({
            level: 'error',
            title: t('scheduler.triggerFailed'),
            body: String(err?.message || err),
          })
        }
      },
    })
  }

  return (
    <>
      {/* LEFT: Sidebar — job list + job detail */}
      <aside
        className="fixed flex flex-col overflow-hidden"
        style={{
          width: effectiveWidth,
          top: 'var(--navbar-height)',
          left: 0,
          bottom: 0,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 p-2 flex-1">
            <button
              style={{
                width: 32, height: 32,
                background: 'transparent', border: 'none',
                borderRadius: '4px', cursor: 'pointer',
                color: 'var(--blue)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onClick={() => setFormOpen(true)}
              title={t('scheduler.newJob')}
            >
              <Plus size={16} strokeWidth={1.5} />
            </button>
            <div style={{ height: 1, background: 'var(--border-subtle)', width: '100%' }} />
            <div className="flex flex-col items-center gap-1 flex-1 overflow-y-auto">
              {jobs.map((job) => {
                const isActive = job.id === selectedJobId
                return (
                  <button
                    key={job.id}
                    style={{
                      width: 32, height: 32,
                      background: 'transparent', border: 'none',
                      borderLeft: isActive ? '2px solid var(--blue)' : `2px solid ${statusColor[job.status] || 'var(--border)'}`,
                      borderRadius: '4px', cursor: 'pointer',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 600,
                      transition: 'color 150ms ease',
                    }}
                    onClick={() => setSelectedJobId(job.id)}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-dim)' }}
                    title={job.name}
                  >
                    {job.name.charAt(0).toUpperCase()}
                  </button>
                )
              })}
            </div>
            <div className="relative flex flex-col items-center gap-1">
              <SettingsPopover />
              <button
                style={{
                  width: 32, height: 32,
                  background: 'transparent', border: 'none',
                  borderRadius: '4px', cursor: 'pointer',
                  color: 'var(--text-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 150ms ease',
                }}
                onClick={toggleSettingsPopover}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                title={t('sidebar.settings')}
              >
                <Settings size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header — scheduler health shown as a status left border (no dots) */}
            <div
              className="px-3 py-3 flex items-center justify-between flex-shrink-0"
              style={{
                color: 'var(--text-dim)',
                fontSize: 13,
                borderLeft: health
                  ? `2px solid ${health.healthy ? 'var(--green)' : 'var(--red)'}`
                  : '2px solid transparent',
              }}
              title={health ? (health.healthy ? t('scheduler.healthy') : t('scheduler.unhealthy')) : undefined}
            >
              <span className="uppercase font-semibold" style={{ letterSpacing: '0.06em' }}>
                {t('scheduler.title')}
              </span>
            </div>

            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />

            {/* + New Job */}
            <div className="px-3 py-2 flex-shrink-0">
              <button
                className="flex items-center justify-center gap-1 w-full py-1 text-sm"
                style={{
                  background: 'var(--blue)',
                  color: 'var(--text-inverse)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'opacity 150ms ease',
                }}
                onClick={() => setFormOpen(true)}
              >
                <Plus size={14} strokeWidth={1.5} />
                {t('scheduler.newJob')}
              </button>
            </div>

            {/* Job list + selected job detail */}
            <div className="flex-1 overflow-y-auto">
              {jobsLoading ? (
                <div className="flex flex-col gap-1 p-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="skeleton" style={{ height: 40, borderRadius: 2 }} />
                  ))}
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('scheduler.noJobs')}</span>
                </div>
              ) : (
                jobs.map((job) => {
                  const isActive = job.id === selectedJobId
                  const bodyId = `scheduler-job-${job.id}`
                  return (
                    <div key={job.id}>
                      {/* Job row */}
                      <button
                        type="button"
                        className="flex items-center px-3 py-2 gap-2"
                        style={{
                          background: isActive ? 'var(--bg-elevated)' : 'transparent',
                          borderLeft: isActive
                            ? '2px solid var(--blue)'
                            : `2px solid ${statusColor[job.status] || 'var(--border)'}`,
                          cursor: 'pointer',
                          transition: 'background 150ms ease',
                          borderTop: 'none',
                          borderRight: 'none',
                          borderBottom: 'none',
                          width: '100%',
                          textAlign: 'left',
                        }}
                        onClick={() => setSelectedJobId(isActive ? null : job.id)}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                        aria-expanded={isActive}
                        aria-controls={bodyId}
                      >
                        {/* Chevron */}
                        <div className="flex-shrink-0" style={{ color: 'var(--text-dim)', width: 12 }}>
                          <AnimatedChevron open={isActive}>
                            <ChevronDown size={12} strokeWidth={1.5} />
                          </AnimatedChevron>
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                              {job.name}
                            </span>
                            <span
                              className="text-xs uppercase font-semibold flex-shrink-0"
                              style={{ color: statusColor[job.status], letterSpacing: '0.06em', fontSize: 10 }}
                            >
                              {job.status}
                            </span>
                          </div>
                          <span
                            className="text-xs truncate"
                            style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 11 }}
                          >
                            {triggerSummary(job.trigger)}
                          </span>
                        </div>
                      </button>

                      {/* Inline job detail (expanded when active) */}
                      <AnimatedCollapse
                        open={isActive}
                        id={bodyId}
                        style={{ background: 'var(--bg-elevated)', borderLeft: '2px solid var(--blue)' }}
                      >
                            <div className="flex flex-col gap-2 px-3 pb-2 pt-1">
                              {/* Job type badge */}
                              <JobTypeBadge job={job} t={t} />

                              {/* Config rows */}
                              <DetailRow label={t('scheduler.timezone')} value={job.timezone} />
                              <DetailRow label={t('scheduler.nextRun')} value={formatNextRun(job.next_run_time)} />

                              {/* Type-specific config */}
                              <JobConfigDetail job={job} t={t} />

                              {/* Actions */}
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {job.status === 'active' ? (
                                  <ActionBtn icon={Pause} label={t('scheduler.pause')} onClick={() => pauseJob(job.id)} />
                                ) : (
                                  <ActionBtn icon={Play} label={t('scheduler.resume')} onClick={() => resumeJob(job.id)} />
                                )}
                                <ActionBtn icon={Zap} label={t('scheduler.triggerNow')} color="var(--yellow)" onClick={() => handleTrigger(job)} />
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
                            </div>
                      </AnimatedCollapse>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {/* Bottom: Settings + Toggle */}
        <div
          className="p-2 flex items-center flex-shrink-0"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            justifyContent: collapsed ? 'center' : 'space-between',
          }}
        >
          {!collapsed && (
            <div className="relative">
              <SettingsPopover />
              <button
                className="flex items-center gap-2"
                style={{
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', color: 'var(--text-dim)',
                  padding: '4px 6px', borderRadius: '4px', fontSize: 13,
                  transition: 'color 150ms ease, background 150ms ease',
                }}
                onClick={toggleSettingsPopover}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-dim)'
                  e.currentTarget.style.background = 'transparent'
                }}
                title={t('sidebar.settings')}
              >
                <Settings size={14} strokeWidth={1.5} />
                <span>{t('sidebar.settings')}</span>
              </button>
            </div>
          )}
          <button
            style={{
              width: 28, height: 28,
              background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '4px',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onClick={toggleCollapsed}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            {collapsed
              ? <PanelLeft size={16} strokeWidth={1.5} />
              : <PanelLeftClose size={16} strokeWidth={1.5} />}
          </button>
        </div>

        {!collapsed && <SidebarResizer />}
      </aside>

      {/* Content area: run history (middle) + detail drawer (right) */}
      <div
        className="flex"
        style={{
          position: 'fixed',
          top: 'var(--navbar-height)',
          left: effectiveWidth,
          right: 0,
          bottom: 0,
          transition: 'left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        }}
      >
        {/* MIDDLE: Run history */}
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-base)', minWidth: 0 }}
        >
          {selectedJobId && selectedJob ? (
            <>
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                    {t('scheduler.runHistory')}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                    — {selectedJob.name}
                  </span>
                  {health?.history_retention_days > 0 && (
                    <span className="text-xs font-light" style={{ color: 'var(--text-dim)' }}>
                      ({t('scheduler.retentionHint', { days: health.history_retention_days })})
                    </span>
                  )}
                </div>
                <button
                  className="flex items-center gap-1 px-2 py-1 text-xs"
                  style={{
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                  }}
                  onClick={reloadJobs}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <RefreshCw size={12} strokeWidth={1.5} />
                  {t('scheduler.reload')}
                </button>
              </div>

              {/* Run history table */}
              <div className="flex-1 overflow-y-auto">
                <RunHistoryTable
                  runs={runHistory}
                  total={runHistoryTotal}
                  hasPrev={historyCursorStack.length > 1}
                  hasNext={!!historyNextCursor}
                  onPrev={historyPrev}
                  onNext={historyNext}
                  onRunClick={setSelectedRun}
                />
              </div>
            </>
          ) : (
            <div
              className="flex-1 flex items-center justify-center"
              style={{ color: 'var(--text-dim)', fontSize: 13 }}
            >
              {jobs.length === 0
                ? t('scheduler.noJobs')
                : t('scheduler.selectJob')}
            </div>
          )}
        </div>

        {/* RIGHT: Run detail drawer (inline, resizable) */}
        {selectedRun && (
          <Suspense fallback={null}>
            <RunDetailDrawer
              run={selectedRun}
              onClose={() => setSelectedRun(null)}
            />
          </Suspense>
        )}
      </div>

      {/* Modals */}
      {formOpen && (
        <Suspense fallback={null}>
          <JobForm />
        </Suspense>
      )}
    </>
  )
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
      onClick={(e) => { e.stopPropagation(); onClick() }}
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

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className="text-xs truncate"
        style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function JobTypeBadge({ job, t }) {
  const type = getJobType(job)
  const info = jobTypeInfo[type] || jobTypeInfo.scheduled_agent
  const Icon = info.icon
  return (
    <div className="flex items-center gap-1">
      <Icon size={12} strokeWidth={1.5} style={{ color: info.color }} />
      <span
        className="text-xs uppercase font-semibold"
        style={{ color: info.color, letterSpacing: '0.06em', fontSize: 10 }}
      >
        {t(`scheduler.${info.label}`)}
      </span>
    </div>
  )
}

function JobConfigDetail({ job, t }) {
  const type = getJobType(job)
  const jc = job.job_config

  const codeBlockStyle = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
    maxHeight: 100,
    overflowY: 'auto',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    fontSize: 11,
  }

  if (type === 'scheduled_agent') {
    const prompt = jc?.prompt || job.prompt
    const model = jc?.model || job.model
    return (
      <>
        <DetailRow label={t('scheduler.model')} value={model || t('scheduler.defaultModel')} />
        <div className="text-xs p-2 mt-1" style={codeBlockStyle}>{prompt}</div>
      </>
    )
  }

  if (type === 'http_call' && jc) {
    return (
      <>
        <DetailRow label={t('scheduler.httpMethod')} value={jc.method || 'GET'} />
        <DetailRow label={t('scheduler.httpUrl')} value={jc.url || ''} />
        {jc.headers && Object.keys(jc.headers).length > 0 && (
          <DetailRow label={t('scheduler.httpHeaders')} value={Object.entries(jc.headers).map(([k, v]) => `${k}: ${v}`).join(', ')} />
        )}
        <DetailRow label={t('scheduler.timeout')} value={`${jc.timeout_seconds || 30}s`} />
        {jc.body && <div className="text-xs p-2 mt-1" style={codeBlockStyle}>{jc.body}</div>}
      </>
    )
  }

  if (type === 'user_script' && jc) {
    return (
      <>
        <DetailRow label={t('scheduler.scriptLanguage')} value={jc.language || 'python'} />
        <DetailRow label={t('scheduler.scriptSource')} value={jc.source === 'inline' ? t('scheduler.scriptInline') : t('scheduler.scriptFile')} />
        {jc.source === 'file' && jc.file_path && (
          <DetailRow label={t('scheduler.scriptFilePath')} value={jc.file_path} />
        )}
        <DetailRow label={t('scheduler.timeout')} value={`${jc.timeout_seconds || 300}s`} />
        {jc.source === 'inline' && jc.script && (
          <div className="text-xs p-2 mt-1" style={codeBlockStyle}>{jc.script}</div>
        )}
      </>
    )
  }

  // Fallback: legacy job with prompt
  return (
    <>
      <DetailRow label={t('scheduler.model')} value={job.model || t('scheduler.defaultModel')} />
      {job.prompt && <div className="text-xs p-2 mt-1" style={codeBlockStyle}>{job.prompt}</div>}
    </>
  )
}
