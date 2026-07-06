import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const KNOWN_TOOLS = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'TodoWrite'])
const monoFont = "'JetBrains Mono', 'Source Han Mono SC', monospace"

function useDescribe(t) {
  return (tool) => {
    if (KNOWN_TOOLS.has(tool)) {
      return t(`subagents.toolDesc.${tool}`)
    }
    if (tool.startsWith('mcp__')) {
      const parts = tool.split('__')
      return t('subagents.toolDesc.mcpFallback', { server: parts[1] || 'server' })
    }
    return ''
  }
}

export default function ToolPicker({ value = [], catalog = [], onChange, label }) {
  const { t } = useTranslation()
  const describe = useDescribe(t)
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

  const offered = catalog.filter((c) => !value.includes(c))

  const add = (tool) => {
    if (!tool || tool === 'Agent') return
    if (value.includes(tool)) return
    onChange([...value, tool])
  }
  const remove = (tool) => onChange(value.filter((v) => v !== tool))
  const canOpen = offered.length > 0

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <div
          className="uppercase font-semibold"
          style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.06em' }}
        >
          {label}
        </div>
      )}

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
          {value.map((tool) => (
            <span
              key={tool}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2"
              style={{
                fontSize: 12,
                height: 22,
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                fontFamily: monoFont,
              }}
            >
              {tool}
              <button
                onClick={(e) => { e.stopPropagation(); remove(tool) }}
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
          ))}

          {value.length === 0 && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                flex: 1,
              }}
            >
              {t('subagents.addTool')}
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
            {offered.map((tool) => (
              <div
                key={tool}
                onClick={() => add(tool)}
                className="flex flex-col gap-1 px-3 py-2"
                style={{
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    fontFamily: monoFont,
                  }}
                >
                  {tool}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    lineHeight: 1.35,
                    fontWeight: 300,
                    wordBreak: 'break-word',
                  }}
                >
                  {describe(tool) || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
