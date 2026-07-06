import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Radio, Eye, EyeOff, X, Plus, RefreshCw, Power, AlertTriangle, MessageSquare, Send, Check } from 'lucide-react'
import useChannelStore from '../../stores/channelStore'
import useUiStore from '../../stores/uiStore'
import CopyButton from '../shared/CopyButton'
import Tabs from '../shared/Tabs'

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

const STATUS_COLORS = {
  connected: 'var(--green)',
  connecting: 'var(--yellow)',
  auth_failed: 'var(--red)',
  error: 'var(--red)',
  disconnected: 'var(--border)',
}

const STATUS_LABELS = {
  connected: 'settings.wecomConnected',
  connecting: 'settings.wecomConnecting',
  auth_failed: 'settings.wecomAuthFailed',
  error: 'settings.wecomError',
  disconnected: 'settings.wecomDisconnected',
}

const CHANNEL_TABS = [
  { id: 'wecom', labelKey: 'settings.channelTabWecom', disabled: false },
  { id: 'feishu', labelKey: 'settings.channelTabFeishu', disabled: true },
  { id: 'openclaw', labelKey: 'settings.channelTabOpenClaw', disabled: false },
]

// Single-chat access modes. Group chats are always open (no entry here).
const ACCESS_MODES = [
  { value: 'all', labelKey: 'settings.wecomAccessAll', descKey: 'settings.wecomAccessAllDesc' },
  { value: 'allowed_user_ids', labelKey: 'settings.wecomAccessAllowed', descKey: 'settings.wecomAccessAllowedDesc' },
  { value: 'private', labelKey: 'settings.wecomAccessPrivate', descKey: 'settings.wecomAccessPrivateDesc' },
]

const OC_STATUS_COLORS = {
  connected: 'var(--green)',
  connecting: 'var(--yellow)',
  error: 'var(--red)',
  disconnected: 'var(--border)',
}

const OC_STATUS_LABELS = {
  connected: 'settings.openclawConnected',
  connecting: 'settings.openclawConnecting',
  error: 'settings.openclawError',
  disconnected: 'settings.openclawDisconnected',
}

/* ── Sub-tab bar ── */
function ChannelSubTabs({ activeTab, onSelect, t }) {
  return (
    <Tabs
      tabs={CHANNEL_TABS}
      activeKey={activeTab}
      onChange={(_, tab) => onSelect(tab.id)}
      className="flex items-center gap-1"
      style={{ borderBottom: '1px solid var(--border)' }}
      buttonClassName="flex items-center gap-2 px-4 py-2 text-sm"
      buttonStyle={{
        fontSize: 13,
        marginBottom: -1,
      }}
      getButtonStyle={({ active, disabled }) => ({
        color: disabled
          ? 'var(--text-dim)'
          : active
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      })}
      renderLabel={(tab) => (
        <span className="flex items-center gap-2">
          {t(tab.labelKey)}
          {tab.disabled && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'var(--text-dim)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: '1px 5px',
                textTransform: 'uppercase',
              }}
            >
              {t('settings.channelTabSoon')}
            </span>
          )}
        </span>
      )}
    />
  )
}

/* ── Feishu coming-soon panel ── */
function FeishuPanel({ t }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12"
      style={{ color: 'var(--text-dim)' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 48,
          height: 48,
          borderRadius: 4,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}
      >
        <MessageSquare size={24} strokeWidth={1.5} />
      </div>
      <span style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
      }}>
        {t('settings.feishuTitle')}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--yellow)',
      }}>
        {t('settings.feishuComingSoon')}
      </span>
      <p style={{
        fontSize: 12,
        color: 'var(--text-dim)',
        textAlign: 'center',
        maxWidth: 320,
        lineHeight: 1.5,
      }}>
        {t('settings.feishuDesc')}
      </p>
    </div>
  )
}

