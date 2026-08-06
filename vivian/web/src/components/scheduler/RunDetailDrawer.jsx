import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ExternalLink, Copy, Check, RefreshCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRunOutput } from '../../api/scheduler'
import { copyTextToClipboard } from '../../utils/clipboard'
import { useResizable } from '../../hooks/useResizable'
import useUiStore from '../../stores/uiStore'
import useChatStore from '../../stores/chatStore'
import useSidebarStore from '../../stores/sidebarStore'
import useToastStore from '../../stores/toastStore'
import useTaskStore from '../../stores/taskStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { fetchSchedulerConversation } from '../../utils/schedulerConversation'
import RunEventRenderer from './RunEventRenderer'
import safeStorage from '../../utils/safeStorage'

const STORAGE_KEY = 'scheduler-drawer-width'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 280
const MAX_WIDTH_VW = 0.6

const statusColor = {
  running: 'var(--status-running)',
  success: 'var(--status-success)',
  error: 'var(--status-error)',
  cancelled: 'var(--status-error)',
  skipped: 'var(--border-strong)',
}

function formatDuration(ms) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatTime(iso) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function readPersistedWidth() {
  return safeStorage.getNumber(STORAGE_KEY, DEFAULT_WIDTH, {
    min: MIN_WIDTH,
    max: window.innerWidth * MAX_WIDTH_VW,
  })
}

