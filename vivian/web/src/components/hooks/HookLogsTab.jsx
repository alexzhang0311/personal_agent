import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import useHooksStore from '../../stores/hooksStore'
import { HOOK_DEFINITIONS } from '../../data/hookDefinitions'
import { formatTimeOfDay } from '../../utils/formatTime'

const PAGE_SIZE = 50

const labelStyle = {
  fontSize: 11,
  color: 'var(--text-dim)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const TYPE_SHORT = {
  command: 'CMD',
  http: 'HTTP',
  prompt: 'PRMT',
  agent: 'AGNT',
  process: 'PROC',
}

function formatTime(ts) {
  return formatTimeOfDay(ts)
}

function LogsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="skeleton" style={{ width: 55, height: 12 }} />
          <div className="skeleton" style={{ width: 90, height: 12 }} />
          <div className="skeleton" style={{ width: 40, height: 12 }} />
          <div className="skeleton" style={{ width: 24, height: 12 }} />
          <div className="skeleton" style={{ width: 50, height: 12 }} />
        </div>
      ))}
    </div>
  )
}

export default function HookLogsTab({ hookId }) {
  const { t } = useTranslation()
  const logs = useHooksStore((s) => s.logs)
  const logsTotal = useHooksStore((s) => s.logsTotal)
  const logsLoading = useHooksStore((s) => s.logsLoading)
  const logsFilter = useHooksStore((s) => s.logsFilter)
  const logsCursorStack = useHooksStore((s) => s.logsCursorStack)
  const logsNextCursor = useHooksStore((s) => s.logsNextCursor)
  const loadLogs = useHooksStore((s) => s.loadLogs)
  const setLogsFilter = useHooksStore((s) => s.setLogsFilter)
  const logsNext = useHooksStore((s) => s.logsNext)
  const logsPrev = useHooksStore((s) => s.logsPrev)

  const [autoRefresh, setAutoRefresh] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const intervalRef = useRef(null)

  // All event IDs for filter dropdown
  const eventIds = HOOK_DEFINITIONS.map((h) => h.id)

  // Fetch logs on mount and when filter or cursor stack changes
  useEffect(() => {
    loadLogs(logsFilter, PAGE_SIZE)
  }, [logsFilter, logsCursorStack])

  // Auto-refresh — only when on the newest page, to avoid disturbing pagination
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        if (useHooksStore.getState().logsCursorStack.length === 1) {
          loadLogs(useHooksStore.getState().logsFilter, PAGE_SIZE)
        }
      }, 10000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh])

  const handleRefresh = () => {
    loadLogs(logsFilter, PAGE_SIZE)
  }

  const handleFilterChange = (eventType) => {
    setLogsFilter(eventType || null)
    setFilterOpen(false)
    // loadLogs triggered by useEffect
  }

  const hasPrev = logsCursorStack.length > 1
  const hasNext = !!logsNextCursor

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {/* Event filter dropdown */}
        <div className="relative flex-1">
          <button
            className="flex items-center gap-2 px-2 py-1 w-full"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: logsFilter ? 'var(--text-primary)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 12,
              textAlign: 'left',
            }}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <span className="flex-1 truncate">{logsFilter || t('hooks.allEvents')}</span>
            <ChevronDown size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
          </button>
          {filterOpen && (
            <div
              className="absolute w-full overflow-y-auto"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                zIndex: 10,
                top: '100%',
                marginTop: 2,
                maxHeight: 240,
              }}
            >
              <button
                className="w-full px-2 py-1"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: !logsFilter ? 'var(--blue)' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => handleFilterChange(null)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t('hooks.allEvents')}
              </button>
              {eventIds.map((eid) => (
                <button
                  key={eid}
                  className="w-full px-2 py-1"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: logsFilter === eid ? 'var(--blue)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    textAlign: 'left',
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    transition: 'background 150ms ease',
                  }}
                  onClick={() => handleFilterChange(eid)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {eid}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh button */}
        <button
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: '4px 6px',
            display: 'flex',
            alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onClick={handleRefresh}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('hooks.refresh')}
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>

        {/* Auto-refresh toggle */}
        <label
          className="flex items-center gap-1"
          style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ accentColor: 'var(--blue)' }}
          />
          {t('hooks.autoRefresh')}
        </label>
      </div>

      {/* Table header */}
      <div
        className="flex items-center gap-2 px-2 py-1"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span style={{ ...labelStyle, width: 60, flexShrink: 0 }}>{t('hooks.time')}</span>
        <span style={{ ...labelStyle, flex: 1, minWidth: 0 }}>{t('hooks.event')}</span>
        <span style={{ ...labelStyle, width: 42, flexShrink: 0, textAlign: 'center' }}>{t('hooks.type')}</span>
        <span style={{ ...labelStyle, width: 32, flexShrink: 0, textAlign: 'center' }}>{t('hooks.exit')}</span>
        <span style={{ ...labelStyle, width: 50, flexShrink: 0 }}>{t('hooks.tool')}</span>
      </div>

      {/* Table body */}
      {logsLoading ? (
        <LogsSkeleton />
      ) : logs.length === 0 ? (
        <div
          className="flex items-center justify-center py-6"
          style={{ color: 'var(--text-dim)', fontSize: 13 }}
        >
          {t('hooks.noLogs')}
        </div>
      ) : (
        <div className="flex flex-col">
          {logs.map((entry, i) => (
            <div key={i}>
              <div
                className="flex items-center gap-2 px-2 py-1"
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  transition: 'background 150ms ease',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Time */}
                <span style={{ width: 60, flexShrink: 0, fontSize: 12, fontWeight: 300, color: 'var(--text-dim)' }}>
                  {formatTime(entry.timestamp)}
                </span>

                {/* Event */}
                <span
                  className="truncate"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    color: 'var(--text-primary)',
                  }}
                >
                  {entry.event_type}
                </span>

                {/* Type chip */}
                <span
                  style={{
                    width: 42,
                    flexShrink: 0,
                    textAlign: 'center',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                  }}
                >
                  {TYPE_SHORT[entry.handler_type] || entry.handler_type?.toUpperCase()?.slice(0, 4) || '—'}
                </span>

                {/* Exit code */}
                <span
                  style={{
                    width: 32,
                    flexShrink: 0,
                    textAlign: 'center',
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    fontWeight: 600,
                    color: entry.exit_code === 0 ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {entry.exit_code ?? '—'}
                </span>

                {/* Tool */}
                <span
                  className="truncate"
                  style={{
                    width: 50,
                    flexShrink: 0,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    color: 'var(--text-secondary)',
                  }}
                >
                  {entry.tool_name || '—'}
                </span>
              </div>

              {/* Error row (indented) */}
              {entry.error && (
                <div
                  className="px-2 py-1"
                  style={{
                    paddingLeft: 68,
                    fontSize: 11,
                    color: 'var(--red)',
                    wordBreak: 'break-word',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {entry.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {(hasPrev || hasNext) && (
        <div
          className="flex items-center justify-between px-2 py-1"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {logsTotal != null && !logsFilter
              ? `${logsTotal} ${t('hooks.total', { defaultValue: 'total' })}`
              : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: hasPrev ? 'var(--text-secondary)' : 'var(--text-dim)',
                cursor: hasPrev ? 'pointer' : 'not-allowed',
                padding: '2px 6px',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                opacity: hasPrev ? 1 : 0.5,
                transition: 'opacity 150ms ease',
              }}
              disabled={!hasPrev}
              onClick={logsPrev}
            >
              <ChevronLeft size={12} strokeWidth={1.5} />
              {t('hooks.previous')}
            </button>
            <button
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: hasNext ? 'var(--text-secondary)' : 'var(--text-dim)',
                cursor: hasNext ? 'pointer' : 'not-allowed',
                padding: '2px 6px',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                opacity: hasNext ? 1 : 0.5,
                transition: 'opacity 150ms ease',
              }}
              disabled={!hasNext}
              onClick={logsNext}
            >
              {t('hooks.next')}
              <ChevronRight size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
