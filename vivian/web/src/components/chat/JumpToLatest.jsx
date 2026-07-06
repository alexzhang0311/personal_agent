import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function JumpToLatest({ onClick, style }) {
  const { t } = useTranslation()
  return (
    <button
      className="flex items-center gap-1 px-3 py-1 text-xs whitespace-nowrap"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontWeight: 600,
        transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)'
        e.currentTarget.style.borderColor = 'var(--blue)'
        e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)'
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = style?.background || 'var(--bg-surface)'
      }}
    >
      <ArrowDown size={12} strokeWidth={1.5} />
      {t('jumpToLatest.label')}
    </button>
  )
}
