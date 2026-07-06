import { useState } from 'react'
import { Flag } from 'lucide-react'

export default function TagFilterChip({ active, label, onClick, showIcon = true }) {
  const [hovered, setHovered] = useState(false)
  const color = active
    ? 'var(--text-primary)'
    : (hovered ? 'var(--text-secondary)' : 'var(--text-dim)')

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="inline-flex items-center gap-1 px-2 py-1 uppercase"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: '1px solid var(--border-subtle)',
        borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
        borderRadius: 2,
        fontSize: 11,
        letterSpacing: '0.06em',
        fontWeight: 600,
        color,
        cursor: 'pointer',
        transition: 'color 150ms ease, background 150ms ease',
      }}
    >
      {showIcon && <Flag size={11} strokeWidth={1.5} />}
      <span className="truncate" style={{ maxWidth: 120 }}>{label}</span>
    </button>
  )
}
