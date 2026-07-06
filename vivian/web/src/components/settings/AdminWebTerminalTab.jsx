import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'

import { getPtyConfig, updatePtyConfig } from '../../api/admin'
import useUiStore from '../../stores/uiStore'

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: "'Noto Sans', sans-serif",
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle = {
  display: 'block',
  marginBottom: 4,
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const fieldDefs = [
  { key: 'max_sessions_per_user', labelKey: 'settings.webTerminal.maxSessions' },
  { key: 'idle_timeout_seconds', labelKey: 'settings.webTerminal.idleTimeout', unitKey: 'settings.webTerminal.unitSeconds' },
  { key: 'absolute_timeout_seconds', labelKey: 'settings.webTerminal.absoluteTimeout', unitKey: 'settings.webTerminal.unitSeconds' },
  { key: 'output_rate_limit_bytes_per_sec', labelKey: 'settings.webTerminal.outputRate', unitKey: 'settings.webTerminal.unitBytesPerSec' },
  { key: 'max_cols', labelKey: 'settings.webTerminal.maxCols' },
  { key: 'max_rows', labelKey: 'settings.webTerminal.maxRows' },
  { key: 'rlimit_cpu_seconds', labelKey: 'settings.webTerminal.rlimitCpu', unitKey: 'settings.webTerminal.unitSeconds' },
  { key: 'rlimit_as_bytes', labelKey: 'settings.webTerminal.rlimitAs', unitKey: 'settings.webTerminal.unitBytes' },
  { key: 'rlimit_fsize_bytes', labelKey: 'settings.webTerminal.rlimitFsize', unitKey: 'settings.webTerminal.unitBytes' },
  { key: 'rlimit_nofile', labelKey: 'settings.webTerminal.rlimitNofile' },
]

export default function AdminWebTerminalTab() {
  const { t } = useTranslation()
  const setTerminalFeatureEnabled = useUiStore((s) => s.setTerminalFeatureEnabled)

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [shell, setShell] = useState('')
  const [values, setValues] = useState({})

  useEffect(() => {
    getPtyConfig()
      .then((cfg) => {
        setEnabled(!!cfg.enabled)
        setShell(cfg.shell || '')
        const v = {}
        for (const f of fieldDefs) v[f.key] = cfg[f.key]
        setValues(v)
        setLoaded(true)
      })
      .catch((e) => {
        setError(String(e?.message || e))
        setLoaded(true)
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const payload = { enabled, shell, ...values }
    // Coerce numeric fields.
    for (const f of fieldDefs) {
      const n = Number(payload[f.key])
      if (!Number.isFinite(n)) {
        setError(t('settings.webTerminal.invalidNumber'))
        setSaving(false)
        return
      }
      payload[f.key] = n
    }
    try {
      const updated = await updatePtyConfig(payload)
      setEnabled(!!updated.enabled)
      setTerminalFeatureEnabled(!!updated.enabled)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton" style={{ height: 16, width: '60%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
        <div className="skeleton" style={{ height: 200, width: '100%' }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.webTerminal.desc')}
      </p>

      <div
        className="flex items-start gap-2 px-3 py-2"
        style={{
          border: '1px solid var(--red)',
          borderLeft: '2px solid var(--red)',
          borderRadius: 4,
          background: 'rgba(248,81,73,0.08)',
        }}
      >
        <span className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {t('settings.webTerminal.warning')}
        </span>
      </div>

      {/* Enable toggle */}
      <div className="flex flex-col gap-1">
        <label style={labelStyle}>{t('settings.webTerminal.enableLabel')}</label>
        <div className="flex gap-2">
          {[
            { value: true, label: t('settings.webTerminal.on') },
            { value: false, label: t('settings.webTerminal.off') },
          ].map((opt) => {
            const isActive = enabled === opt.value
            return (
              <button
                key={String(opt.value)}
                className="flex items-center gap-2 px-3 py-2 text-sm"
                style={{
                  background: isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  border: isActive
                    ? `1px solid ${opt.value ? 'var(--red)' : 'var(--border-strong)'}`
                    : '1px solid var(--border)',
                  borderRadius: 4,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
                }}
                onClick={() => setEnabled(opt.value)}
              >
                {isActive && (
                  <Check
                    size={14}
                    strokeWidth={1.5}
                    style={{ color: opt.value ? 'var(--red)' : 'var(--text-secondary)' }}
                  />
                )}
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Shell */}
      <div className="flex flex-col gap-1">
        <label style={labelStyle}>{t('settings.webTerminal.shell')}</label>
        <input
          type="text"
          value={shell}
          onChange={(e) => setShell(e.target.value)}
          placeholder="$SHELL or /bin/bash"
          style={inputStyle}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        />
      </div>

      {/* Numeric limits */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {fieldDefs.map((f) => (
          <div key={f.key} className="flex flex-col gap-1" style={{ minWidth: 0 }}>
            <label style={labelStyle}>
              {t(f.labelKey)}
              {f.unitKey ? <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{t(f.unitKey)}</span> : null}
            </label>
            <input
              type="number"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="text-xs" style={{ color: 'var(--red)' }}>{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 text-sm"
          style={{
            background: 'var(--blue)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-inverse)',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontWeight: 600,
            transition: 'opacity 150ms ease',
          }}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}
