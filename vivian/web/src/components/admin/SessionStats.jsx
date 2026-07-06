import { useEffect, useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import Chip from '../shared/Chip'
import SessionCharts from './charts/SessionCharts'

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

function relativeTime(dateStr, t) {
  if (!dateStr) return t('admin.never')
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

function CardSkeleton() {
  return (
    <div className="flex gap-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 flex-1"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '16px 20px' }}
        >
          <div className="skeleton" style={{ width: 80, height: 11 }} />
          <div className="skeleton" style={{ width: 60, height: 20 }} />
        </div>
      ))}
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="skeleton" style={{ width: 100, height: 13 }} />
          <div className="skeleton" style={{ width: 56, height: 13 }} />
          <div className="skeleton" style={{ width: 60, height: 13 }} />
          <div className="skeleton" style={{ width: 80, height: 13 }} />
          <div className="skeleton" style={{ width: 80, height: 13 }} />
        </div>
      ))}
    </div>
  )
}

export default function SessionStats() {
  const { t } = useTranslation()
  const stats = useAdminStore((s) => s.stats)
  const statsLoading = useAdminStore((s) => s.statsLoading)
  const fetchStats = useAdminStore((s) => s.fetchStats)

  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => { fetchStats() }, [])

  const filteredUsers = useMemo(() => {
    if (!stats?.users) return []
    if (!searchQuery.trim()) return stats.users
    const q = searchQuery.trim().toLowerCase()
    return stats.users.filter((u) => u.username.toLowerCase().includes(q))
  }, [stats, searchQuery])

  return (
    <div className="flex flex-col gap-5" style={{ padding: '32px 56px' }}>
      <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)', margin: 0 }}>
        {t('admin.statistics')}
      </h2>

      {/* Summary cards */}
      {statsLoading ? (
        <CardSkeleton />
      ) : stats ? (
        <div className="flex gap-4">
          {[
            { label: t('admin.totalUsers'), value: stats.total_users },
            { label: t('admin.totalSessions'), value: stats.total_sessions },
            { label: t('admin.totalStorage'), value: formatBytes(stats.total_storage_bytes) },
          ].map((card) => (
            <div
              key={card.label}
              className="flex flex-col gap-1 flex-1"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '16px 20px',
              }}
            >
              <span
                className="text-xs uppercase"
                style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}
              >
                {card.label}
              </span>
              <span
                className="font-bold text-xl"
                style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
              >
                {card.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Two-column: table left, charts right */}
      <div className="flex gap-5" style={{ minHeight: 0 }}>
        {/* Left column: search + table */}
        <div className="flex flex-col gap-4 flex-1" style={{ minWidth: 0, overflow: 'hidden' }}>
          {/* Search bar */}
          {!statsLoading && stats && (
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                maxWidth: 320,
              }}
            >
              <Search size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                className="flex-1"
                placeholder={t('admin.searchUsers')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                }}
              />
            </div>
          )}

          {/* Per-user table */}
          {statsLoading ? (
            <TableSkeleton />
          ) : stats ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                className="flex items-center gap-4 px-4 py-2 text-xs uppercase"
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.06em',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ width: 140, flexShrink: 0 }}>{t('admin.username')}</span>
                <span style={{ width: 80, flexShrink: 0 }}>{t('admin.role')}</span>
                <span style={{ width: 100, flexShrink: 0 }}>{t('admin.sessions')}</span>
                <span style={{ width: 100, flexShrink: 0 }}>{t('admin.storage')}</span>
                <span style={{ flex: 1 }}>{t('admin.lastActive')}</span>
              </div>
              {filteredUsers.map((u) => (
                <div
                  key={u.username}
                  className="flex items-center gap-4 px-4 py-2"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 150ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: 'var(--text-primary)', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {u.username}
                  </span>
                  <span style={{ width: 80, flexShrink: 0 }}>
                    <Chip color={u.role === 'admin' ? 'var(--green)' : 'var(--text-secondary)'}>
                      {u.role.toUpperCase()}
                    </Chip>
                  </span>
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-primary)', width: 100, flexShrink: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
                  >
                    {u.session_count}
                  </span>
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)', width: 100, flexShrink: 0 }}
                  >
                    {formatBytes(u.storage_bytes)}
                  </span>
                  <span
                    className="text-xs font-light"
                    style={{ color: 'var(--text-dim)', flex: 1 }}
                  >
                    {relativeTime(u.last_active, t)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right column: charts */}
        <div className="flex-1" style={{ minWidth: 0, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
          <SessionCharts stats={stats} loading={statsLoading} />
        </div>
      </div>
    </div>
  )
}
