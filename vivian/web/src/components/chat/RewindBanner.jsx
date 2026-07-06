import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function RewindBanner() {
  const { t } = useTranslation()
  const rewindMarker = useChatStore((s) => s.rewindMarker)
  const clearRewindMarker = useChatStore((s) => s.clearRewindMarker)

  if (!rewindMarker) return null

  const count = rewindMarker.revertedToolUseIds?.length || 0
  const time = fmtTime(rewindMarker.rewindTs)

  return (
    <div
      className="flex items-center gap-2 px-4 flex-shrink-0"
      style={{
        position: 'sticky',
        top: 40,
        zIndex: 5,
        height: 40,
        background: 'var(--bg-surface)',
        borderLeft: '2px solid var(--purple)',
        borderBottom: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        fontSize: 12,
      }}
    >
      <RotateCcw size={14} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>{t('rewind.banner', { count, time })}</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={clearRewindMarker}
        title={t('rewind.dismiss')}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: 'var(--text-dim)',
          display: 'flex',
          alignItems: 'center',
          borderRadius: 2,
          flexShrink: 0,
          transition: 'color 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
