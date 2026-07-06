import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Loader, ChevronDown } from 'lucide-react'
import useHooksStore from '../../stores/hooksStore'
import { HOOK_SAMPLE_INPUTS } from '../../data/hookSampleInputs'
import CopyButton from '../shared/CopyButton'

const labelStyle = {
  fontSize: 11,
  color: 'var(--text-dim)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

const inputStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

export default function HookTestTab({ hookId }) {
  const { t } = useTranslation()
  const configuredHooks = useHooksStore((s) => s.configuredHooks)
  const catalog = useHooksStore((s) => s.catalog)
  const testResult = useHooksStore((s) => s.testResult)
  const testRunning = useHooksStore((s) => s.testRunning)
  const runTest = useHooksStore((s) => s.runTest)
  const testBuiltInHook = useHooksStore((s) => s.testBuiltInHook)
  const clearTestResult = useHooksStore((s) => s.clearTestResult)

  const [command, setCommand] = useState('')
  const [timeout, setTimeout_] = useState(30)
  const [inputJson, setInputJson] = useState('')
  const [jsonError, setJsonError] = useState(null)
  const [selectedQuick, setSelectedQuick] = useState('')
  const [selectedBuiltInId, setSelectedBuiltInId] = useState(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Pre-fill sample input when hookId changes
  useEffect(() => {
    const sample = HOOK_SAMPLE_INPUTS[hookId]
    if (sample) {
      setInputJson(JSON.stringify(sample, null, 2))
    } else {
      setInputJson('{}')
    }
    setCommand('')
    setTimeout_(30)
    setSelectedQuick('')
    setSelectedBuiltInId(null)
    setJsonError(null)
    clearTestResult()
  }, [hookId])

  // Build quick test options: configured command handlers + matching built-in hooks
  const quickOptions = useMemo(() => {
    const options = []

    // Configured command handlers for this event
    const entries = configuredHooks[hookId] || []
    entries.forEach((entry, eIdx) => {
      (entry.hooks || []).forEach((h, hIdx) => {
        if (h.type === 'command' || !h.type) {
          options.push({
            label: h.command || `Handler ${eIdx + 1}`,
            command: h.command || '',
            timeout: h.timeout || 30,
            source: 'configured',
            builtInId: null,
          })
        }
      })
    })

    // Built-in hooks matching this event
    catalog
      .filter((bh) => bh.supported_events?.includes(hookId))
      .forEach((bh) => {
        options.push({
          label: bh.name,
          command: '',
          timeout: 10,
          source: 'built-in',
          builtInId: bh.id,
        })
      })

    return options
  }, [configuredHooks, catalog, hookId])

  const handleQuickSelect = (option) => {
    setCommand(option.command)
    setTimeout_(option.timeout)
    setSelectedQuick(option.label)
    setSelectedBuiltInId(option.builtInId || null)
    setDropdownOpen(false)
  }

  const handleRun = () => {
    setJsonError(null)
    let parsed = {}
    try {
      parsed = JSON.parse(inputJson || '{}')
    } catch (e) {
      setJsonError(t('hooks.invalidJson'))
      return
    }

    if (selectedBuiltInId) {
      // Test built-in hook directly via Python callback
      testBuiltInHook(selectedBuiltInId, hookId, parsed)
    } else {
      const handler = {
        type: 'command',
        command,
        timeout: Number(timeout) || 30,
      }
      runTest(hookId, handler, parsed)
    }
  }

  const canRun = (command.trim().length > 0 || selectedBuiltInId) && !testRunning

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
          {t('hooks.dryRun')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          {t('hooks.dryRunHint')}
        </div>
      </div>

      {/* Quick test dropdown */}
      {quickOptions.length > 0 && (
        <div className="flex flex-col gap-1">
          <div style={labelStyle}>{t('hooks.quickTest')}</div>
          <div className="relative">
            <button
              className="flex items-center gap-2 w-full px-2 py-1"
              style={{
                ...inputStyle,
                fontFamily: "'Noto Sans', sans-serif",
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
              }}
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <span style={{ color: selectedQuick ? 'var(--text-primary)' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedQuick || t('hooks.selectHandler')}
              </span>
              <ChevronDown size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
            </button>
            {dropdownOpen && (
              <div
                className="absolute w-full overflow-y-auto"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  zIndex: 10,
                  top: '100%',
                  marginTop: 2,
                  maxHeight: 200,
                }}
              >
                {quickOptions.map((opt, i) => (
                  <button
                    key={i}
                    className="flex items-center gap-2 w-full px-2 py-1"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: i < quickOptions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 12,
                      textAlign: 'left',
                      transition: 'background 150ms ease',
                    }}
                    onClick={() => handleQuickSelect(opt)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {opt.source}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Command + Timeout (only for custom command hooks, not built-in) */}
      {!selectedBuiltInId && (
        <>
          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.command')}</div>
            <input
              style={inputStyle}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder=".claude/hooks/my-hook.sh"
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.timeoutSeconds')}</div>
            <input
              type="number"
              style={{ ...inputStyle, width: 80 }}
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              min={1}
              max={300}
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
        </>
      )}

      {/* Input JSON */}
      <div className="flex flex-col gap-1">
        <div style={labelStyle}>{t('hooks.inputJson')}</div>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: 100 }}
          rows={6}
          value={inputJson}
          onChange={(e) => { setInputJson(e.target.value); setJsonError(null) }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
        />
        {jsonError && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>{jsonError}</div>
        )}
      </div>

      {/* Run button */}
      <button
        className="flex items-center justify-center gap-2 px-4 py-2"
        style={{
          background: canRun ? 'var(--blue)' : 'var(--bg-elevated)',
          border: 'none',
          borderRadius: 4,
          color: canRun ? 'var(--text-inverse)' : 'var(--text-dim)',
          cursor: canRun ? 'pointer' : 'not-allowed',
          fontSize: 13,
          fontWeight: 600,
          transition: 'opacity 150ms ease',
          opacity: canRun ? 1 : 0.5,
        }}
        disabled={!canRun}
        onClick={handleRun}
      >
        {testRunning ? (
          <Loader size={14} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <Play size={14} strokeWidth={1.5} />
        )}
        {t('hooks.runTest')}
      </button>

      {/* Result */}
      {testResult && (
        <div className="flex flex-col gap-3" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={labelStyle}>{t('hooks.result')}</div>

          {/* Built-in hook result */}
          {testResult.hook_id != null ? (
            <>
              {testResult.error ? (
                /* Error state */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span style={{
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--red)',
                    }}>
                      ERROR
                    </span>
                    <span className="flex-1" />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 300 }}>
                      {testResult.duration_ms}ms
                    </span>
                  </div>
                  <pre
                    className="overflow-x-auto"
                    style={{
                      background: 'var(--bg-elevated)',
                      borderLeft: '2px solid var(--red)',
                      borderRadius: 4,
                      padding: '8px 10px',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      color: 'var(--red)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {testResult.error}
                  </pre>
                </div>
              ) : testResult.decision === 'deny' ? (
                /* Deny state */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span style={{
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--red)',
                    }}>
                      DENIED
                    </span>
                    <span className="flex-1" />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 300 }}>
                      {testResult.duration_ms}ms
                    </span>
                  </div>
                  {testResult.reason && (
                    <pre
                      className="overflow-x-auto"
                      style={{
                        background: 'var(--bg-elevated)',
                        borderLeft: '2px solid var(--red)',
                        borderRadius: 4,
                        padding: '8px 10px',
                        fontSize: 12,
                        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                        color: 'var(--red)',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {testResult.reason}
                    </pre>
                  )}
                  {testResult.output && Object.keys(testResult.output).length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div style={labelStyle}>{t('hooks.output')}</div>
                        <span className="flex-1" />
                        <CopyButton content={JSON.stringify(testResult.output, null, 2)} inline />
                      </div>
                      <pre
                        className="overflow-x-auto"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 4,
                          padding: '8px 10px',
                          fontSize: 12,
                          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                          color: 'var(--text-primary)',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(testResult.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                /* Pass state — no decision (allowed) */
                <div className="flex items-center gap-3">
                  <span style={{
                    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--green)',
                  }}>
                    PASSED
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {t('hooks.passedHint')}
                  </span>
                  <span className="flex-1" />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 300 }}>
                    {testResult.duration_ms}ms
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Command hook result (exit code based) */}
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('hooks.exitCode')}:</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: testResult.exit_code === 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {testResult.exit_code}
                </span>
                <span className="flex-1" />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 300 }}>
                  {testResult.duration_ms}ms
                </span>
              </div>

              {/* Stdout */}
              {testResult.stdout && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div style={labelStyle}>{t('hooks.stdout')}</div>
                    <span className="flex-1" />
                    <CopyButton content={testResult.stdout} inline />
                  </div>
                  <pre
                    className="overflow-x-auto"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      padding: '8px 10px',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      color: 'var(--text-primary)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {testResult.stdout}
                  </pre>
                </div>
              )}

              {/* Stderr */}
              {testResult.stderr && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div style={labelStyle}>{t('hooks.stderr')}</div>
                    <span className="flex-1" />
                    <CopyButton content={testResult.stderr} inline />
                  </div>
                  <pre
                    className="overflow-x-auto"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderLeft: testResult.exit_code !== 0 ? '2px solid var(--red)' : '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      padding: '8px 10px',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      color: testResult.exit_code !== 0 ? 'var(--red)' : 'var(--text-primary)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {testResult.stderr}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
