import { useEffect } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useConnectionStore from '../../stores/connectionStore'

export default function ConnectionBanner() {
  const { t } = useTranslation()
  const state = useConnectionStore((s) => s.state)
  const attempt = useConnectionStore((s) => s.attempt)
  const maxAttempts = useConnectionStore((s) => s.maxAttempts)
  const delaySeconds = useConnectionStore((s) => s.delaySeconds)
  const tickDelay = useConnectionStore((s) => s.tickDelay)

  useEffect(() => {
    if (state !== 'reconnecting') return undefined
    const id = setInterval(tickDelay, 1000)
    return () => clearInterval(id)
  }, [state, tickDelay])

  if (state === 'connected') return null

  const isReconnecting = state === 'reconnecting'
  const color = isReconnecting ? 'var(--yellow)' : 'var(--red)'
  const Icon = isReconnecting ? Wifi : WifiOff

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        borderLeft: `2px solid ${color}`,
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Icon size={14} strokeWidth={1.5} style={{ color }} />
      <span
        className="uppercase font-semibold"
        style={{ color: 'var(--text-primary)', fontSize: 11, letterSpacing: '0.06em' }}
      >
        {isReconnecting ? t('connection.reconnecting') : t('connection.disconnected')}
      </span>
      {isReconnecting && (
        <span
          className="text-xs"
          style={{
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
        >
          {t('connection.attempt', { attempt, max: maxAttempts || '?' })}
          {delaySeconds > 0 ? ` · ${t('connection.inSeconds', { seconds: delaySeconds })}` : ''}
        </span>
      )}
      {!isReconnecting && (
        <>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('connection.dropped')}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-xs"
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 2,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
            onClick={() => window.location.reload()}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <RefreshCw size={12} strokeWidth={1.5} />
            {t('connection.reload')}
          </button>
        </>
      )}
    </div>
  )
}
