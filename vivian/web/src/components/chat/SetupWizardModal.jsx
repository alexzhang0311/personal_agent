import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bot, Check, AlertCircle, Eye, EyeOff, ChevronRight, ChevronLeft, ChevronDown, Search } from 'lucide-react'
import useSettingsStore from '../../stores/settingsStore'
import safeStorage from '../../utils/safeStorage'

function FilterableModelSelect({ models, value, onChange, label, labelStyle, inputStyle }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef(null)
  const filterRef = useRef(null)

  const filtered = useMemo(() => {
    if (!filter.trim()) return models
    const q = filter.toLowerCase()
    return models.filter((m) => m.id.toLowerCase().includes(q))
  }, [models, filter])

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setFilter('')
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && filterRef.current) filterRef.current.focus()
  }, [open])

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div className="relative" ref={containerRef}>
        <div className="flex items-center" style={{ position: 'relative' }}>
          <input
            type="text"
            readOnly
            value={value || ''}
            placeholder="Select model..."
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              paddingRight: 28,
              cursor: 'text',
            }}
            onClick={() => setOpen(!open)}
          />
          <button
            type="button"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 28,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-dim)',
            }}
            onClick={() => setOpen(!open)}
            tabIndex={-1}
          >
            <ChevronDown size={12} strokeWidth={1.5} />
          </button>
        </div>

        {open && (
          <div
            className="absolute left-0 right-0 flex flex-col"
            style={{
              top: '100%',
              marginTop: 2,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              maxHeight: 200,
              zIndex: 60,
            }}
          >
            <div
              className="flex items-center gap-2 px-2 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter models..."
                className="flex-1 py-2 text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontSize: 12,
                  minWidth: 0,
                }}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 160 }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                  No matches
                </div>
              ) : (
                filtered.map((m) => {
                  const isActive = value === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="flex items-center w-full px-3 py-2 text-xs"
                      style={{
                        background: isActive ? 'var(--bg-surface)' : 'transparent',
                        border: 'none',
                        borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                        fontSize: 12,
                        textAlign: 'left',
                        transition: 'background 150ms ease',
                        wordBreak: 'break-all',
                      }}
                      onClick={() => {
                        onChange(m.id)
                        setOpen(false)
                        setFilter('')
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {m.id}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SetupWizardModal({ onComplete }) {
  const [step, setStep] = useState(1)
  const [baseUrl, setBaseUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState(null) // null | 'loading' | 'success' | 'error'
  const [connectionError, setConnectionError] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [opusModel, setOpusModel] = useState('')
  const [sonnetModel, setSonnetModel] = useState('')
  const [haikuModel, setHaikuModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const models = useSettingsStore((s) => s.models)
  const saveEnv = useSettingsStore((s) => s.saveEnv)
  const saveVisionModel = useSettingsStore((s) => s.saveVisionModel)
  const fetchModels = useSettingsStore((s) => s.fetchModels)

  // Auto-fetch models when both fields are filled
  const tryFetchModels = useCallback(async () => {
    if (!baseUrl.trim() || !authToken.trim()) return
    setConnectionStatus('loading')
    setConnectionError('')

    // Save credentials first so the backend can use them
    try {
      await saveEnv({
        ANTHROPIC_BASE_URL: baseUrl.trim(),
        ANTHROPIC_AUTH_TOKEN: authToken.trim(),
      })
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError('Failed to save credentials')
      return
    }

    const result = await fetchModels()
    if (result.length > 0) {
      setConnectionStatus('success')
      // Auto-select first model as default if not set
      if (!defaultModel) setDefaultModel(result[0].id)
      if (!opusModel) setOpusModel(result[0].id)
      if (!sonnetModel) setSonnetModel(result[0].id)
      if (!haikuModel) setHaikuModel(result[0].id)
    } else {
      setConnectionStatus('error')
      const err = useSettingsStore.getState().modelsError
      setConnectionError(err || 'No models found')
    }
  }, [baseUrl, authToken, saveEnv, fetchModels, defaultModel, opusModel, sonnetModel, haikuModel])

  // Debounced auto-fetch
  useEffect(() => {
    if (!baseUrl.trim() || !authToken.trim()) {
      setConnectionStatus(null)
      return
    }
    const timer = setTimeout(tryFetchModels, 800)
    return () => clearTimeout(timer)
  }, [baseUrl, authToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFinish = async () => {
    setSaving(true)
    try {
      await saveEnv({
        ANTHROPIC_BASE_URL: baseUrl.trim(),
        ANTHROPIC_AUTH_TOKEN: authToken.trim(),
        ANTHROPIC_MODEL: defaultModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
      })
      if (visionModel) await saveVisionModel(visionModel)
      await useSettingsStore.getState().fetchEnvStatus()
      if (onComplete) onComplete()
    } catch {
      // Error handled by store
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = () => {
    safeStorage.setItem('env-setup-dismissed', String(Date.now()))
    setDismissed(true)
    if (onComplete) onComplete()
  }

  if (dismissed) return null

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

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 480,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          animation: 'modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-6 pt-6 pb-4">
          <Bot size={20} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
          <span className="font-bold" style={{ color: 'var(--text-primary)', fontSize: 16 }}>
            API Setup
          </span>
          <div className="flex-1" />
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                style={{
                  width: s === step ? 24 : 8,
                  height: 4,
                  borderRadius: 2,
                  background: s <= step ? 'var(--blue)' : 'var(--border)',
                  transition: 'all 200ms ease',
                }}
              />
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          {/* Step 1: Connection */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Enter your API base URL and authentication token.
              </p>
              <div>
                <label style={labelStyle}>Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://your-api-server:port/"
                  style={inputStyle}
                  autoFocus
                  autoComplete="url"
                />
              </div>
              <div>
                <label style={labelStyle}>Auth Token</label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="sk-..."
                    style={{ ...inputStyle, paddingRight: 36 }}
                    autoComplete="one-time-code"
                  />
                  <button
                    className="absolute flex items-center justify-center"
                    style={{
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-dim)',
                      padding: 0,
                    }}
                    onClick={() => setShowToken(!showToken)}
                    type="button"
                  >
                    {showToken ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                  </button>
                </div>
              </div>

              {/* Connection status */}
              {connectionStatus && (
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{
                    borderLeft: `2px solid ${connectionStatus === 'success' ? 'var(--green)' : connectionStatus === 'error' ? 'var(--red)' : 'var(--yellow)'}`,
                    background: 'var(--bg-elevated)',
                    borderRadius: 2,
                  }}
                >
                  {connectionStatus === 'loading' && (
                    <span className="text-xs" style={{ color: 'var(--yellow)' }}>Connecting...</span>
                  )}
                  {connectionStatus === 'success' && (
                    <>
                      <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
                      <span className="text-xs" style={{ color: 'var(--green)' }}>
                        Connected — {models.length} model{models.length !== 1 ? 's' : ''} found
                      </span>
                    </>
                  )}
                  {connectionStatus === 'error' && (
                    <>
                      <AlertCircle size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
                      <span className="text-xs" style={{ color: 'var(--red)' }}>
                        {connectionError || 'Connection failed'}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  className="text-xs"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                  onClick={handleDismiss}
                >
                  Skip for now
                </button>
                <button
                  className="flex items-center gap-1 px-4 py-2 text-xs font-semibold"
                  disabled={connectionStatus !== 'success'}
                  style={{
                    background: connectionStatus === 'success' ? 'var(--blue)' : 'var(--bg-elevated)',
                    color: connectionStatus === 'success' ? 'var(--text-inverse)' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: connectionStatus === 'success' ? 'pointer' : 'default',
                    opacity: connectionStatus === 'success' ? 1 : 0.5,
                    transition: 'opacity 150ms ease',
                  }}
                  onClick={() => setStep(2)}
                >
                  Next <ChevronRight size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Model Selection */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Select default models for each tier.
              </p>
              {[
                { label: 'Default Model', value: defaultModel, setter: setDefaultModel },
                { label: 'Opus Model', value: opusModel, setter: setOpusModel },
                { label: 'Sonnet Model', value: sonnetModel, setter: setSonnetModel },
                { label: 'Haiku Model', value: haikuModel, setter: setHaikuModel },
              ].map(({ label, value, setter }) => (
                <FilterableModelSelect
                  key={label}
                  label={label}
                  models={models}
                  value={value}
                  onChange={setter}
                  labelStyle={labelStyle}
                  inputStyle={inputStyle}
                />
              ))}
              <div style={{ borderBottom: '1px solid var(--border)' }} />
              <span className="text-xs font-light" style={{ color: 'var(--text-dim)' }}>
                Optional: select a vision model for image input support.
              </span>
              <FilterableModelSelect
                label="Vision Model"
                models={models}
                value={visionModel}
                onChange={setVisionModel}
                labelStyle={labelStyle}
                inputStyle={inputStyle}
              />

              <div className="flex items-center justify-between pt-2">
                <button
                  className="flex items-center gap-1 px-4 py-2 text-xs"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setStep(1)}
                >
                  <ChevronLeft size={12} strokeWidth={1.5} /> Back
                </button>
                <button
                  className="flex items-center gap-1 px-4 py-2 text-xs font-semibold"
                  disabled={!defaultModel}
                  style={{
                    background: defaultModel ? 'var(--blue)' : 'var(--bg-elevated)',
                    color: defaultModel ? 'var(--text-inverse)' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: defaultModel ? 'pointer' : 'default',
                    opacity: defaultModel ? 1 : 0.5,
                  }}
                  onClick={() => setStep(3)}
                >
                  Next <ChevronRight size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Review your configuration.
              </p>
              <div
                className="flex flex-col gap-2 px-3 py-3"
                style={{ background: 'var(--bg-elevated)', borderRadius: 4 }}
              >
                {[
                  { label: 'Base URL', value: baseUrl },
                  { label: 'Default', value: defaultModel },
                  { label: 'Opus', value: opusModel },
                  { label: 'Sonnet', value: sonnetModel },
                  { label: 'Haiku', value: haikuModel },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dim)', width: 60, fontWeight: 600 }}>
                      {label}
                    </span>
                    <span
                      className="text-xs truncate"
                      style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
                    >
                      {value || '—'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  className="flex items-center gap-1 px-4 py-2 text-xs"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setStep(2)}
                >
                  <ChevronLeft size={12} strokeWidth={1.5} /> Back
                </button>
                <button
                  className="px-4 py-2 text-xs font-semibold"
                  disabled={saving}
                  style={{
                    background: 'var(--green)',
                    color: 'var(--text-inverse)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                    transition: 'opacity 150ms ease',
                  }}
                  onClick={handleFinish}
                >
                  {saving ? 'Saving...' : 'Finish Setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modal-scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
