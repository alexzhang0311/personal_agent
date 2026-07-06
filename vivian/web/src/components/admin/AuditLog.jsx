import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { Search, ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import AuditCharts from './charts/AuditCharts'
import DateRangePicker from '../shared/DateRangePicker'
import CategoryDropdown from '../shared/CategoryDropdown'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const FILTER_CATEGORIES = [
  { value: '', labelKey: 'admin.filterAll', filterField: 'target' },
  { value: 'login', labelKey: 'admin.filterLogin', filterField: 'target' },
  { value: 'user', labelKey: 'admin.filterUser', filterField: 'target' },
  { value: 'session', labelKey: 'admin.filterSession', filterField: 'session_id' },
  { value: 'skill', labelKey: 'admin.filterSkill', filterField: 'target' },
  { value: 'tool', labelKey: 'admin.filterTool', filterField: 'target' },
  { value: '_actor', labelKey: 'admin.filterActor', filterField: 'actor' },
]

function getActionBorderColor(action) {
  if (action === 'login.success' || action === 'user.created') return 'var(--green)'
  if (action === 'login.failed' || action === 'user.deleted' || action === 'user.apikey_revoked') return 'var(--red)'
  if (action === 'user.role_changed' || action === 'user.password_reset') return 'var(--yellow)'
  if (action?.startsWith('tool.')) return 'var(--cyan)'
  if (action?.startsWith('skill.')) return 'var(--purple)'
  return 'var(--blue)'
}

function formatDescription(entry, t) {
  const { action, actor, target, details } = entry
  switch (action) {
    case 'login.success':
      return t('admin.auditLoginSuccess', { actor })
    case 'login.failed':
      return t('admin.auditLoginFailed', { target })
    case 'user.created':
      return t('admin.auditUserCreated', { actor, target, role: details?.role || 'user' })
    case 'user.deleted':
      return t('admin.auditUserDeleted', { actor, target })
    case 'user.role_changed':
      return t('admin.auditRoleChanged', { actor, target, oldRole: details?.old_role, newRole: details?.new_role })
    case 'user.password_reset':
      return t('admin.auditPasswordReset', { actor, target })
    case 'user.apikey_generated':
      return t('admin.auditApikeyGenerated', { actor, target })
    case 'user.apikey_revoked':
      return t('admin.auditApikeyRevoked', { actor, target })
    case 'session.deleted':
      return t('admin.auditSessionDeleted', { actor, target })
    default:
      return `${actor}: ${action}${target ? ` → ${target}` : ''}`
  }
}

function relativeTime(dateStr, t) {
  if (!dateStr) return ''
  const now = Date.now()
  const diff = now - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('admin.justNow')
  if (minutes < 60) return t('admin.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('admin.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('admin.daysAgo', { count: days })
}

function useDebouncedCallback(callback, delay) {
  const timerRef = useRef(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => callbackRef.current(...args), delay)
  }, [delay])
}

function EntrySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-1 px-4 py-3"
          style={{ borderLeft: '2px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="skeleton" style={{ width: 120, height: 11 }} />
            <div className="skeleton" style={{ width: 60, height: 11 }} />
          </div>
          <div className="skeleton" style={{ width: '70%', height: 13 }} />
        </div>
      ))}
    </div>
  )
}

