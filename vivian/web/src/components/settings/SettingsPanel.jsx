import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Key, Cpu, Zap, Check, AlertCircle, Eye, EyeOff, Plus, Trash2, Pencil, X, ChevronDown, Search, Copy, RefreshCw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '../../stores/settingsStore'
import useAuthStore from '../../stores/authStore'
import { changeMyPassword } from '../../api/auth'
import {
  getCliPath,
  getHistoryRetention,
  getRetryableTools,
  getSensitivePatterns,
  updateCliPath,
  updateHistoryRetention,
  updateRetryableTools,
  updateSensitivePatterns,
} from '../../api/admin'
import { copyTextToClipboard } from '../../utils/clipboard'
import { getLucideIcon, ICON_NAMES } from '../../utils/lucideIconMap'
import ChannelsTab from './ChannelsTab'
import PluginsTab from './PluginsTab'
import AdminWebTerminalTab from './AdminWebTerminalTab'

function FilterableModelSelect({ models, value, onChange, label, labelStyle, inputStyle, placeholder, filterPlaceholder, noMatchesText }) {
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
            placeholder={placeholder || 'Select model...'}
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
                placeholder={filterPlaceholder || 'Filter models...'}
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
                  {noMatchesText || 'No matches'}
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

function AccountTab() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleCancel = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
  }

  const handleSubmit = async () => {
    setError('')
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('settings.passwordRequired') || 'All fields are required')
      return
    }
    if (newPassword.length < 8) {
      setError(t('settings.passwordMin8'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('settings.passwordMismatch'))
      return
    }
    setSaving(true)
    try {
      await changeMyPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 1500)
    } catch (e) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to update password'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = currentPassword && newPassword && confirmPassword && !saving

  const profileRow = (label, value) => (
    <div className="flex items-start gap-4" style={{ padding: '8px 0' }}>
      <div
        style={{
          width: 120,
          flexShrink: 0,
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div
        className="flex-1 min-w-0"
        style={{
          color: 'var(--text-primary)',
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {value || '—'}
      </div>
    </div>
  )

  const passwordField = (label, value, setter, show, setShow, hint) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => { setter(e.target.value); setError('') }}
          style={{ ...inputStyle, paddingRight: 36 }}
          autoComplete="new-password"
        />
        <button
          type="button"
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
          onClick={() => setShow(!show)}
          tabIndex={-1}
        >
          {show ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
        </button>
      </div>
      {hint && (
        <div className="text-xs" style={{ color: 'var(--text-dim)', marginTop: 4, fontWeight: 300 }}>
          {hint}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Profile section */}
      <div>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          {t('settings.profile')}
        </div>
        <div
          className="flex flex-col"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            padding: '4px 16px',
          }}
        >
          {profileRow(t('settings.profileUsername'), user?.username)}
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />
          {profileRow(t('settings.profileRole'), user?.role)}
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />
          {profileRow(t('settings.profileWorkspace'), user?.workspace)}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid var(--border)' }} />

      {/* Change password section */}
      <div className="flex flex-col gap-4">
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {t('settings.changePassword')}
        </div>

        {passwordField(t('settings.currentPassword'), currentPassword, setCurrentPassword, showCurrent, setShowCurrent)}
        {passwordField(t('settings.newPassword'), newPassword, setNewPassword, showNew, setShowNew, t('settings.passwordMin8'))}
        {passwordField(t('settings.confirmPassword'), confirmPassword, setConfirmPassword, showConfirm, setShowConfirm)}

        {error && (
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{
              borderLeft: '2px solid var(--red)',
              background: 'var(--bg-elevated)',
              borderRadius: 2,
            }}
          >
            <AlertCircle size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
            <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>
          </div>
        )}

        {success && (
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{
              borderLeft: '2px solid var(--green)',
              background: 'var(--bg-elevated)',
              borderRadius: 2,
            }}
          >
            <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
            <span className="text-xs" style={{ color: 'var(--green)' }}>{t('settings.passwordUpdated')}</span>
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            className="px-3 py-2 text-xs"
            disabled={saving}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              cursor: saving ? 'default' : 'pointer',
            }}
            onClick={handleCancel}
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            className="px-3 py-2 text-xs font-semibold"
            disabled={!canSubmit}
            style={{
              background: canSubmit ? 'var(--blue)' : 'var(--bg-elevated)',
              color: canSubmit ? 'var(--text-inverse)' : 'var(--text-dim)',
              border: 'none',
              borderRadius: 4,
              cursor: canSubmit ? 'pointer' : 'default',
              opacity: canSubmit ? 1 : 0.5,
              transition: 'opacity 150ms ease',
            }}
            onClick={handleSubmit}
          >
            {saving ? t('settings.saving') : t('settings.updatePassword')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ApiKeyTab() {
  const { t } = useTranslation()
  const apiKey = useSettingsStore((s) => s.apiKey)
  const apiKeyLoading = useSettingsStore((s) => s.apiKeyLoading)
  const fetchApiKey = useSettingsStore((s) => s.fetchApiKey)
  const generateApiKey = useSettingsStore((s) => s.generateApiKey)
  const revokeApiKey = useSettingsStore((s) => s.revokeApiKey)

  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // 'regenerate' | 'revoke' | null

  useEffect(() => {
    fetchApiKey()
  }, [fetchApiKey])

  const handleCopy = () => {
    if (apiKey?.api_key) {
      copyTextToClipboard(apiKey.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 800)
    }
  }

  const handleGenerate = async () => {
    await generateApiKey()
    setConfirmAction(null)
    setShowKey(true)
  }

  const handleRevoke = async () => {
    await revokeApiKey()
    setConfirmAction(null)
    setShowKey(false)
  }

  const hasKey = apiKey?.has_key

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {t('settings.apiKeyDesc')} <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{t('settings.authHeader')}</span>{t('settings.header')}
      </p>

      {hasKey && apiKey?.api_key && (
        <div>
          <label style={labelStyle}>{t('settings.yourApiKey')}</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                readOnly
                value={apiKey.api_key}
                style={{
                  ...inputStyle,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontSize: 12,
                  paddingRight: 64,
                }}
              />
              <div
                className="absolute flex items-center gap-1"
                style={{
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <button
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    padding: 2,
                    transition: 'color 150ms ease',
                  }}
                  onClick={() => setShowKey(!showKey)}
                  type="button"
                >
                  {showKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                </button>
                <button
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: copied ? 'var(--green)' : 'var(--text-dim)',
                    padding: 2,
                    transition: 'color 150ms ease',
                  }}
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasKey && !apiKeyLoading && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            borderLeft: '2px solid var(--border)',
            background: 'var(--bg-elevated)',
            borderRadius: 2,
          }}
        >
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('settings.noApiKey')}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {hasKey ? (
          <>
            <button
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
              disabled={apiKeyLoading}
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'border-color 150ms ease',
              }}
              onClick={() => setConfirmAction('regenerate')}
            >
              <RefreshCw size={12} strokeWidth={1.5} />
              {t('settings.regenerate')}
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
              disabled={apiKeyLoading}
              style={{
                background: 'transparent',
                color: 'var(--red)',
                border: '1px solid var(--red)',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'opacity 150ms ease',
              }}
              onClick={() => setConfirmAction('revoke')}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              {t('settings.revoke')}
            </button>
          </>
        ) : (
          <button
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
            disabled={apiKeyLoading}
            style={{
              background: 'var(--blue)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onClick={handleGenerate}
          >
            <Key size={12} strokeWidth={1.5} />
            {t('settings.generateKey')}
          </button>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            background: 'var(--bg-overlay)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
          }}
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="flex flex-col gap-4 p-6"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              width: 400,
              maxWidth: '90vw',
              animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14, margin: 0 }}>
              {confirmAction === 'regenerate' ? t('settings.regenerateTitle') : t('settings.revokeTitle')}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              {confirmAction === 'regenerate' ? t('settings.regenerateMsg') : t('settings.revokeMsg')}
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                className="px-3 py-2 text-xs"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
                onClick={() => setConfirmAction(null)}
              >
                {t('settings.cancel')}
              </button>
              <button
                className="px-3 py-2 text-xs font-semibold"
                style={{
                  background: confirmAction === 'revoke' ? 'var(--red)' : 'var(--blue)',
                  color: 'var(--text-inverse)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                onClick={confirmAction === 'regenerate' ? handleGenerate : handleRevoke}
              >
                {confirmAction === 'regenerate' ? t('settings.regenerate') : t('settings.revoke')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelsTab() {
  const { t } = useTranslation()
  const env = useSettingsStore((s) => s.env)
  const models = useSettingsStore((s) => s.models)
  const fetchEnv = useSettingsStore((s) => s.fetchEnv)
  const fetchModels = useSettingsStore((s) => s.fetchModels)
  const saveEnv = useSettingsStore((s) => s.saveEnv)
  const fetchVisionModel = useSettingsStore((s) => s.fetchVisionModel)
  const saveVisionModel = useSettingsStore((s) => s.saveVisionModel)

  const [baseUrl, setBaseUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connStatus, setConnStatus] = useState(null) // null | 'loading' | 'success' | 'error'
  const [connMsg, setConnMsg] = useState('')
  const [connDirty, setConnDirty] = useState(false)
  const [connSaving, setConnSaving] = useState(false)

  const [defaultModel, setDefaultModel] = useState('')
  const [opusModel, setOpusModel] = useState('')
  const [sonnetModel, setSonnetModel] = useState('')
  const [haikuModel, setHaikuModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [visionModel, setVisionModel] = useState('')
  const [visionDirty, setVisionDirty] = useState(false)
  const [visionSaving, setVisionSaving] = useState(false)

  useEffect(() => {
    fetchEnv().then((data) => {
      if (data?.env) {
        setBaseUrl(data.env.ANTHROPIC_BASE_URL || '')
        setAuthToken(data.env.ANTHROPIC_AUTH_TOKEN || '')
        setDefaultModel(data.env.ANTHROPIC_MODEL || '')
        setOpusModel(data.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '')
        setSonnetModel(data.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '')
        setHaikuModel(data.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '')
      }
    })
    fetchVisionModel().then((vm) => {
      if (vm) setVisionModel(vm)
    })
    if (models.length === 0) fetchModels()
  }, [fetchEnv, fetchModels, fetchVisionModel, models.length])

  const testConnection = useCallback(async () => {
    if (!baseUrl.trim() || !authToken.trim()) return
    setConnStatus('loading')
    setConnMsg('')

    try {
      await saveEnv({
        ANTHROPIC_BASE_URL: baseUrl.trim(),
        ANTHROPIC_AUTH_TOKEN: authToken.trim(),
      })
    } catch {
      setConnStatus('error')
      setConnMsg(t('settings.failedToSave'))
      return
    }

    const result = await fetchModels()
    if (result.length > 0) {
      setConnStatus('success')
      setConnMsg(t('settings.connectedModels', { count: result.length }))
      setConnDirty(false)
    } else {
      setConnStatus('error')
      setConnMsg(useSettingsStore.getState().modelsError || t('settings.connectionFailed'))
    }
  }, [baseUrl, authToken, saveEnv, fetchModels])

  const handleConnBlur = () => {
    if (baseUrl.trim() && authToken.trim() && connDirty) {
      testConnection()
    }
  }

  const handleConnSave = async () => {
    setConnSaving(true)
    try {
      await saveEnv({
        ANTHROPIC_BASE_URL: baseUrl.trim(),
        ANTHROPIC_AUTH_TOKEN: authToken.trim(),
      })
      setConnDirty(false)
      await testConnection()
    } catch {
      // handled
    } finally {
      setConnSaving(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveEnv({
        ANTHROPIC_MODEL: defaultModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
      })
      setDirty(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  const modelFields = [
    { label: t('settings.defaultModel'), value: defaultModel, setter: setDefaultModel },
    { label: t('settings.opusModel'), value: opusModel, setter: setOpusModel },
    { label: t('settings.sonnetModel'), value: sonnetModel, setter: setSonnetModel },
    { label: t('settings.haikuModel'), value: haikuModel, setter: setHaikuModel },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* API Connection */}
      <div>
        <label style={labelStyle}>{t('settings.baseUrl')}</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => { setBaseUrl(e.target.value); setConnDirty(true) }}
          onBlur={handleConnBlur}
          placeholder="http://your-api-server:port/"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>{t('settings.authToken')}</label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={authToken}
            onChange={(e) => { setAuthToken(e.target.value); setConnDirty(true) }}
            onBlur={handleConnBlur}
            placeholder="sk-..."
            style={{ ...inputStyle, paddingRight: 36 }}
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

      {connStatus && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            borderLeft: `2px solid ${connStatus === 'success' ? 'var(--green)' : connStatus === 'error' ? 'var(--red)' : 'var(--yellow)'}`,
            background: 'var(--bg-elevated)',
            borderRadius: 2,
          }}
        >
          {connStatus === 'loading' && <span className="text-xs" style={{ color: 'var(--yellow)' }}>{t('settings.connecting')}</span>}
          {connStatus === 'success' && (
            <>
              <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
              <span className="text-xs" style={{ color: 'var(--green)' }}>{connMsg}</span>
            </>
          )}
          {connStatus === 'error' && (
            <>
              <AlertCircle size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
              <span className="text-xs" style={{ color: 'var(--red)' }}>{connMsg}</span>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          className="px-4 py-2 text-xs font-semibold"
          disabled={connSaving || !connDirty}
          style={{
            background: connDirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: connDirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: connDirty ? 'pointer' : 'default',
            opacity: connDirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleConnSave}
        >
          {connSaving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid var(--border)' }} />

      {/* Model Selectors */}
      {modelFields.map(({ label, value, setter }) => (
        <FilterableModelSelect
          key={label}
          label={label}
          models={models}
          value={value}
          onChange={(v) => { setter(v); setDirty(true) }}
          labelStyle={labelStyle}
          inputStyle={inputStyle}
          placeholder={t('settings.selectModel')}
          filterPlaceholder={t('settings.filterModels')}
          noMatchesText={t('settings.noMatches')}
        />
      ))}
      <div className="flex justify-end">
        <button
          className="px-4 py-2 text-xs font-semibold"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid var(--border)' }} />

      {/* Vision Model */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
          {t('settings.visionModel')}
        </span>
        <span className="text-xs font-light" style={{ color: 'var(--text-dim)' }}>
          {t('settings.visionModelDesc')}
        </span>
        <FilterableModelSelect
          label={t('settings.visionModel')}
          models={models}
          value={visionModel}
          onChange={(v) => { setVisionModel(v); setVisionDirty(true) }}
          labelStyle={{ ...labelStyle, display: 'none' }}
          inputStyle={inputStyle}
          placeholder={t('settings.visionModelPlaceholder')}
          filterPlaceholder={t('settings.filterModels')}
          noMatchesText={t('settings.noMatches')}
        />
        <div className="flex items-center gap-2 justify-end">
          {visionModel && (
            <button
              className="px-3 py-2 text-xs"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              onClick={() => { setVisionModel(''); setVisionDirty(true) }}
            >
              {t('settings.clear')}
            </button>
          )}
          <button
            className="px-4 py-2 text-xs font-semibold"
            disabled={visionSaving || !visionDirty}
            style={{
              background: visionDirty ? 'var(--blue)' : 'var(--bg-elevated)',
              color: visionDirty ? 'var(--text-inverse)' : 'var(--text-dim)',
              border: 'none',
              borderRadius: 4,
              cursor: visionDirty ? 'pointer' : 'default',
              opacity: visionDirty ? 1 : 0.5,
            }}
            onClick={async () => {
              setVisionSaving(true)
              try {
                await saveVisionModel(visionModel || null)
                setVisionDirty(false)
              } finally {
                setVisionSaving(false)
              }
            }}
          >
            {visionSaving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function IconPicker({ value, onChange, labelStyle }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef(null)
  const filterRef = useRef(null)

  const filtered = useMemo(() => {
    if (!filter.trim()) return ICON_NAMES
    const q = filter.toLowerCase()
    return ICON_NAMES.filter((name) => name.includes(q))
  }, [filter])

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

  const SelectedIcon = value ? getLucideIcon(value) : null

  return (
    <div>
      <label style={labelStyle}>Icon</label>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          className="flex items-center gap-2 w-full"
          style={{
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: value ? 'var(--text-primary)' : 'var(--text-dim)',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            boxSizing: 'border-box',
          }}
          onClick={() => setOpen(!open)}
        >
          {SelectedIcon ? (
            <>
              <SelectedIcon size={14} strokeWidth={1.5} />
              <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{value}</span>
            </>
          ) : (
            <span>Select icon...</span>
          )}
          <ChevronDown
            size={12}
            strokeWidth={1.5}
            style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}
          />
        </button>

        {open && (
          <div
            className="absolute left-0 right-0 flex flex-col"
            style={{
              top: '100%',
              marginTop: 2,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              maxHeight: 260,
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
                placeholder={t('settings.searchIcons')}
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
              {value && (
                <button
                  type="button"
                  className="flex items-center justify-center"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    padding: 2,
                  }}
                  onClick={() => { onChange(''); setOpen(false); setFilter('') }}
                  title={t('settings.clearIcon')}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div
              className="overflow-y-auto px-2 py-2"
              style={{ maxHeight: 220, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2 }}
            >
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-xs" style={{ color: 'var(--text-dim)', gridColumn: '1 / -1' }}>
                  {t('settings.noMatches')}
                </div>
              ) : (
                filtered.map((name) => {
                  const IconComp = getLucideIcon(name)
                  if (!IconComp) return null
                  const isActive = value === name
                  return (
                    <button
                      key={name}
                      type="button"
                      className="flex items-center justify-center"
                      title={name}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        background: isActive ? 'var(--bg-surface)' : 'transparent',
                        border: isActive ? '1px solid var(--cyan)' : '1px solid transparent',
                        borderRadius: 4,
                        color: isActive ? 'var(--cyan)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'background 150ms ease, color 150ms ease',
                      }}
                      onClick={() => {
                        onChange(name)
                        setOpen(false)
                        setFilter('')
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'var(--bg-surface)'
                          e.currentTarget.style.color = 'var(--text-primary)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--text-secondary)'
                        }
                      }}
                    >
                      <IconComp size={16} strokeWidth={1.5} />
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

function QuickActionsTab() {
  const { t } = useTranslation()
  const quickActions = useSettingsStore((s) => s.quickActions)
  const fetchQuickActions = useSettingsStore((s) => s.fetchQuickActions)
  const saveQuickActions = useSettingsStore((s) => s.saveQuickActions)

  const [items, setItems] = useState([])
  const [editingIndex, setEditingIndex] = useState(null)
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchQuickActions()
  }, [fetchQuickActions])

  useEffect(() => {
    setItems(quickActions.map((qa) => ({ ...qa })))
  }, [quickActions])

  const handleSave = async (updatedItems) => {
    setSaving(true)
    try {
      await saveQuickActions(updatedItems || items)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (index) => {
    const updated = items.filter((_, i) => i !== index)
    setItems(updated)
    await handleSave(updated)
  }

  const handleAdd = async () => {
    if (!newName.trim() || !newPrompt.trim()) return
    const updated = [...items, { name: newName.trim(), prompt: newPrompt.trim(), icon: newIcon.trim() || null }]
    setItems(updated)
    setNewName('')
    setNewPrompt('')
    setNewIcon('')
    setShowAddForm(false)
    await handleSave(updated)
  }

  const handleEditSave = async (index, name, prompt, icon) => {
    const updated = [...items]
    updated[index] = { name, prompt, icon: icon || null }
    setItems(updated)
    setEditingIndex(null)
    await handleSave(updated)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.quickActionsDesc')}
      </p>
      {items.map((item, i) => (
        <div key={i}>
          {editingIndex === i ? (
            <EditForm
              item={item}
              onSave={(name, prompt, icon) => handleEditSave(i, name, prompt, icon)}
              onCancel={() => setEditingIndex(null)}
            />
          ) : (
            <div
              className="flex items-center gap-3 px-3 py-2"
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 4,
                borderLeft: '2px solid var(--border)',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {item.name}
                  </span>
                  {item.icon && (() => {
                    const IconComp = getLucideIcon(item.icon, null)
                    return IconComp
                      ? <IconComp size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                      : <span className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{item.icon}</span>
                  })()}
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  {item.prompt}
                </p>
              </div>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4 }}
                onClick={() => setEditingIndex(i)}
              >
                <Pencil size={12} strokeWidth={1.5} />
              </button>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4 }}
                onClick={() => handleDelete(i)}
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      ))}

      {showAddForm ? (
        <div className="flex flex-col gap-3 px-3 py-3" style={{ background: 'var(--bg-elevated)', borderRadius: 4 }}>
          <div>
            <label style={labelStyle}>{t('settings.name')}</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} placeholder="e.g. Summarize" autoFocus />
          </div>
          <div>
            <label style={labelStyle}>{t('settings.prompt')}</label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              placeholder="e.g. Summarize this code"
            />
          </div>
          <IconPicker value={newIcon} onChange={setNewIcon} labelStyle={labelStyle} />
          <div className="flex items-center gap-2 justify-end">
            <button
              className="px-3 py-1 text-xs"
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => { setShowAddForm(false); setNewName(''); setNewPrompt(''); setNewIcon('') }}
            >
              {t('settings.cancel')}
            </button>
            <button
              className="px-3 py-1 text-xs font-semibold"
              disabled={!newName.trim() || !newPrompt.trim()}
              style={{
                background: newName.trim() && newPrompt.trim() ? 'var(--blue)' : 'var(--bg-surface)',
                color: newName.trim() && newPrompt.trim() ? 'var(--text-inverse)' : 'var(--text-dim)',
                border: 'none',
                borderRadius: 4,
                cursor: newName.trim() && newPrompt.trim() ? 'pointer' : 'default',
              }}
              onClick={handleAdd}
            >
              {t('settings.add')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="flex items-center gap-2 px-3 py-2 text-xs"
          style={{
            background: 'transparent',
            border: '1px dashed var(--border)',
            borderRadius: 4,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onClick={() => setShowAddForm(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.borderColor = 'var(--border-strong)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-dim)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <Plus size={14} strokeWidth={1.5} />
          {t('settings.addQuickAction')}
        </button>
      )}
    </div>
  )
}

function EditForm({ item, onSave, onCancel }) {
  const { t } = useTranslation()
  const [name, setName] = useState(item.name)
  const [prompt, setPrompt] = useState(item.prompt)
  const [icon, setIcon] = useState(item.icon || '')

  return (
    <div className="flex flex-col gap-3 px-3 py-3" style={{ background: 'var(--bg-elevated)', borderRadius: 4, borderLeft: '2px solid var(--blue)' }}>
      <div>
        <label style={labelStyle}>{t('settings.name')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
      </div>
      <div>
        <label style={labelStyle}>{t('settings.prompt')}</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
      </div>
      <IconPicker value={icon} onChange={setIcon} labelStyle={labelStyle} />
      <div className="flex items-center gap-2 justify-end">
        <button
          className="px-3 py-1 text-xs"
          style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}
          onClick={onCancel}
        >
          {t('settings.cancel')}
        </button>
        <button
          className="px-3 py-1 text-xs font-semibold"
          disabled={!name.trim() || !prompt.trim()}
          style={{
            background: name.trim() && prompt.trim() ? 'var(--blue)' : 'var(--bg-surface)',
            color: name.trim() && prompt.trim() ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: name.trim() && prompt.trim() ? 'pointer' : 'default',
          }}
          onClick={() => onSave(name.trim(), prompt.trim(), icon.trim())}
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  )
}

function AdvancedTab() {
  const { t } = useTranslation()
  const transport = useSettingsStore((s) => s.transport)
  const setTransport = useSettingsStore((s) => s.setTransport)

  const options = [
    { value: 'ws', label: t('settings.transportWs') },
    { value: 'sse', label: t('settings.transportSse') },
  ]

  return (
    <div className="flex flex-col gap-4">
      <label style={{ ...labelStyle, marginBottom: 0 }}>{t('settings.transportMode')}</label>
      <div className="flex gap-2">
        {options.map((opt) => {
          const isActive = transport === opt.value
          return (
            <button
              key={opt.value}
              className="flex items-center gap-2 px-3 py-2 text-sm"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: isActive ? '1px solid var(--blue)' : '1px solid var(--border)',
                borderRadius: 4,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: isActive ? 600 : 400,
                transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
              }}
              onClick={() => setTransport(opt.value)}
            >
              {isActive && <Check size={14} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />}
              {opt.label}
            </button>
          )
        })}
      </div>
      <p
        className="text-xs"
        style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}
      >
        {t('settings.transportNote')}
      </p>
    </div>
  )
}


function SystemPromptTab() {
  const { t } = useTranslation()
  const fetchPresetPrompt = useSettingsStore((s) => s.fetchPresetPrompt)
  const savePresetPrompt = useSettingsStore((s) => s.savePresetPrompt)
  const presetPrompt = useSettingsStore((s) => s.presetPrompt)
  const presetPromptLoading = useSettingsStore((s) => s.presetPromptLoading)

  const [enable, setEnable] = useState(false)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState('edit')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchPresetPrompt().then((data) => {
      if (data) {
        setEnable(data.enable || false)
        setContent(data.content || '')
      }
      setLoaded(true)
    })
  }, [fetchPresetPrompt])

  const handleSave = async () => {
    setSaving(true)
    try {
      await savePresetPrompt({ enable, content: content || null })
      setDirty(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  if (!loaded || presetPromptLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton" style={{ height: 16, width: '60%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
        <div className="skeleton" style={{ height: 200, width: '100%' }} />
      </div>
    )
  }

  const enableOptions = [
    { value: true, label: t('settings.systemPromptOn') },
    { value: false, label: t('settings.systemPromptOff') },
  ]

  const viewOptions = [
    { value: 'edit', label: t('settings.systemPromptEdit') },
    { value: 'preview', label: t('settings.systemPromptPreview') },
  ]

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.systemPromptDesc')}
      </p>

      {/* Enable toggle */}
      <div className="flex gap-2">
        {enableOptions.map((opt) => {
          const isActive = enable === opt.value
          return (
            <button
              key={String(opt.value)}
              className="flex items-center gap-2 px-3 py-2 text-sm"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: isActive ? '1px solid var(--blue)' : '1px solid var(--border)',
                borderRadius: 4,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: isActive ? 600 : 400,
                transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
              }}
              onClick={() => { setEnable(opt.value); setDirty(true) }}
            >
              {isActive && <Check size={14} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />}
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Content section */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <label style={labelStyle}>{t('settings.systemPromptContent')}</label>
          <div className="flex gap-1">
            {viewOptions.map((opt) => {
              const isActive = viewMode === opt.value
              return (
                <button
                  key={opt.value}
                  className="px-2 py-1 text-xs"
                  style={{
                    background: isActive ? 'var(--bg-elevated)' : 'transparent',
                    border: isActive ? '1px solid var(--border-strong)' : '1px solid transparent',
                    borderRadius: 4,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                  onClick={() => setViewMode(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {viewMode === 'edit' ? (
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true) }}
            placeholder={t('settings.systemPromptEmpty')}
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              minHeight: 200,
              resize: 'vertical',
              overflowX: 'auto',
              whiteSpace: 'pre',
            }}
          />
        ) : (
          <pre
            style={{
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: 200,
              margin: 0,
              boxSizing: 'border-box',
            }}
          >
            {content || t('settings.systemPromptEmpty')}
          </pre>
        )}

        <div className="flex justify-end" style={{ marginTop: 4 }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {t('settings.systemPromptChars', { count: (content || '').length })}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          className="px-4 py-2 text-xs font-semibold"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      {/* History Retention section */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <HistoryRetentionSection />
      </div>

      {/* CLI Path section */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <CliPathSection />
      </div>

      {/* Tool Retry section */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <ToolRetrySection />
      </div>

      {/* Sensitive Data Masking section */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <SensitivePatternsSection />
      </div>
    </div>
  )
}


function HistoryRetentionSection() {
  const { t } = useTranslation()
  const [days, setDays] = useState(7)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getHistoryRetention().then((data) => {
      setDays(data.history_retention_days ?? 7)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateHistoryRetention({ history_retention_days: days })
      setDirty(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="skeleton" style={{ height: 36, width: '100%' }} />
  }

  return (
    <div className="flex flex-col gap-3">
      <label style={{ ...labelStyle, marginBottom: 0 }}>{t('settings.historyRetention')}</label>
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.historyRetentionDesc')}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          value={days}
          onChange={(e) => { setDays(parseInt(e.target.value, 10) || 0); setDirty(true) }}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            padding: '6px 10px',
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            outline: 'none',
            width: 72,
            textAlign: 'center',
          }}
        />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {days > 0 ? t('settings.historyRetentionDays') : t('settings.historyRetentionDisabled')}
        </span>
        <button
          className="px-3 py-1 text-xs font-semibold flex-shrink-0"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}


function CliPathSection() {
  const { t } = useTranslation()
  const [cliPath, setCliPath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getCliPath().then((data) => {
      setCliPath(data.cli_path || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateCliPath({ cli_path: cliPath || null })
      setDirty(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="skeleton" style={{ height: 36, width: '100%' }} />
  }

  return (
    <div className="flex flex-col gap-3">
      <label style={{ ...labelStyle, marginBottom: 0 }}>{t('settings.cliPath')}</label>
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.cliPathDesc')}
      </p>
      <div className="flex items-center gap-2">
        <input
          className="flex-1"
          value={cliPath}
          onChange={(e) => { setCliPath(e.target.value); setDirty(true) }}
          placeholder="/usr/local/bin/claude"
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, color: 'var(--text-primary)', padding: '6px 10px',
            fontSize: 13, fontFamily: 'var(--font-mono)',
            outline: 'none', minWidth: 0,
          }}
        />
        <button
          className="px-3 py-1 text-xs font-semibold flex-shrink-0"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none', borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}


function ToolRetrySection() {
  const { t } = useTranslation()
  const [tools, setTools] = useState([])
  const [callbackType, setCallbackType] = useState('none')
  const [callbackScript, setCallbackScript] = useState('')
  const [wecomConfig, setWecomConfig] = useState({
    api_url: '', key: '', service_name: '',
  })
  const [newName, setNewName] = useState('')
  const [newRetries, setNewRetries] = useState(3)
  const [newInterval, setNewInterval] = useState(30)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getRetryableTools().then((data) => {
      setTools(data.retryable_tools || [])
      setCallbackType(data.retry_callback_type || 'none')
      setCallbackScript(data.retry_callback_script || '')
      if (data.retry_callback_wecom) {
        setWecomConfig({
          api_url: data.retry_callback_wecom.api_url || '',
          key: data.retry_callback_wecom.key || '',
          service_name: data.retry_callback_wecom.service_name || '',
        })
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateRetryableTools({
        retryable_tools: tools,
        retry_callback_type: callbackType,
        retry_callback_script: callbackType === 'script' ? (callbackScript || null) : null,
        retry_callback_wecom: callbackType === 'wecom' ? wecomConfig : null,
      })
      setDirty(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = () => {
    let name = newName.trim()
    if (!name) return
    if (!name.startsWith('mcp__')) name = 'mcp__' + name
    setTools([...tools, { name, max_retries: newRetries, interval_seconds: newInterval }])
    setNewName('')
    setNewRetries(3)
    setNewInterval(30)
    setDirty(true)
  }

  const handleRemove = (idx) => {
    setTools(tools.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const updateWecom = (field, value) => {
    setWecomConfig((prev) => ({ ...prev, [field]: value }))
    setDirty(true)
  }

  if (!loaded) {
    return <div className="skeleton" style={{ height: 36, width: '100%' }} />
  }

  const selectStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
    minWidth: 180,
  }

  return (
    <div className="flex flex-col gap-3">
      <label style={{ ...labelStyle, marginBottom: 0 }}>{t('settings.toolRetry')}</label>
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {t('settings.toolRetryDesc')}
      </p>

      {/* Tool list */}
      {tools.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--text-dim)', margin: 0, fontStyle: 'italic' }}>
          {t('settings.retryNoTools')}
        </p>
      )}
      {tools.map((tool, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2"
          style={{
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            padding: '6px 10px',
            borderRadius: 2,
          }}
        >
          <span
            className="flex-1 truncate text-xs"
            style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", color: 'var(--text-primary)', minWidth: 0 }}
          >
            {tool.name}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {tool.max_retries}x / {tool.interval_seconds}s
          </span>
          <button
            className="flex-shrink-0"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 2,
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            onClick={() => handleRemove(idx)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}

      {/* Add row */}
      <div className="flex items-end gap-2">
        <div className="flex-1" style={{ minWidth: 0 }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
            {t('settings.retryToolName')}
          </span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="mcp__server__tool_name"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              padding: '6px 10px',
              width: '100%',
            }}
          />
        </div>
        <div style={{ width: 56, flexShrink: 0 }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
            {t('settings.retryMaxRetries')}
          </span>
          <input
            type="number"
            min="1"
            value={newRetries}
            onChange={(e) => setNewRetries(parseInt(e.target.value, 10) || 1)}
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              padding: '6px 4px',
              width: '100%',
              textAlign: 'center',
            }}
          />
        </div>
        <div style={{ width: 56, flexShrink: 0 }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
            {t('settings.retryInterval')}
          </span>
          <input
            type="number"
            min="1"
            value={newInterval}
            onChange={(e) => setNewInterval(parseInt(e.target.value, 10) || 1)}
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              padding: '6px 4px',
              width: '100%',
              textAlign: 'center',
            }}
          />
        </div>
        <button
          className="flex-shrink-0"
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 4,
            cursor: 'pointer', color: 'var(--text-secondary)', padding: '6px 8px',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)'; e.currentTarget.style.borderColor = 'var(--blue)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          onClick={handleAdd}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Callback Type selector */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <label style={{ ...labelStyle, marginBottom: 4 }}>{t('settings.retryCallbackType')}</label>
        <select
          value={callbackType}
          onChange={(e) => { setCallbackType(e.target.value); setDirty(true) }}
          style={selectStyle}
        >
          <option value="none">{t('settings.retryCallbackNone')}</option>
          <option value="script">{t('settings.retryCallbackScript')}</option>
          <option value="wecom">{t('settings.retryCallbackWecom')}</option>
        </select>
      </div>

      {/* Script callback fields */}
      {callbackType === 'script' && (
        <div className="flex flex-col gap-2" style={{ marginTop: 4 }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            {t('settings.retryCallbackScriptDesc')}
          </p>
          <input
            value={callbackScript}
            onChange={(e) => { setCallbackScript(e.target.value); setDirty(true) }}
            placeholder="/path/to/notify.sh"
            style={{
              ...inputStyle,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              padding: '6px 10px',
            }}
          />
        </div>
      )}

      {/* WeCom callback fields */}
      {callbackType === 'wecom' && (
        <div className="flex flex-col gap-3" style={{ marginTop: 4 }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            {t('settings.retryWecomDesc')}
          </p>

          {/* API URL */}
          <div>
            <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
              {t('settings.retryWecomApiUrl')}
            </span>
            <input
              value={wecomConfig.api_url}
              onChange={(e) => updateWecom('api_url', e.target.value)}
              placeholder="https://api.example.com/send"
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 12, padding: '6px 10px' }}
            />
          </div>

          {/* Key + Service Name row */}
          <div className="flex gap-3">
            <div className="flex-1" style={{ minWidth: 0 }}>
              <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                {t('settings.retryWecomKey')}
              </span>
              <input
                type="password"
                value={wecomConfig.key}
                onChange={(e) => updateWecom('key', e.target.value)}
                placeholder="keyid"
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 12, padding: '6px 10px' }}
              />
            </div>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <span className="text-xs" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                {t('settings.retryWecomServiceName')}
              </span>
              <input
                value={wecomConfig.service_name}
                onChange={(e) => updateWecom('service_name', e.target.value)}
                placeholder="vivian-agent"
                style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
              />
            </div>
          </div>

        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end" style={{ marginTop: 4 }}>
        <button
          className="px-3 py-1 text-xs font-semibold flex-shrink-0"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}


function _applyOnePattern(entry, text) {
  if (!text) return text
  try {
    const re = new RegExp(entry.pattern, 'g')
    return text.replace(re, (...args) => {
      const groups = args.slice(1, -2)
      let mask = entry.mask
      for (let i = 0; i < groups.length; i++) {
        mask = mask.split('\\' + (i + 1)).join(groups[i] ?? '')
      }
      return mask
    })
  } catch {
    return text
  }
}

function SensitivePatternsSection() {
  const { t } = useTranslation()
  const [enable, setEnable] = useState(false)
  const [patterns, setPatterns] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [newMask, setNewMask] = useState('')
  const [addError, setAddError] = useState(null)
  const [testInput, setTestInput] = useState('')

  const labelStyle = {
    fontSize: 11, color: 'var(--text-dim)', fontWeight: 600,
    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4,
  }

  const inputStyle = {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '6px 10px', color: 'var(--text-primary)',
    fontSize: 12, width: '100%', boxSizing: 'border-box',
    transition: 'border-color 150ms ease',
  }

  const monoCell = {
    fontSize: 12, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }

  useEffect(() => {
    let cancelled = false
    getSensitivePatterns().then((data) => {
      if (!cancelled) {
        setEnable(Boolean(data?.enable))
        setPatterns(Array.isArray(data?.patterns) ? data.patterns : [])
        setLoaded(true)
      }
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const handleAdd = () => {
    if (!newName.trim() || !newPattern.trim() || !newMask.trim()) {
      setAddError(t('hooks.sensitivePatternInvalid'))
      return
    }
    try {
      new RegExp(newPattern)
    } catch {
      setAddError(t('hooks.sensitivePatternInvalid'))
      return
    }
    setPatterns((prev) => [...prev, { name: newName.trim(), pattern: newPattern, mask: newMask }])
    setNewName('')
    setNewPattern('')
    setNewMask('')
    setAddError(null)
    setDirty(true)
  }

  const handleDelete = (idx) => {
    setPatterns((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSensitivePatterns({ enable, patterns })
      setDirty(false)
    } catch (e) {
      setAddError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Per-row test output (memoized)
  const testOutputs = useMemo(() => {
    if (!testInput) return patterns.map(() => null)
    return patterns.map((entry) => {
      const result = _applyOnePattern(entry, testInput)
      return { text: result, matched: result !== testInput }
    })
  }, [testInput, patterns])

  if (!loaded) {
    return (
      <div className="flex flex-col gap-2">
        <div className="skeleton" style={{ height: 16, width: 180, borderRadius: 2 }} />
        <div className="skeleton" style={{ height: 36, borderRadius: 2 }} />
        <div className="skeleton" style={{ height: 36, borderRadius: 2 }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          {t('hooks.sensitivePatterns')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
          {t('hooks.sensitivePatternsDesc')}
        </div>
      </div>

      {/* Enable PII-before-model toggle */}
      <label
        className="flex items-center gap-2"
        style={{
          fontSize: 12,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          padding: '8px 10px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderLeft: enable ? '2px solid var(--cyan)' : '1px solid var(--border)',
          borderRadius: 2,
        }}
      >
        <input
          type="checkbox"
          checked={enable}
          onChange={(e) => { setEnable(e.target.checked); setDirty(true) }}
          style={{ accentColor: 'var(--cyan)', cursor: 'pointer' }}
        />
        <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{t('hooks.piiMaskBeforeModel')}</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {t('hooks.piiMaskBeforeModelDesc')}
          </span>
        </div>
      </label>

      {/* Test input */}
      <div className="flex items-center gap-2">
        <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>{t('hooks.sensitiveTestTitle')}</div>
        <input
          className="flex-1"
          style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", minWidth: 0 }}
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder={t('hooks.sensitiveTestPlaceholder')}
          onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
        />
      </div>

      {/* Column headers */}
      {patterns.length > 0 && (
        <div className="flex items-center gap-2" style={{ ...labelStyle, marginBottom: 0 }}>
          <span style={{ width: 80, flexShrink: 0 }}>{t('hooks.sensitivePatternName')}</span>
          <span className="flex-1" style={{ minWidth: 0 }}>{t('hooks.sensitivePatternRegex')}</span>
          <span style={{ width: 90, flexShrink: 0 }}>{t('hooks.sensitivePatternMask')}</span>
          {testInput && <span className="flex-1" style={{ minWidth: 0 }}>{t('hooks.sensitiveTestOutput')}</span>}
          <span style={{ width: 20, flexShrink: 0 }} />
        </div>
      )}

      {/* Existing rows */}
      {patterns.map((entry, idx) => {
        const output = testOutputs[idx]
        return (
          <div key={idx} className="flex items-center gap-2">
            <div
              className="px-2 py-1"
              style={{
                ...monoCell, width: 80, flexShrink: 0,
                fontSize: 11, color: 'var(--cyan)', fontWeight: 600,
              }}
              title={entry.name}
            >
              {entry.name}
            </div>
            <div
              className="flex-1 px-2 py-1"
              style={{ ...monoCell, color: 'var(--text-primary)', wordBreak: 'break-all', minWidth: 0 }}
            >
              {entry.pattern}
            </div>
            <div
              className="px-2 py-1"
              style={{ ...monoCell, width: 90, flexShrink: 0, color: 'var(--text-secondary)' }}
              title={entry.mask}
            >
              {entry.mask}
            </div>
            {testInput && (
              <div
                className="flex-1 px-2 py-1"
                style={{
                  ...monoCell, minWidth: 0, wordBreak: 'break-all',
                  color: output?.matched ? 'var(--green)' : 'var(--text-dim)',
                  borderLeft: output?.matched ? '2px solid var(--green)' : '1px solid var(--border-subtle)',
                }}
                title={output?.text}
              >
                {output?.text || '—'}
              </div>
            )}
            <button
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', padding: 2, flexShrink: 0,
                transition: 'color 150ms ease',
              }}
              onClick={() => handleDelete(idx)}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </div>
        )
      })}

      {patterns.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {t('hooks.noSensitivePatterns')}
        </div>
      )}

      {/* Add row */}
      <div
        className="flex flex-col gap-2"
        style={{
          marginTop: 6, paddingTop: 10,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <div style={labelStyle}>{t('hooks.addSensitivePattern')}</div>
        <div className="flex items-center gap-2">
          <input
            style={{ ...inputStyle, width: 80, flex: 'none' }}
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setAddError(null) }}
            placeholder={t('hooks.sensitivePatternNamePlaceholder')}
            onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            value={newPattern}
            onChange={(e) => { setNewPattern(e.target.value); setAddError(null) }}
            placeholder={t('hooks.sensitivePatternRegexPlaceholder')}
            onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
          <input
            style={{ ...inputStyle, width: 90, flex: 'none' }}
            value={newMask}
            onChange={(e) => { setNewMask(e.target.value); setAddError(null) }}
            placeholder={t('hooks.sensitivePatternMaskPlaceholder')}
            onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
          <button
            onClick={handleAdd}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--blue)', cursor: 'pointer',
              padding: '6px 8px', flexShrink: 0, transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        </div>
        {addError && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>{addError}</div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end" style={{ marginTop: 4 }}>
        <button
          className="px-4 py-2 text-xs font-semibold"
          disabled={saving || !dirty}
          style={{
            background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
            color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none', borderRadius: 4,
            cursor: dirty ? 'pointer' : 'default',
            opacity: dirty ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          onClick={handleSave}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}


/**
 * SettingsPanel renders the tab content only when given an `activeTabOverride` prop.
 * Used by SettingsOverlay to render the appropriate settings tab.
 */
export default function SettingsPanel({ activeTabOverride }) {
  const activeTab = activeTabOverride || 'api'

  return (
    <>
      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'api' && <ApiKeyTab />}
      {activeTab === 'models' && <ModelsTab />}
      {activeTab === 'quickactions' && <QuickActionsTab />}
      {activeTab === 'channels' && <ChannelsTab />}
      {activeTab === 'advanced' && <AdvancedTab />}
      {activeTab === 'systemprompt' && <SystemPromptTab />}
      {activeTab === 'plugins' && <PluginsTab />}
      {activeTab === 'webterminal' && <AdminWebTerminalTab />}
    </>
  )
}
