import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { formatDateTime } from '../../utils/formatTime'

const statusColor = {
  running: 'var(--status-running)',
  success: 'var(--status-success)',
  error: 'var(--status-error)',
  cancelled: 'var(--status-error)',
  pending: 'var(--status-pending)',
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
    return formatDateTime(iso)
  } catch {
    return iso
  }
}

export default function RunHistoryTable({
  runs,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onRunClick,
}) {
  const { t } = useTranslation()

  if (!runs || runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('scheduler.noRuns')}</span>
      </div>
    )
  }

  const showPagination = hasPrev || hasNext
  const showTotal = total != null

  return (
    <div className="flex flex-col">
      {/* Table */}
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[t('scheduler.status'), t('scheduler.startedAt'), t('scheduler.duration'), t('scheduler.turns'), ''].map((h, i) => (
                <th
                  key={i}
                  className="text-xs font-semibold uppercase px-3 py-2"
                  style={{
                    color: 'var(--text-secondary)',
                    textAlign: 'left',
                    letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                    width: i === 4 ? 40 : undefined,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.run_id}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  transition: 'background 150ms ease',
                  cursor: onRunClick ? 'pointer' : undefined,
                }}
                onClick={() => onRunClick && onRunClick(run)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div style={{ width: 2, height: 16, background: statusColor[run.status] || 'var(--border)', borderRadius: 1 }} />
                    <span
                      className="text-xs uppercase font-semibold"
                      style={{ color: statusColor[run.status] || 'var(--text-secondary)', letterSpacing: '0.06em' }}
                    >
                      {run.status}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs font-light" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatTime(run.started_at)}</td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{formatDuration(run.duration_ms)}</td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                  {run.num_turns ?? '-'}
                </td>
                <td className="px-3 py-2">
                  {onRunClick && (
                    <Eye size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {showPagination && (
        <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {showTotal ? `${total} ${t('scheduler.totalRuns')}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              style={{
                background: 'transparent',
                border: 'none',
                cursor: hasPrev ? 'pointer' : 'default',
                color: hasPrev ? 'var(--text-secondary)' : 'var(--text-dim)',
                padding: 4,
                opacity: hasPrev ? 1 : 0.5,
                transition: 'opacity 150ms ease',
              }}
              onClick={() => hasPrev && onPrev && onPrev()}
              disabled={!hasPrev}
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
            </button>
            <button
              style={{
                background: 'transparent',
                border: 'none',
                cursor: hasNext ? 'pointer' : 'default',
                color: hasNext ? 'var(--text-secondary)' : 'var(--text-dim)',
                padding: 4,
                opacity: hasNext ? 1 : 0.5,
                transition: 'opacity 150ms ease',
              }}
              onClick={() => hasNext && onNext && onNext()}
              disabled={!hasNext}
            >
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