function DetailsBlock({ details }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  if (!details || Object.keys(details).length === 0) return null

  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          padding: '2px 0',
          transition: 'color 150ms ease',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        details
      </button>
      <AnimatedCollapse open={expanded} id={bodyId}>
        <pre
          style={{
            background: 'var(--bg-elevated)',
            borderRadius: '2px',
            padding: '8px 12px',
            margin: '4px 0 0 0',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            color: 'var(--text-secondary)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(details, null, 2)}
        </pre>
      </AnimatedCollapse>
    </div>
  )
}

export default function AuditLog() {
  const { t } = useTranslation()
  const auditEntries = useAdminStore((s) => s.auditEntries)
  const auditNextCursor = useAdminStore((s) => s.auditNextCursor)
  const auditLoading = useAdminStore((s) => s.auditLoading)
  const auditActionFilter = useAdminStore((s) => s.auditActionFilter)
  const auditActorFilter = useAdminStore((s) => s.auditActorFilter)
  const auditTargetFilter = useAdminStore((s) => s.auditTargetFilter)
  const auditSessionFilter = useAdminStore((s) => s.auditSessionFilter)
  const fetchAuditLog = useAdminStore((s) => s.fetchAuditLog)
  const setAuditActionFilter = useAdminStore((s) => s.setAuditActionFilter)
  const setAuditActorFilter = useAdminStore((s) => s.setAuditActorFilter)
  const setAuditTargetFilter = useAdminStore((s) => s.setAuditTargetFilter)
  const setAuditSessionFilter = useAdminStore((s) => s.setAuditSessionFilter)
  const auditChartEntries = useAdminStore((s) => s.auditChartEntries)
  const auditChartLoading = useAdminStore((s) => s.auditChartLoading)
  const fetchAuditLogForCharts = useAdminStore((s) => s.fetchAuditLogForCharts)
  const auditStartTime = useAdminStore((s) => s.auditStartTime)
  const auditEndTime = useAdminStore((s) => s.auditEndTime)
  const setAuditTimeRange = useAdminStore((s) => s.setAuditTimeRange)

  // Determine which filter field the current category uses
  // _actor is a pseudo-value used only for the dropdown; it doesn't map to an action prefix
  const selectedCategory = auditActionFilter === '_actor' ? '_actor' : (auditActionFilter || '')
  const activeCategory = FILTER_CATEGORIES.find((c) => c.value === selectedCategory) || FILTER_CATEGORIES[0]
  const filterField = activeCategory.filterField // 'target' | 'session_id' | 'actor'

  const currentFilterValue = filterField === 'session_id' ? auditSessionFilter
    : filterField === 'actor' ? auditActorFilter
    : auditTargetFilter

  const [localValue, setLocalValue] = useState(currentFilterValue)

  const clearAllValueFilters = () => {
    setAuditTargetFilter('')
    setAuditSessionFilter('')
    setAuditActorFilter('')
  }

  const debouncedSetValue = useDebouncedCallback((v) => {
    clearAllValueFilters()
    if (filterField === 'session_id') setAuditSessionFilter(v)
    else if (filterField === 'actor') setAuditActorFilter(v)
    else setAuditTargetFilter(v)
  }, 300)

  // Sync local input when category changes
  useEffect(() => {
    setLocalValue(filterField === 'session_id' ? auditSessionFilter
      : filterField === 'actor' ? auditActorFilter
      : auditTargetFilter)
  }, [auditActionFilter])

  useEffect(() => { fetchAuditLog(false) }, [auditActionFilter, auditActorFilter, auditTargetFilter, auditSessionFilter, auditStartTime, auditEndTime])
  useEffect(() => { fetchAuditLogForCharts() }, [auditActionFilter, auditActorFilter, auditTargetFilter, auditSessionFilter, auditStartTime, auditEndTime])

  const hasMore = !!auditNextCursor

  const handleRefresh = () => {
    fetchAuditLog(false)
    fetchAuditLogForCharts()
  }

  return (
    <div className="flex flex-col gap-4" style={{ padding: '32px 56px' }}>
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)', margin: 0 }}>
          {t('admin.auditLog')}
        </h2>
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: auditLoading ? 'not-allowed' : 'pointer',
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            borderRadius: 4,
            transition: 'color 150ms ease',
          }}
          disabled={auditLoading}
          onClick={handleRefresh}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('scheduler.reload')}
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Shared filters — above both columns */}
      <div className="flex flex-col gap-3 flex-shrink-0" style={{ width: 'fit-content' }}>
        {/* Row 1: Time range */}
        <DateRangePicker
          startTime={auditStartTime}
          endTime={auditEndTime}
          onChange={(start, end) => setAuditTimeRange(start, end)}
        />

        {/* Row 2: FILTER BY [dropdown] : [value] */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs uppercase font-semibold flex-shrink-0"
            style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}
          >
            {t('admin.filterBy')}
          </span>

          {/* Category dropdown */}
          <CategoryDropdown
            options={FILTER_CATEGORIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
            selected={selectedCategory}
            onSelect={(val) => {
              setAuditActionFilter(val || null)
              clearAllValueFilters()
              setLocalValue('')
            }}
          />

          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dim)' }}>:</span>

          {/* Value input */}
          <div
            className="flex items-center gap-2 px-3 py-1"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              flex: 1,
            }}
          >
            <Search size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              className="flex-1"
              placeholder={
                filterField === 'session_id' ? t('admin.searchSession')
                : filterField === 'actor' ? t('admin.searchActor')
                : t('admin.searchTarget')
              }
              value={localValue}
              onChange={(e) => {
                setLocalValue(e.target.value)
                debouncedSetValue(e.target.value)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 13,
                minWidth: 0,
                padding: '2px 0',
              }}
            />
          </div>
        </div>
      </div>

      {/* Two-column: entries left, chart right */}
      <div className="flex gap-5" style={{ maxHeight: 'calc(100vh - var(--navbar-height) - 260px)', overflow: 'hidden' }}>
        {/* Left column: entries */}
        <div className="flex flex-col flex-1" style={{ minWidth: 0, overflowY: 'auto' }}>
          {auditLoading && auditEntries.length === 0 ? (
            <EntrySkeleton />
          ) : auditEntries.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--text-dim)', padding: '20px 0' }}>
              {t('admin.noAuditEntries')}
            </div>
          ) : (
            <div className="flex flex-col">
              {auditEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 px-4 py-3"
                  style={{
                    borderLeft: `2px solid ${getActionBorderColor(entry.action)}`,
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 150ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs uppercase"
                      style={{ color: getActionBorderColor(entry.action), letterSpacing: '0.06em' }}
                    >
                      {entry.action}
                    </span>
                    <span className="text-xs font-light" style={{ color: 'var(--text-dim)' }}>
                      {relativeTime(entry.timestamp, t)}
                    </span>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {formatDescription(entry, t)}
                  </span>
                  <DetailsBlock details={entry.details} />
                </div>
              ))}

              {/* Load more */}
              {hasMore && (
                <button
                  className="px-4 py-2 text-xs"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--blue)',
                    cursor: auditLoading ? 'not-allowed' : 'pointer',
                    opacity: auditLoading ? 0.5 : 1,
                    textAlign: 'center',
                    transition: 'opacity 150ms ease',
                  }}
                  disabled={auditLoading}
                  onClick={() => fetchAuditLog(true)}
                >
                  {auditLoading ? t('sidebar.loading') : t('sidebar.loadMore')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right column: chart */}
        <div className="flex-1" style={{ minWidth: 0, borderLeft: '1px solid var(--border)', paddingLeft: 20, overflowY: 'auto' }}>
          <AuditCharts entries={auditChartEntries} loading={auditChartLoading} />
        </div>
      </div>
    </div>
  )
}
