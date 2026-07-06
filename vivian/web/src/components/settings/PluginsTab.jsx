import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { Plus, X, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getPlugins, updatePlugin } from '../../api/admin'
import { validateMcpServer } from '../../api/mcp'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  padding: '6px 10px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const PROVIDER_OPTIONS = [
  { value: 'mcp', label: 'MCP' },
]

const PROBE_COLORS = {
  checking: 'var(--yellow)',
  success: 'var(--green)',
  error: 'var(--red)',
}

const PLUGIN_I18N_KEYS = {
  enterprise_user_info: {
    name: 'settings.pluginEnterpriseUserInfoName',
    description: 'settings.pluginEnterpriseUserInfoDesc',
  },
}

function headersDictToList(headers) {
  return Object.entries(headers || {})
    .filter(([key]) => key.trim())
    .map(([key, value]) => ({ key, value }))
}

function ProbeStatus({ state, detail }) {
  const { t } = useTranslation()
  if (state === 'idle') return null

  const label = {
    checking: t('settings.pluginProbeChecking'),
    success: t('settings.pluginProbeSuccess'),
    error: t('settings.pluginProbeFailed'),
  }[state]

  return (
    <span
      aria-live="polite"
      title={detail || label}
      className="text-xs font-semibold"
      style={{
        color: PROBE_COLORS[state],
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/** Compact toggle switch consistent with the dark industrial design language. */
function ToggleSwitch({ value, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      className="flex-shrink-0"
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 4,
        border: `1px solid ${value ? 'var(--blue)' : 'var(--border-strong)'}`,
        background: value ? 'var(--blue)' : 'var(--bg-elevated)',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 150ms ease, border-color 150ms ease',
      }}
      onClick={() => onChange(!value)}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: 2,
          background: value ? 'var(--text-inverse)' : 'var(--text-dim)',
          transition: 'left 150ms ease, background 150ms ease',
        }}
      />
    </button>
  )
}

/** Key-value header rows matching the MCP header editing pattern. */
function HeadersEditor({ headers, onChange, onDirty }) {
  const { t } = useTranslation()

  // Convert dict to array of {key, value}
  const pairs = Object.entries(headers || {}).map(([k, v]) => ({ key: k, value: v }))

  const updatePair = (index, field, val) => {
    const next = [...pairs]
    next[index] = { ...next[index], [field]: val }
    onChange(pairsToDict(next))
    onDirty()
  }

  const removePair = (index) => {
    const next = pairs.filter((_, i) => i !== index)
    onChange(pairsToDict(next))
    onDirty()
  }

  const addPair = () => {
    const next = [...pairs, { key: '', value: '' }]
    onChange(pairsToDict(next))
    onDirty()
  }

  return (
    <div className="flex flex-col gap-2">
      {pairs.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 px-2 py-1"
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
            placeholder={t('settings.pluginHeaderKey')}
            value={h.key}
            onChange={(e) => updatePair(i, 'key', e.target.value)}
          />
          <input
            className="flex-1 px-2 py-1"
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
            placeholder={t('settings.pluginHeaderValue')}
            value={h.value}
            onChange={(e) => updatePair(i, 'value', e.target.value)}
          />
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease',
              flexShrink: 0,
            }}
            onClick={() => removePair(i)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      <button
        className="flex items-center gap-1"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 12, padding: '2px 0',
          transition: 'color 150ms ease',
        }}
        onClick={addPair}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <Plus size={12} strokeWidth={1.5} />
        {t('settings.pluginAddHeader')}
      </button>
    </div>
  )
}

/** Convert array of {key, value} pairs back to a dict, preserving insertion order. */
function pairsToDict(pairs) {
  const result = {}
  for (const { key, value } of pairs) {
    // Use key as-is, even if empty (user is still typing)
    result[key] = value
  }
  return result
}

