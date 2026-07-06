import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const monoFont = "'JetBrains Mono', 'Source Han Mono SC', monospace"

// Catalog entries from /api/subagents/catalog now arrive as { name, enabled }.
// Older clients (or string-only fixtures) still work — normalize to the new
// shape on read so the rest of the component is uniform.
function normalize(entry) {
  if (entry && typeof entry === 'object') {
    return { name: String(entry.name || ''), enabled: entry.enabled !== false }
  }
  return { name: String(entry || ''), enabled: true }
}

export default function SkillPicker({ value = [], catalog = [], onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const entries = catalog.map(normalize).filter((e) => e.name)
  const enabledByName = new Map(entries.map((e) => [e.name, e.enabled]))
  const offered = entries.filter((e) => !value.includes(e.name))

  const add = (name) => {
    if (!name || value.includes(name)) return
    onChange([...value, name])
  }
  const remove = (name) => onChange(value.filter((v) => v !== name))

  const canOpen = offered.length > 0

  return (
    <div ref={ref} className="relative" style={{ width: '100%' }}>
      {/* Combo trigger — chips live inside */}
      <div
        onClick={() => { if (canOpen) setOpen((v) => !v) }}
        className="flex items-center flex-wrap gap-1 px-2 py-1"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          cursor: canOpen ? 'pointer' : 'not-allowed',
          minHeight: 32,
        }}
      >
        {value.map((skill) => {
          const isEnabled = enabledByName.get(skill) !== false
          return (
            <span
              key={skill}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2"
              title={isEnabled ? skill : t('subagents.skillDisabledTooltip')}
              style={{
                fontSize: 12,
                height: 22,
                background: 'var(--bg-surface)',
                color: isEnabled ? 'var(--text-primary)' : 'var(--text-dim)',
                border: '1px solid var(--border)',
                borderLeft: isEnabled ? '1px solid var(--border)' : '2px solid var(--yellow)',
                borderRadius: '3px',
                fontFamily: monoFont,
              }}
            >
              {!isEnabled && (
                <AlertTriangle
                  size={10}
                  strokeWidth={1.5}
                  style={{ color: 'var(--yellow)', flexShrink: 0 }}
                />
              )}
              {skill}
              <button
                onClick={(e) => { e.stopPropagation(); remove(skill) }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                title="Remove"
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </span>
          )
        })}

        {value.length === 0 && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              flex: 1,
            }}
          >
            {entries.length === 0
              ? t('subagents.empty.noSkills')
              : t('subagents.addSkill')}
          </span>
        )}

        <span style={{ flex: 1 }} />

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
      </div>

      {open && canOpen && (
        <div
          className="absolute flex flex-col"
          style={{
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            zIndex: 50,
          }}
        >
          {offered.map((entry) => (
            <div
              key={entry.name}
              onClick={() => add(entry.name)}
              className="flex items-center gap-2 px-3 py-2"
              title={entry.enabled ? entry.name : t('subagents.skillDisabledTooltip')}
              style={{
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                borderLeft: entry.enabled ? 'none' : '2px solid var(--yellow)',
                transition: 'background 150ms ease',
                fontSize: 12,
                color: entry.enabled ? 'var(--text-primary)' : 'var(--text-dim)',
                fontFamily: monoFont,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {!entry.enabled && (
                <AlertTriangle
                  size={11}
                  strokeWidth={1.5}
                  style={{ color: 'var(--yellow)', flexShrink: 0 }}
                />
              )}
              <span style={{ minWidth: 0, flex: 1 }}>{entry.name}</span>
              {!entry.enabled && (
                <span
                  className="uppercase"
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.06em',
                    color: 'var(--yellow)',
                    flexShrink: 0,
                  }}
                >
                  {t('subagents.skillDisabledTag')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
