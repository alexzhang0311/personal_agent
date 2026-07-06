import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import CategoryDropdown from '../shared/CategoryDropdown'

const SERVER_TYPE_OPTIONS = [
  { value: 'http', label: 'http' },
  { value: 'sse', label: 'sse' },
  { value: 'stdio', label: 'stdio' },
]

const monoFont = "'JetBrains Mono', 'Source Han Mono SC', monospace"

function InlineServerModal({ onAdd, onClose, initial }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name || '')
  const [type, setType] = useState(initial?.type || 'http')
  const [url, setUrl] = useState(initial?.url || '')
  const [headersText, setHeadersText] = useState(
    initial?.headers
      ? Object.entries(initial.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
      : ''
  )
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim() || !url.trim()) {
      setError(t('subagents.errors.required'))
      return
    }
    const headers = {}
    for (const line of headersText.split('\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const k = line.slice(0, idx).trim()
      const v = line.slice(idx + 1).trim()
      if (k) headers[k] = v
    }
    const def = { __inline: true, name: name.trim(), type, url: url.trim() }
    if (Object.keys(headers).length > 0) def.headers = headers
    onAdd(def)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-3 p-5"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '4px',
          width: 480,
          maxWidth: '90%',
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('subagents.fields.mcpServers')} — {t('subagents.add')}
        </div>

        <label className="flex flex-col gap-1">
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('subagents.fields.name')}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: 13,
              height: 28,
              outline: 'none',
            }}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Type
          </span>
          <CategoryDropdown
            options={SERVER_TYPE_OPTIONS}
            selected={type}
            onSelect={setType}
          />
        </div>

        <label className="flex flex-col gap-1">
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            URL
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="px-2"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: 13,
              height: 28,
              outline: 'none',
              fontFamily: monoFont,
            }}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Headers (key: value, one per line)
          </span>
          <textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            className="px-2 py-1"
            rows={3}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
              fontFamily: monoFont,
              resize: 'vertical',
            }}
          />
        </label>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              height: 28,
            }}
          >
            {t('subagents.cancel')}
          </button>
          <button
            onClick={submit}
            className="px-3"
            style={{
              background: 'var(--blue)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-inverse)',
              cursor: 'pointer',
              fontSize: 13,
              height: 28,
            }}
          >
            {t('subagents.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MCPServerPicker({ value = [], catalog = [], onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showInline, setShowInline] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const refValues = value.filter((v) => typeof v === 'string')
  const offered = catalog.filter((c) => !refValues.includes(c))

  const addRef = (name) => {
    if (refValues.includes(name)) return
    onChange([...value, name])
  }
  const removeAt = (idx) => onChange(value.filter((_, i) => i !== idx))
  const addInline = (def) => {
    onChange([...value, def])
    setShowInline(false)
  }

  const canOpen = offered.length > 0

  return (
    <div ref={ref} className="relative" style={{ width: '100%' }}>
      {/* Combo trigger */}
      <div
        onClick={() => { if (canOpen || true) setOpen((v) => !v) }}
        className="flex items-center flex-wrap gap-1 px-2 py-1"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          cursor: 'pointer',
          minHeight: 32,
        }}
      >
        {value.map((entry, idx) => {
          const isInline = entry && typeof entry === 'object'
          const label = isInline ? (entry.name || 'inline') : entry
          return (
            <span
              key={`${idx}-${label}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2"
              style={{
                fontSize: 12,
                height: 22,
                background: isInline ? 'transparent' : 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: isInline ? '1px solid var(--purple)' : '1px solid var(--border)',
                borderRadius: '3px',
                fontFamily: monoFont,
              }}
              title={isInline ? `inline: ${entry.url || ''}` : 'reference'}
            >
              {isInline ? <Server size={11} strokeWidth={1.5} /> : null}
              {label}
              <button
                onClick={(e) => { e.stopPropagation(); removeAt(idx) }}
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
            {t('subagents.addServer')}
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

      {open && (
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
          {offered.map((name) => (
            <div
              key={name}
              onClick={() => addRef(name)}
              className="px-3 py-2"
              style={{
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background 150ms ease',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontFamily: monoFont,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {name}
            </div>
          ))}
          <div
            onClick={(e) => { e.stopPropagation(); setShowInline(true); setOpen(false) }}
            className="flex items-center gap-1 px-3 py-2"
            style={{
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--purple)',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <Server size={11} strokeWidth={1.5} />
            {t('subagents.addInline')}
          </div>
        </div>
      )}

      {showInline && (
        <InlineServerModal onClose={() => setShowInline(false)} onAdd={addInline} />
      )}
    </div>
  )
}
