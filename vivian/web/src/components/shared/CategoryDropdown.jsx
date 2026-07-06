import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

/**
 * Dark-themed category dropdown with checkmark on selected item.
 * @param {{ options: {value:string, label:string}[], selected: string, onSelect: (v:string)=>void }} props
 */
export default function CategoryDropdown({ options, selected, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeOption = options.find((o) => o.value === selected) || options[0]

  return (
    <div ref={ref} className="relative" style={{ minWidth: 90 }}>
      {/* Trigger */}
      <button
        className="flex items-center gap-2 px-3 py-1"
        style={{
          width: '100%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 12,
          transition: 'border-color 150ms ease',
          justifyContent: 'space-between',
        }}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{activeOption.label}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          style={{
            flexShrink: 0,
            color: 'var(--text-dim)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 150ms ease',
          }}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute flex flex-col"
          style={{
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {options.map((opt) => {
            const isActive = opt.value === selected
            return (
              <div
                key={opt.value}
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  cursor: 'pointer',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  transition: 'background 150ms ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => { onSelect(opt.value); setOpen(false) }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <Check
                  size={12}
                  strokeWidth={1.5}
                  style={{
                    flexShrink: 0,
                    color: isActive ? 'var(--text-primary)' : 'transparent',
                  }}
                />
                <span>{opt.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