function PluginCard({ plugin, onSaved }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(plugin.enabled)
  const [config, setConfig] = useState(plugin.config)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [probeState, setProbeState] = useState('idle')
  const [probeDetail, setProbeDetail] = useState('')
  const bodyId = useId()
  const probeSeqRef = useRef(0)
  const pluginTextKeys = PLUGIN_I18N_KEYS[plugin.id]
  const pluginName = pluginTextKeys ? t(pluginTextKeys.name, { defaultValue: plugin.name }) : plugin.name
  const pluginDescription = pluginTextKeys
    ? t(pluginTextKeys.description, { defaultValue: plugin.description })
    : plugin.description

  useEffect(() => {
    const url = (config.url || '').trim()
    if (!enabled || !url) {
      probeSeqRef.current += 1
      setProbeState('idle')
      setProbeDetail('')
      return undefined
    }

    const seq = probeSeqRef.current + 1
    probeSeqRef.current = seq
    setProbeState('checking')
    setProbeDetail('')

    const timer = window.setTimeout(async () => {
      try {
        const result = await validateMcpServer({
          type: 'http',
          url,
          headers: headersDictToList(config.headers),
          timeout: Math.max(5, Number(config.timeout) || 10),
        })
        if (probeSeqRef.current !== seq) return
        setProbeState(result.success ? 'success' : 'error')
        setProbeDetail(result.error || '')
      } catch (error) {
        if (probeSeqRef.current !== seq) return
        setProbeState('error')
        setProbeDetail(error?.message || '')
      }
    }, 650)

    return () => window.clearTimeout(timer)
  }, [enabled, config.url, config.headers, config.timeout])

  const handleToggle = async (val) => {
    setEnabled(val)
    // Auto-expand when turning ON, collapse when turning OFF
    if (val) setExpanded(true)
    else setExpanded(false)
    // Auto-save toggle state immediately
    try {
      const result = await updatePlugin(plugin.id, { enable: val, config })
      if (onSaved) onSaved(result)
    } catch {
      // revert on failure
      setEnabled(!val)
    }
  }

  const handleConfigChange = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await updatePlugin(plugin.id, {
        enable: enabled,
        config,
      })
      setDirty(false)
      if (onSaved) onSaved(result)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 16,
      }}
    >
      {/* Header: name + toggle */}
      <div className="flex items-center justify-between">
        <div style={{ minWidth: 0 }}>
          <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14 }}>
            {pluginName}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 2 }}>
            {pluginDescription}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" style={{ marginLeft: 16 }}>
          <span className="text-xs font-semibold" style={{
            color: enabled ? 'var(--green)' : 'var(--text-dim)',
            letterSpacing: '0.06em',
            transition: 'color 150ms ease',
          }}>
            {enabled ? t('settings.pluginOn') : t('settings.pluginOff')}
          </span>
          <ToggleSwitch value={enabled} onChange={handleToggle} />
        </div>
      </div>

      {/* Collapsible config section - only when enabled */}
      {enabled && (
        <>
          {/* Collapse/expand toggle */}
          <button
            className="flex items-center gap-1"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              fontSize: 12,
              padding: '8px 0 0',
              transition: 'color 150ms ease',
            }}
            onClick={() => setExpanded((v) => !v)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            <AnimatedChevron open={expanded}>
              <ChevronDown size={14} strokeWidth={1.5} />
            </AnimatedChevron>
            {t('settings.pluginConfig')}
          </button>
        </>
      )}

      <AnimatedCollapse
        open={enabled && expanded}
        id={bodyId}
        style={{ marginTop: 8, borderTop: '1px solid var(--border)' }}
        innerClassName="flex flex-col gap-4"
        innerStyle={{ paddingTop: 16 }}
      >
          {/* Provider type dropdown */}
          <div>
            <label style={labelStyle}>{t('settings.pluginProviderType')}</label>
            <select
              value={config.provider_type || 'mcp'}
              onChange={(e) => handleConfigChange('provider_type', e.target.value)}
              style={{
                ...inputStyle,
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='1.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
                paddingRight: 28,
                cursor: 'pointer',
              }}
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2" style={{ marginBottom: 4 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>{t('settings.pluginMcpUrl')}</label>
              <ProbeStatus state={probeState} detail={probeDetail} />
            </div>
            <input
              value={config.url || ''}
              onChange={(e) => handleConfigChange('url', e.target.value)}
              placeholder="https://enterprise-mcp.internal/mcp"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('settings.pluginToolName')}</label>
            <input
              value={config.tool_name || ''}
              onChange={(e) => handleConfigChange('tool_name', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('settings.pluginTimeout')}</label>
            <input
              type="number"
              value={config.timeout ?? 10}
              onChange={(e) => handleConfigChange('timeout', parseInt(e.target.value, 10) || 10)}
              style={{ ...inputStyle, width: 120 }}
            />
          </div>

          {/* Headers: key-value pairs */}
          <div>
            <label style={labelStyle}>{t('settings.pluginHeaders')}</label>
            <HeadersEditor
              headers={config.headers || {}}
              onChange={(newHeaders) => setConfig((prev) => ({ ...prev, headers: newHeaders }))}
              onDirty={() => setDirty(true)}
            />
          </div>
      </AnimatedCollapse>

      {/* Save button - only visible when enabled and config changed */}
      {enabled && dirty && (
        <div className="flex justify-end" style={{ marginTop: 16 }}>
          <button
            className="px-4 py-2 text-xs font-semibold"
            disabled={saving}
            style={{
              background: 'var(--blue)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'opacity 150ms ease',
            }}
            onClick={handleSave}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function PluginsTab() {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState([])
  const [loaded, setLoaded] = useState(false)

  const fetchPlugins = useCallback(async () => {
    try {
      const data = await getPlugins()
      setPlugins(data.plugins || [])
    } catch {
      // handled
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins])

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton" style={{ height: 16, width: '60%' }} />
        <div className="skeleton" style={{ height: 200, width: '100%' }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.pluginsDesc')}
      </p>
      {plugins.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
          {t('settings.pluginsEmpty')}
        </div>
      ) : (
        plugins.map((p) => (
          <PluginCard
            key={p.id}
            plugin={p}
            onSaved={(updated) => {
              setPlugins((prev) =>
                prev.map((old) => (old.id === updated.id ? updated : old))
              )
            }}
          />
        ))
      )}
    </div>
  )
}
