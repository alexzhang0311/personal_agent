import { useState, useEffect, useRef } from 'react'
import { X, Plus, Check, AlertCircle, Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useMcpStore from '../../stores/mcpStore'

export default function MCPAddDialog() {
  const { t } = useTranslation()
  const closeAddDialog = useMcpStore((s) => s.closeAddDialog)
  const createServer = useMcpStore((s) => s.createServer)
  const updateServer = useMcpStore((s) => s.updateServer)
  const validateServerAction = useMcpStore((s) => s.validateServer)
  const validating = useMcpStore((s) => s.validating)
  const validateResult = useMcpStore((s) => s.validateResult)
  const addDialogLevel = useMcpStore((s) => s.addDialogLevel)
  const editMode = useMcpStore((s) => s.editMode)
  const editInitialData = useMcpStore((s) => s.editInitialData)

  const [name, setName] = useState('')
  const [type, setType] = useState('http')
  const [url, setUrl] = useState('')
  const [timeout, setTimeout_] = useState(60)
  const [headers, setHeaders] = useState([]) // [{key, value}]
  const [submitting, setSubmitting] = useState(false)
  // Guards setState after the dialog unmounts mid-request.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    if (editMode && editInitialData) {
      setName(editInitialData.name || '')
      setType(editInitialData.type || 'http')
      setUrl(editInitialData.url || '')
      setTimeout_(editInitialData.timeout || 60)
      setHeaders(
        editInitialData.headers?.map((h) => ({ key: h.key, value: h.value })) || []
      )
    }
  }, [editMode, editInitialData])

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }])
  const removeHeader = (index) => setHeaders(headers.filter((_, i) => i !== index))
  const updateHeader = (index, field, value) => {
    const updated = [...headers]
    updated[index] = { ...updated[index], [field]: value }
    setHeaders(updated)
  }

  const isTestPassed = validateResult?.success === true
  const canSubmit = name.trim() && url.trim() && (editMode || isTestPassed) && !submitting

  const handleTest = () => {
    validateServerAction({
      type,
      url,
      headers: headers.filter((h) => h.key.trim()),
      timeout,
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const headersPayload = headers.filter((h) => h.key.trim())
      if (editMode && editInitialData) {
        await updateServer(editInitialData.level, editInitialData.name, {
          type, url, headers: headersPayload, timeout,
        })
      } else {
        await createServer({
          name: name.trim(),
          type, url, headers: headersPayload, timeout,
          level: addDialogLevel,
        })
      }
      closeAddDialog()
    } catch {
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) closeAddDialog()
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)', zIndex: 200 }}
      onClick={handleOverlayClick}
    >
      <div
        className="flex flex-col"
        style={{
          width: 480, maxHeight: '80vh',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 4,
          animation: 'dialog-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14 }}>
            {editMode ? t('mcp.editServer') : t('mcp.addServer')}
          </span>
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease',
            }}
            onClick={closeAddDialog}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {/* Name */}
          <FormField label={t('mcp.name')}>
            <input
              className="w-full px-2 py-1"
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={editMode}
              placeholder="my-mcp-server"
            />
          </FormField>

          {/* Type */}
          <FormField label={t('mcp.type')}>
            <select
              className="w-full px-2 py-1"
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </FormField>

          {/* URL */}
          <FormField label={t('mcp.url')}>
            <input
              className="w-full px-2 py-1"
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              }}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3000/mcp"
            />
          </FormField>

          {/* Timeout */}
          <FormField label={t('mcp.timeout')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="px-2 py-1"
                style={{
                  width: 80, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                }}
                value={timeout}
                onChange={(e) => setTimeout_(Math.max(5, Math.min(600, Number(e.target.value) || 60)))}
                min={5}
                max={600}
              />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>seconds</span>
            </div>
          </FormField>

          {/* Headers */}
          <FormField label={t('mcp.headers')}>
            <div className="flex flex-col gap-2">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 px-2 py-1"
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    }}
                    placeholder={t('mcp.headerKey')}
                    value={h.key}
                    onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  />
                  <input
                    className="flex-1 px-2 py-1"
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    }}
                    placeholder={t('mcp.headerValue')}
                    value={h.value}
                    onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  />
                  <button
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease',
                      flexShrink: 0,
                    }}
                    onClick={() => removeHeader(i)}
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
                onClick={addHeader}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                <Plus size={12} strokeWidth={1.5} />
                {t('mcp.addHeader')}
              </button>
            </div>
          </FormField>

          {/* Validate result */}
          {validateResult && (
            <div
              className="px-3 py-2"
              style={{
                background: 'var(--bg-elevated)',
                borderLeft: `2px solid ${validateResult.success ? 'var(--green)' : 'var(--red)'}`,
                borderRadius: '0 2px 2px 0',
              }}
            >
              {validateResult.success ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--green)', fontSize: 12 }}>
                  <Check size={14} strokeWidth={1.5} />
                  <span>
                    {t('mcp.testSuccess', {
                      tools: validateResult.tools?.length || 0,
                      prompts: validateResult.prompts?.length || 0,
                      resources: validateResult.resources?.length || 0,
                    })}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2" style={{ color: 'var(--red)', fontSize: 12 }}>
                  <AlertCircle size={14} strokeWidth={1.5} />
                  <span className="break-words">{validateResult.error || t('mcp.testFailed')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <button
            className="px-3 py-1"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)',
              fontSize: 13, transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={closeAddDialog}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            {t('mcp.cancel')}
          </button>

          {editMode ? (
            <button
              className="px-3 py-1"
              style={{
                background: canSubmit ? 'var(--blue)' : 'var(--bg-elevated)',
                border: 'none', borderRadius: 4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                color: canSubmit ? 'var(--text-inverse)' : 'var(--text-dim)',
                fontSize: 13, transition: 'opacity 150ms ease',
              }}
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? t('settings.saving') : t('mcp.saveChanges')}
            </button>
          ) : !isTestPassed ? (
            <button
              className="flex items-center gap-1 px-3 py-1"
              style={{
                background: url.trim() ? 'var(--bg-elevated)' : 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: url.trim() && !validating ? 'pointer' : 'not-allowed',
                color: url.trim() ? 'var(--text-primary)' : 'var(--text-dim)',
                fontSize: 13, transition: 'color 150ms ease, border-color 150ms ease',
              }}
              onClick={handleTest}
              disabled={!url.trim() || validating}
            >
              {validating ? (
                <>
                  <Loader size={12} strokeWidth={1.5} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  {t('mcp.testing')}
                </>
              ) : (
                t('mcp.test')
              )}
            </button>
          ) : (
            <button
              className="px-3 py-1"
              style={{
                background: canSubmit ? 'var(--green)' : 'var(--bg-elevated)',
                border: 'none', borderRadius: 4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                color: canSubmit ? 'var(--text-inverse)' : 'var(--text-dim)',
                fontSize: 13, transition: 'opacity 150ms ease',
              }}
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? t('settings.saving') : t('mcp.addServerButton')}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes dialog-scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

function FormField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
