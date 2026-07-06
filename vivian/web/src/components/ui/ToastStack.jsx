import { AlertTriangle, Wifi, Info, X } from 'lucide-react'
import useToastStore from '../../stores/toastStore'

const LEVEL_CONFIG = {
  error:   { color: 'var(--red)',    Icon: AlertTriangle },
  warning: { color: 'var(--yellow)', Icon: Wifi },
  info:    { color: 'var(--blue)',   Icon: Info },
}

function Toast({ toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast)
  const cfg = LEVEL_CONFIG[toast.level] || LEVEL_CONFIG.info
  const { Icon, color } = cfg
  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${color}`,
        borderRadius: 4,
        padding: '8px 10px',
        minWidth: 280,
        maxWidth: 420,
        animation: 'toast-slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div className="flex items-start gap-2">
        <Icon size={14} strokeWidth={1.5} style={{ color, flexShrink: 0, marginTop: 2 }} />
        <div className="flex-1 min-w-0" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          <div
            className="font-semibold uppercase"
            style={{ color: 'var(--text-primary)', fontSize: 11, letterSpacing: '0.06em' }}
          >
            {toast.title}
          </div>
          {toast.body && (
            <div
              className="text-xs"
              style={{ color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}
            >
              {toast.body}
            </div>
          )}
          {toast.action?.label && (
            <button
              type="button"
              className="text-xs"
              style={{
                marginTop: 6,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 2,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'border-color 150ms ease, color 150ms ease',
              }}
              onClick={() => {
                toast.action.onClick?.()
                dismissToast(toast.id)
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-strong)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissToast(toast.id)}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-dim)', padding: 0, flexShrink: 0,
            transition: 'color 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

export default function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'auto',
      }}
    >
      {toasts.map((t) => <Toast key={t.id} toast={t} />)}
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