export default function RunDetailDrawer({ run, onClose }) {
  const { t } = useTranslation()
  const [drawerWidth, setDrawerWidth] = useState(readPersistedWidth)
  const [events, setEvents] = useState([])
  const [sessionId, setSessionId] = useState(run.session_id || null)
  const [polling, setPolling] = useState(run.status === 'running')
  const [copiedField, setCopiedField] = useState(null)
  const [openingSession, setOpeningSession] = useState(false)
  const containerRef = useRef(null)
  const intervalRef = useRef(null)
  const offsetRef = useRef(0)

  const setActiveNavTab = useUiStore((s) => s.setActiveNavTab)
  const loadSession = useChatStore((s) => s.loadSession)
  const pushToast = useToastStore((s) => s.pushToast)

  // Persist width
  const handleResize = useCallback((w) => {
    setDrawerWidth(w)
    safeStorage.setItem(STORAGE_KEY, String(w))
  }, [])

  const maxWidth = Math.round(window.innerWidth * MAX_WIDTH_VW)
  const { dragging, onMouseDown } = useResizable({
    initial: drawerWidth,
    min: MIN_WIDTH,
    max: maxWidth,
    direction: 'left',
    onResize: handleResize,
  })

  // Fetch run output (reset + poll in one effect to avoid race conditions)
  useEffect(() => {
    if (!run.run_id) return
    let cancelled = false

    // Reset state for new run
    setEvents([])
    offsetRef.current = 0
    setSessionId(run.session_id || null)
    const shouldPoll = run.status === 'running'
    setPolling(shouldPoll)

    const poll = async () => {
      try {
        const data = await getRunOutput(run.run_id, offsetRef.current)
        if (cancelled) return
        if (data.events && data.events.length > 0) {
          setEvents((prev) => [...prev, ...data.events])
          offsetRef.current = data.offset

          for (const ev of data.events) {
            if (ev.event === 'result' && ev.data?.session_id) {
              setSessionId(ev.data.session_id)
            }
          }

          if (data.events.some((e) => e.event === 'result')) {
            setPolling(false)
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
          }
        }
      } catch {
        if (!cancelled) setPolling(false)
      }
    }

    poll()
    if (shouldPoll) {
      intervalRef.current = setInterval(poll, 2000)
    }

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [run.run_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events])

  const handleViewConversation = async () => {
    const targetSessionId = sessionId || run.session_id
    if (!targetSessionId || openingSession) return

    setOpeningSession(true)
    try {
      const transformed = await fetchSchedulerConversation(targetSessionId)
      const sidebar = useSidebarStore.getState()
      const ui = useUiStore.getState()
      const taskStore = useTaskStore.getState()
      const fileOpsStore = useFileOpsStore.getState()
      const fileBrowserStore = useFileBrowserStore.getState()

      if (sidebar.sessionQuery) sidebar.setSessionQuery('')
      if (sidebar.sessionKind !== 'scheduler') sidebar.setSessionKind('scheduler')
      taskStore.clearTasks()
      fileOpsStore.clearFileOps()
      fileBrowserStore.clear()
      for (const task of transformed.tasks) taskStore.addTask(task)
      for (const fileOp of transformed.fileOps) fileOpsStore.addFileOp(fileOp)
      fileBrowserStore.setTabs(transformed.fileBrowserTabs)
      sidebar.setActiveSessionId(targetSessionId)
      ui.clearPlanContent()
      ui.hideCanvas()
      loadSession(targetSessionId, transformed.messages, null, transformed.subagentContent)
      setActiveNavTab('vivian')
    } catch (error) {
      pushToast({
        level: 'error',
        title: t('scheduler.sessionLoadFailed'),
        body: String(error?.message || error),
      })
    } finally {
      setOpeningSession(false)
    }
  }

  const handleCopy = (text, field) => {
    copyTextToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 800)
  }

  const effectiveSessionId = sessionId || run.session_id

  return (
    <div
      className="flex flex-col overflow-hidden flex-shrink-0"
      style={{
        width: drawerWidth,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        position: 'relative',
        transition: dragging ? 'none' : 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Resize handle — left edge */}
      <div
        onMouseDown={onMouseDown}
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
        onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = 'var(--blue)' }}
        onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent' }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {t('scheduler.runDetail')}
          </span>
          {polling && (
            <span className="text-xs uppercase font-semibold" style={{ color: 'var(--purple)', letterSpacing: '0.06em' }}>
              {t('scheduler.live')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setEvents([])
              offsetRef.current = 0
              setPolling(true)
            }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('scheduler.reload')}
          >
            <RefreshCcw size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Run metadata */}
      <div className="flex flex-col gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <MetaRow label={t('scheduler.status')}>
          <span
            className="text-xs uppercase font-semibold"
            style={{ color: statusColor[run.status] || 'var(--text-secondary)', letterSpacing: '0.06em' }}
          >
            {run.status}
          </span>
        </MetaRow>
        <MetaRow label={t('scheduler.startedAt')}>
          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{formatTime(run.started_at)}</span>
        </MetaRow>
        {run.finished_at && (
          <MetaRow label={t('scheduler.finishedAt')}>
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{formatTime(run.finished_at)}</span>
          </MetaRow>
        )}
        <MetaRow label={t('scheduler.duration')}>
          <span className="text-xs" style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
            {formatDuration(run.duration_ms)}
          </span>
        </MetaRow>
        <MetaRow label={t('scheduler.turns')}>
          <span className="text-xs" style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
            {run.num_turns ?? '-'}
          </span>
        </MetaRow>

        {/* Session ID */}
        {effectiveSessionId && (
          <MetaRow label="Session">
            <div className="flex items-center gap-1 min-w-0">
              <span
                className="text-xs truncate"
                style={{ color: 'var(--cyan)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
                title={effectiveSessionId}
              >
                {effectiveSessionId}
              </span>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0, color: copiedField === 'session' ? 'var(--green)' : 'var(--text-dim)', transition: 'color 150ms ease' }}
                onClick={() => handleCopy(effectiveSessionId, 'session')}
                title="Copy"
              >
                {copiedField === 'session' ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
          </MetaRow>
        )}

        {/* Error message */}
        {run.error_message && (
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--red)' }}>Error</span>
            <div
              className="text-xs p-2"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '2px',
                color: 'var(--red)',
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                maxHeight: 80,
                overflowY: 'auto',
              }}
            >
              {run.error_message}
            </div>
          </div>
        )}

        {/* View Conversation button */}
        {effectiveSessionId && (
          <button
            className="flex items-center justify-center gap-2 w-full py-2 mt-1 text-xs"
            style={{
              background: 'var(--blue)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: '2px',
              cursor: openingSession ? 'default' : 'pointer',
              opacity: openingSession ? 0.7 : 1,
              transition: 'opacity 150ms ease',
            }}
            onClick={handleViewConversation}
            disabled={openingSession}
            onMouseEnter={(e) => { if (!openingSession) e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={(e) => { if (!openingSession) e.currentTarget.style.opacity = '1' }}
          >
            <ExternalLink size={12} strokeWidth={1.5} />
            {t(openingSession ? 'scheduler.openingConversation' : 'scheduler.viewConversation')}
          </button>
        )}
      </div>

      {/* Response / Output */}
      <div className="flex items-center px-4 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
          {t('scheduler.runOutput')}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3"
        style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 12 }}
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ color: 'var(--text-dim)' }}>{t('scheduler.noOutput')}</span>
          </div>
        ) : (
          <RunEventRenderer events={events} />
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
}