/* ── WeCom config form (scrollable content only) ── */
function WeComConfigForm({ t }) {
  const config = useChannelStore((s) => s.config)
  const configLoading = useChannelStore((s) => s.configLoading)
  const status = useChannelStore((s) => s.status)
  const saving = useChannelStore((s) => s.saving)
  const connecting = useChannelStore((s) => s.connecting)
  const error = useChannelStore((s) => s.error)
  const fetchConfig = useChannelStore((s) => s.fetchConfig)
  const saveConfig = useChannelStore((s) => s.saveConfig)
  const connect = useChannelStore((s) => s.connect)
  const disconnect = useChannelStore((s) => s.disconnect)
  const reconnect = useChannelStore((s) => s.reconnect)
  const fetchStatus = useChannelStore((s) => s.fetchStatus)
  const showConfirm = useUiStore((s) => s.showConfirm)

  const [form, setForm] = useState({})
  const [showSecret, setShowSecret] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [userIdInput, setUserIdInput] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    fetchConfig()
    fetchStatus()
  }, [fetchConfig, fetchStatus])

  useEffect(() => {
    if (config) {
      setForm({
        bot_id: config.bot_id || '',
        secret: config.secret_masked || '',
        ws_proxy_url: config.ws_proxy_url || '',
        allowed_user_ids: config.allowed_user_ids || [],
        single_chat_access_mode: config.single_chat_access_mode || 'private',
        welcome_message: config.welcome_message || '',
        reject_message: config.reject_message || '',
        model: config.model || '',
        max_queue_size: config.max_queue_size || 3,
        idle_session_timeout_minutes: config.idle_session_timeout_minutes || 60,
      })
      setDirty(false)
    }
  }, [config])

  useEffect(() => {
    pollRef.current = setInterval(() => fetchStatus(), 5000)
    return () => clearInterval(pollRef.current)
  }, [fetchStatus])

  const updateField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const handleSave = async () => {
    const data = { ...form }
    if (!data.model) data.model = null
    try {
      await saveConfig(data)
      setDirty(false)
    } catch {
      // error set in store
    }
  }

  const handleAddUserId = () => {
    const id = userIdInput.trim()
    if (!id || form.allowed_user_ids.includes(id)) return
    updateField('allowed_user_ids', [...form.allowed_user_ids, id])
    setUserIdInput('')
  }

  const handleRemoveUserId = (id) => {
    updateField('allowed_user_ids', form.allowed_user_ids.filter((x) => x !== id))
  }

  const handleClearUserIds = () => {
    if (!form.allowed_user_ids?.length) return
    updateField('allowed_user_ids', [])
  }

  const handleConnect = () => connect()
  const handleDisconnect = () => {
    showConfirm({
      title: t('settings.wecomDisconnectTitle'),
      message: t('settings.wecomDisconnectConfirm'),
      confirmLabel: t('settings.wecomDisconnect'),
      danger: true,
      onConfirm: () => disconnect(),
    })
  }
  const handleReconnect = () => reconnect()

  if (configLoading && !config) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton" style={{ height: 16, width: '40%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
        <div className="skeleton" style={{ height: 80, width: '100%' }} />
      </div>
    )
  }

  const connStatus = status?.status || 'disconnected'
  const isEnabled = config?.enabled

  return (
    <div className="flex flex-col gap-6">
      {/* Connection status bar */}
      <div
        className="flex flex-col px-4 py-3 gap-2"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: `2px solid ${STATUS_COLORS[connStatus] || 'var(--border)'}`,
          borderRadius: '0 4px 4px 0',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{
              color: STATUS_COLORS[connStatus],
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {t(STATUS_LABELS[connStatus] || 'settings.wecomDisconnected')}
            </span>
            {status?.active_sessions > 0 && (
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                {status.active_sessions} {t('settings.wecomActiveSessions')}
              </span>
            )}
            {status?.messages_handled > 0 && (
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                {status.messages_handled} {t('settings.wecomMessagesHandled')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEnabled && (
              <button
                className="flex items-center gap-1 px-3 py-1 text-xs"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--green)',
                  borderRadius: 4,
                  color: 'var(--green)',
                  cursor: connecting ? 'wait' : 'pointer',
                  fontWeight: 600,
                  transition: 'background 150ms ease, transform 100ms ease',
                }}
                onClick={handleConnect}
                onMouseDown={(e) => { if (!connecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                disabled={connecting}
              >
                <Power size={12} strokeWidth={1.5} />
                {t('settings.wecomConnect')}
              </button>
            )}
            {isEnabled && (
              <>
                <button
                  className="flex items-center gap-1 px-3 py-1 text-xs"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: connecting ? 'wait' : 'pointer',
                    fontWeight: 400,
                    transition: 'background 150ms ease, transform 100ms ease',
                  }}
                  onClick={handleReconnect}
                  onMouseDown={(e) => { if (!connecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  disabled={connecting}
                >
                  <RefreshCw size={12} strokeWidth={1.5} />
                  {t('settings.wecomReconnect')}
                </button>
                <button
                  className="flex items-center gap-1 px-3 py-1 text-xs"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--red)',
                    borderRadius: 4,
                    color: 'var(--red)',
                    cursor: connecting ? 'wait' : 'pointer',
                    fontWeight: 600,
                    transition: 'background 150ms ease, transform 100ms ease',
                  }}
                  onClick={handleDisconnect}
                  onMouseDown={(e) => { if (!connecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  disabled={connecting}
                >
                  <Power size={12} strokeWidth={1.5} />
                  {t('settings.wecomDisconnect')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Active session IDs inside status bar */}
        {status?.session_details?.map((sess) => (
          <div key={sess.session_id} className="flex items-center gap-2">
            <span style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              flexShrink: 0,
            }}>
              session id:
            </span>
            <span style={{
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {sess.session_id}
            </span>
            <CopyButton content={sess.session_id} inline />
            {sess.wecom_user_id && (
              <span style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                flexShrink: 0,
              }}>
                {sess.wecom_user_id}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Error message */}
      {(status?.error_message || error) && (
        <div
          className="flex items-start gap-2 px-4 py-3"
          style={{
            background: 'var(--bg-surface)',
            borderLeft: '2px solid var(--red)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, wordBreak: 'break-word' }}>
            {status?.error_message || error}
          </span>
        </div>
      )}

      {/* Empty allowlist info — only meaningful in allowlist mode */}
      {form.single_chat_access_mode === 'allowed_user_ids' && form.allowed_user_ids?.length === 0 && (
        <div
          className="flex items-start gap-2 px-4 py-3"
          style={{
            background: 'var(--bg-surface)',
            borderLeft: '2px solid var(--yellow)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {t('settings.wecomNoUsers')}
          </span>
        </div>
      )}

      {/* Config form */}
      <div className="flex flex-col gap-4">
        {/* Bot ID */}
        <div>
          <label style={labelStyle}>{t('settings.wecomBotId')}</label>
          <input
            type="text"
            value={form.bot_id || ''}
            onChange={(e) => updateField('bot_id', e.target.value)}
            placeholder="aib5gbYLz1N1f83gk..."
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
          />
        </div>

        {/* Secret */}
        <div>
          <label style={labelStyle}>{t('settings.wecomSecret')}</label>
          <div className="flex items-center gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={form.secret || ''}
              onChange={(e) => updateField('secret', e.target.value)}
              placeholder="dWB42TVrwLbteJOOT3..."
              style={{ ...inputStyle, flex: 1, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
            />
            <button
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-dim)',
                cursor: 'pointer',
                padding: '8px 10px',
                transition: 'color 150ms ease',
              }}
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret
                ? <EyeOff size={14} strokeWidth={1.5} />
                : <Eye size={14} strokeWidth={1.5} />
              }
            </button>
          </div>
        </div>

        {/* WS Proxy URL */}
        <div>
          <label style={labelStyle}>{t('settings.wecomProxyUrl')}</label>
          <input
            type="text"
            value={form.ws_proxy_url || ''}
            onChange={(e) => updateField('ws_proxy_url', e.target.value)}
            placeholder="ws://127.0.0.1:9443"
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
          />
          <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
            {t('settings.wecomProxyHint')}
          </p>
        </div>

        {/* Single-chat access mode */}
        <div>
          <label style={labelStyle}>{t('settings.wecomAccessMode')}</label>
          <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {ACCESS_MODES.map((m, i) => {
              const active = (form.single_chat_access_mode || 'private') === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  className="flex items-start gap-3 w-full px-3 py-2 text-left"
                  style={{
                    background: active ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                    borderLeft: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'background 150ms ease, border-color 150ms ease',
                  }}
                  onClick={() => updateField('single_chat_access_mode', m.value)}
                >
                  <span className="flex flex-col min-w-0 flex-1" style={{ gap: 2 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}>
                      {t(m.labelKey)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                      {t(m.descKey)}
                    </span>
                  </span>
                  {active && (
                    <Check size={14} strokeWidth={1.5} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} />
                  )}
                </button>
              )
            })}
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
            {t('settings.wecomAccessGroupHint')}
          </p>
        </div>

        {/* Allowed User IDs — in-field chip input (only for allowlist mode) */}
        {form.single_chat_access_mode === 'allowed_user_ids' && (
          <div>
            <label style={labelStyle}>{t('settings.wecomAllowedUsers')}</label>
            <div
              className="flex flex-wrap items-center gap-1"
              style={{ ...inputStyle, padding: '6px 8px', minHeight: 38, cursor: 'text' }}
              onClick={(e) => { e.currentTarget.querySelector('input')?.focus() }}
            >
              {(form.allowed_user_ids || []).map((id) => (
                <span
                  key={id}
                  className="flex items-center gap-1 px-2"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    paddingTop: 2,
                    paddingBottom: 2,
                    flexShrink: 0,
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  }}
                >
                  {id}
                  <button
                    type="button"
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-dim)',
                      cursor: 'pointer', padding: 0, display: 'flex', transition: 'color 150ms ease',
                    }}
                    onClick={(e) => { e.stopPropagation(); handleRemoveUserId(id) }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={userIdInput}
                onChange={(e) => setUserIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddUserId() }
                  else if (e.key === 'Backspace' && !userIdInput && form.allowed_user_ids?.length) {
                    handleRemoveUserId(form.allowed_user_ids[form.allowed_user_ids.length - 1])
                  }
                }}
                placeholder={form.allowed_user_ids?.length ? '' : t('settings.wecomUserIdPlaceholder')}
                style={{
                  flex: 1, minWidth: 90, background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontSize: 13, padding: '2px 0',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                }}
              />
              {form.allowed_user_ids?.length > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-1"
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
                    fontSize: 11, flexShrink: 0, padding: '0 2px', transition: 'color 150ms ease',
                  }}
                  onClick={(e) => { e.stopPropagation(); handleClearUserIds() }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                >
                  <X size={12} strokeWidth={1.5} />
                  {t('settings.wecomClearAll')}
                </button>
              )}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
              {t('settings.wecomAllowedHint')}
            </p>
          </div>
        )}

        {/* Welcome message */}
        <div>
          <label style={labelStyle}>{t('settings.wecomWelcome')}</label>
          <textarea
            value={form.welcome_message || ''}
            onChange={(e) => updateField('welcome_message', e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 52 }}
          />
        </div>

        {/* Reject message */}
        <div>
          <label style={labelStyle}>{t('settings.wecomRejectMsg')}</label>
          <input
            type="text"
            value={form.reject_message || ''}
            onChange={(e) => updateField('reject_message', e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Model override */}
        <div>
          <label style={labelStyle}>{t('settings.wecomModel')}</label>
          <input
            type="text"
            value={form.model || ''}
            onChange={(e) => updateField('model', e.target.value)}
            placeholder={t('settings.wecomModelHint')}
            style={inputStyle}
          />
        </div>

        {/* Queue size + Session timeout (side by side) */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label style={labelStyle}>{t('settings.wecomMaxQueue')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.max_queue_size || 3}
              onChange={(e) => updateField('max_queue_size', parseInt(e.target.value) || 3)}
              style={inputStyle}
            />
          </div>
          <div className="flex-1">
            <label style={labelStyle}>{t('settings.wecomSessionTimeout')}</label>
            <input
              type="number"
              min={5}
              max={1440}
              value={form.idle_session_timeout_minutes || 60}
              onChange={(e) => updateField('idle_session_timeout_minutes', parseInt(e.target.value) || 60)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            className="flex items-center gap-2 px-4 py-2 text-sm"
            style={{
              background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
              border: dirty ? '1px solid var(--blue)' : '1px solid var(--border)',
              borderRadius: 4,
              color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
              cursor: dirty ? 'pointer' : 'default',
              fontWeight: 600,
              transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
              opacity: saving ? 0.6 : 1,
            }}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── OpenClaw config form ── */
function OpenClawConfigForm({ t }) {
  const ocConfig = useChannelStore((s) => s.ocConfig)
  const ocConfigLoading = useChannelStore((s) => s.ocConfigLoading)
  const ocStatus = useChannelStore((s) => s.ocStatus)
  const ocSaving = useChannelStore((s) => s.ocSaving)
  const ocConnecting = useChannelStore((s) => s.ocConnecting)
  const ocError = useChannelStore((s) => s.ocError)
  const fetchOcConfig = useChannelStore((s) => s.fetchOcConfig)
  const saveOcConfig = useChannelStore((s) => s.saveOcConfig)
  const connectOc = useChannelStore((s) => s.connectOc)
  const disconnectOc = useChannelStore((s) => s.disconnectOc)
  const reconnectOc = useChannelStore((s) => s.reconnectOc)
  const fetchOcStatus = useChannelStore((s) => s.fetchOcStatus)
  const showConfirm = useUiStore((s) => s.showConfirm)

  const [form, setForm] = useState({})
  const [showToken, setShowToken] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [agentIdInput, setAgentIdInput] = useState('')
  const [agentDescInput, setAgentDescInput] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    fetchOcConfig()
    fetchOcStatus()
  }, [fetchOcConfig, fetchOcStatus])

  useEffect(() => {
    if (ocConfig) {
      setForm({
        gateway_url: ocConfig.gateway_url || '',
        auth_token: ocConfig.auth_token_masked || '',
        default_agent: ocConfig.default_agent || 'main',
        max_turns: ocConfig.max_turns || 5,
        timeout_seconds: ocConfig.timeout_seconds || 120,
        agents: ocConfig.agents || [],
      })
      setDirty(false)
    }
  }, [ocConfig])

  useEffect(() => {
    pollRef.current = setInterval(() => fetchOcStatus(), 5000)
    return () => clearInterval(pollRef.current)
  }, [fetchOcStatus])

  const updateField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const handleSave = async () => {
    try {
      await saveOcConfig(form)
      setDirty(false)
    } catch {
      // error set in store
    }
  }

  const handleAddAgent = () => {
    const id = agentIdInput.trim()
    if (!id || form.agents.some((a) => a.id === id)) return
    updateField('agents', [...form.agents, { id, description: agentDescInput.trim() }])
    setAgentIdInput('')
    setAgentDescInput('')
  }

  const handleRemoveAgent = (agentId) => {
    updateField('agents', form.agents.filter((a) => a.id !== agentId))
  }

  const handleConnect = () => connectOc()
  const handleDisconnect = () => {
    showConfirm({
      title: t('settings.openclawDisconnectTitle'),
      message: t('settings.openclawDisconnectConfirm'),
      confirmLabel: t('settings.openclawDisconnect'),
      danger: true,
      onConfirm: () => disconnectOc(),
    })
  }
  const handleReconnect = () => reconnectOc()

  if (ocConfigLoading && !ocConfig) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton" style={{ height: 16, width: '40%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
        <div className="skeleton" style={{ height: 36, width: '100%' }} />
      </div>
    )
  }

  const connStatus = ocStatus?.status || 'disconnected'
  const isEnabled = ocConfig?.enabled

  return (
    <div className="flex flex-col gap-6">
      {/* Connection status bar */}
      <div
        className="flex flex-col px-4 py-3 gap-2"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: `2px solid ${OC_STATUS_COLORS[connStatus] || 'var(--border)'}`,
          borderRadius: '0 4px 4px 0',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{
              color: OC_STATUS_COLORS[connStatus],
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {t(OC_STATUS_LABELS[connStatus] || 'settings.openclawDisconnected')}
            </span>
            {ocStatus?.active_delegations > 0 && (
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                {ocStatus.active_delegations} {t('settings.openclawDelegations')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEnabled && (
              <button
                className="flex items-center gap-1 px-3 py-1 text-xs"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--green)',
                  borderRadius: 4,
                  color: 'var(--green)',
                  cursor: ocConnecting ? 'wait' : 'pointer',
                  fontWeight: 600,
                  transition: 'background 150ms ease, transform 100ms ease',
                }}
                onClick={handleConnect}
                onMouseDown={(e) => { if (!ocConnecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                disabled={ocConnecting}
              >
                <Power size={12} strokeWidth={1.5} />
                {t('settings.openclawConnect')}
              </button>
            )}
            {isEnabled && (
              <>
                <button
                  className="flex items-center gap-1 px-3 py-1 text-xs"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: ocConnecting ? 'wait' : 'pointer',
                    fontWeight: 400,
                    transition: 'background 150ms ease, transform 100ms ease',
                  }}
                  onClick={handleReconnect}
                  onMouseDown={(e) => { if (!ocConnecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  disabled={ocConnecting}
                >
                  <RefreshCw size={12} strokeWidth={1.5} />
                  {t('settings.openclawReconnect')}
                </button>
                <button
                  className="flex items-center gap-1 px-3 py-1 text-xs"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--red)',
                    borderRadius: 4,
                    color: 'var(--red)',
                    cursor: ocConnecting ? 'wait' : 'pointer',
                    fontWeight: 600,
                    transition: 'background 150ms ease, transform 100ms ease',
                  }}
                  onClick={handleDisconnect}
                  onMouseDown={(e) => { if (!ocConnecting) e.currentTarget.style.transform = 'scale(0.95)' }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  disabled={ocConnecting}
                >
                  <Power size={12} strokeWidth={1.5} />
                  {t('settings.openclawDisconnect')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {(ocStatus?.error_message || ocError) && (
        <div
          className="flex items-start gap-2 px-4 py-3"
          style={{
            background: 'var(--bg-surface)',
            borderLeft: '2px solid var(--red)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, wordBreak: 'break-word' }}>
            {ocStatus?.error_message || ocError}
          </span>
        </div>
      )}

      {/* Config form */}
      <div className="flex flex-col gap-4">
        {/* Gateway URL */}
        <div>
          <label style={labelStyle}>{t('settings.openclawGatewayUrl')}</label>
          <input
            type="text"
            value={form.gateway_url || ''}
            onChange={(e) => updateField('gateway_url', e.target.value)}
            placeholder="ws://localhost:18789"
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
          />
        </div>

        {/* Auth Token */}
        <div>
          <label style={labelStyle}>{t('settings.openclawAuthToken')}</label>
          <div className="flex items-center gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.auth_token || ''}
              onChange={(e) => updateField('auth_token', e.target.value)}
              placeholder="shared-secret-token"
              style={{ ...inputStyle, flex: 1, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
            />
            <button
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-dim)',
                cursor: 'pointer',
                padding: '8px 10px',
                transition: 'color 150ms ease',
              }}
              onClick={() => setShowToken(!showToken)}
            >
              {showToken
                ? <EyeOff size={14} strokeWidth={1.5} />
                : <Eye size={14} strokeWidth={1.5} />
              }
            </button>
          </div>
        </div>

        {/* Default Agent */}
        <div>
          <label style={labelStyle}>{t('settings.openclawDefaultAgent')}</label>
          <input
            type="text"
            value={form.default_agent || ''}
            onChange={(e) => updateField('default_agent', e.target.value)}
            placeholder="main"
            style={inputStyle}
          />
        </div>

        {/* Agents list */}
        <div>
          <label style={labelStyle}>{t('settings.openclawAgents')}</label>
          <div className="flex flex-col gap-1" style={{ marginBottom: form.agents?.length ? 6 : 0 }}>
            {(form.agents || []).map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 px-2 py-1"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                <span style={{
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {agent.id}
                </span>
                {agent.description && (
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    flex: 1,
                  }}>
                    {agent.description}
                  </span>
                )}
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    transition: 'color 150ms ease',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}
                  onClick={() => handleRemoveAgent(agent.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={agentIdInput}
              onChange={(e) => setAgentIdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAgent() } }}
              placeholder="agent_id"
              style={{ ...inputStyle, width: 120, flexShrink: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
            />
            <input
              type="text"
              value={agentDescInput}
              onChange={(e) => setAgentDescInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAgent() } }}
              placeholder="description (optional)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              className="flex items-center gap-1 px-3 py-2 text-xs"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 500,
                transition: 'background 150ms ease',
                flexShrink: 0,
              }}
              onClick={handleAddAgent}
            >
              <Plus size={12} strokeWidth={1.5} />
              {t('settings.add')}
            </button>
          </div>
        </div>

        {/* Max Turns + Timeout (side by side) */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label style={labelStyle}>{t('settings.openclawMaxTurns')}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={form.max_turns || 5}
              onChange={(e) => updateField('max_turns', parseInt(e.target.value) || 5)}
              style={inputStyle}
            />
          </div>
          <div className="flex-1">
            <label style={labelStyle}>{t('settings.openclawTimeout')}</label>
            <input
              type="number"
              min={10}
              max={600}
              value={form.timeout_seconds || 120}
              onChange={(e) => updateField('timeout_seconds', parseInt(e.target.value) || 120)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            className="flex items-center gap-2 px-4 py-2 text-sm"
            style={{
              background: dirty ? 'var(--blue)' : 'var(--bg-elevated)',
              border: dirty ? '1px solid var(--blue)' : '1px solid var(--border)',
              borderRadius: 4,
              color: dirty ? 'var(--text-inverse)' : 'var(--text-dim)',
              cursor: dirty ? 'pointer' : 'default',
              fontWeight: 600,
              transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
              opacity: ocSaving ? 0.6 : 1,
            }}
            onClick={handleSave}
            disabled={!dirty || ocSaving}
          >
            {ocSaving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main ChannelsTab with sub-tabs ── */
export default function ChannelsTab() {
  const { t } = useTranslation()
  const [activeChannel, setActiveChannel] = useState('wecom')

  return (
    <div className="flex flex-col">
      {/* Frozen: sub-tab bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--bg-base)',
          paddingBottom: 16,
        }}
      >
        <ChannelSubTabs activeTab={activeChannel} onSelect={setActiveChannel} t={t} />
      </div>

      {activeChannel === 'wecom' && (
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex items-center gap-3">
              <Radio size={16} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('settings.wecomTitle')}
              </span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
              {t('settings.wecomDesc')}
            </p>
          </div>
          <WeComConfigForm t={t} />
        </div>
      )}
      {activeChannel === 'feishu' && <FeishuPanel t={t} />}
      {activeChannel === 'openclaw' && (
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex items-center gap-3">
              <Send size={16} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('settings.openclawTitle')}
              </span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
              {t('settings.openclawDesc')}
            </p>
          </div>
          <OpenClawConfigForm t={t} />
        </div>
      )}
    </div>
  )
}
