import { useState, useMemo, useEffect, useId, useRef } from 'react'
import { X, Play, Loader, Check, AlertCircle, ChevronDown, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useMcpStore from '../../stores/mcpStore'
import CopyButton from '../shared/CopyButton'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import { copyTextToClipboard } from '../../utils/clipboard'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

function mcpToolFullName(serverName, toolName) {
  return `mcp__${serverName}__${toolName}`
}

function ToolHeaderCopy({ fullName }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="flex-shrink-0"
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease',
      }}
      onClick={() => {
        copyTextToClipboard(fullName)
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
    >
      {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
    </button>
  )
}

/**
 * Parse input_schema.properties into flat field descriptors.
 * Primitive arrays get a chip editor; object arrays and objects still use JSON.
 */
function parseSchemaFields(schema) {
  if (!schema || !schema.properties) return []
  const requiredSet = new Set(schema.required || [])
  return Object.entries(schema.properties).map(([name, prop]) => {
    const type = normalizeSchemaType(prop.type) || (prop.items ? 'array' : 'string')
    const itemType = type === 'array' ? normalizeSchemaType(prop.items?.type) || 'string' : null
    const itemEnum = type === 'array' ? prop.items?.enum || null : null
    const isPrimitiveArray = type === 'array' && ['string', 'number', 'integer', 'boolean'].includes(itemType)
    const isComplex = type === 'object' || type === 'array'
    return {
      name,
      type,
      itemType,
      itemEnum,
      description: prop.description || '',
      required: requiredSet.has(name),
      isComplex,
      isPrimitiveArray,
      enum: prop.enum || null,
      default: prop.default,
    }
  })
}

function normalizeSchemaType(type) {
  if (Array.isArray(type)) return type.find((value) => value !== 'null') || type[0]
  return type
}

function getDefaultValue(field) {
  if (field.default !== undefined) {
    if (field.isPrimitiveArray) return Array.isArray(field.default) ? field.default.map((value) => String(value)) : []
    return field.isComplex ? JSON.stringify(field.default, null, 2) : String(field.default)
  }
  if (field.isPrimitiveArray) return []
  if (field.isComplex) return field.type === 'array' ? '[]' : '{}'
  if (field.type === 'number' || field.type === 'integer') return ''
  if (field.type === 'boolean') return 'false'
  return ''
}

function coerceArrayItems(field, values) {
  const source = Array.isArray(values) ? values : []
  const compact = source
    .map((value) => (field.itemType === 'boolean' && typeof value === 'boolean' ? value : String(value ?? '').trim()))
    .filter((value) => value !== '')

  if (field.itemType === 'number' || field.itemType === 'integer') {
    const parsed = compact.map((value) => Number(value))
    if (parsed.some((value) => Number.isNaN(value))) return { error: 'invalidNumber' }
    return { value: parsed }
  }

  if (field.itemType === 'boolean') {
    const normalized = compact.map((value) => (typeof value === 'boolean' ? value : value.toLowerCase()))
    if (normalized.some((value) => value !== true && value !== false && value !== 'true' && value !== 'false')) {
      return { error: 'invalidBoolean' }
    }
    return { value: normalized.map((value) => value === true || value === 'true') }
  }

  return { value: compact }
}

export default function MCPToolDrawer() {
  const { t } = useTranslation()
  const selectedServer = useMcpStore((s) => s.selectedServer)
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const closeTool = useMcpStore((s) => s.closeTool)
  const testTool = useMcpStore((s) => s.testTool)

  const fields = useMemo(() => parseSchemaFields(selectedTool?.input_schema), [selectedTool])

  const [fieldValues, setFieldValues] = useState({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  // Reset form when tool changes
  useEffect(() => {
    if (selectedTool) {
      const defaults = {}
      parseSchemaFields(selectedTool.input_schema).forEach((f) => {
        defaults[f.name] = getDefaultValue(f)
      })
      setFieldValues(defaults)
      setTestResult(null)
      setFieldErrors({})
    }
  }, [selectedTool?.name])

  if (!selectedTool) return null

  const updateField = (name, value) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }))
    setFieldErrors((prev) => ({ ...prev, [name]: null }))
  }

  const buildArguments = () => {
    const args = {}
    const errors = {}
    let hasError = false

    for (const field of fields) {
      const raw = fieldValues[field.name] ?? ''
      const isEmptyArray = field.isPrimitiveArray && (!Array.isArray(raw) || raw.every((value) => String(value ?? '').trim() === ''))
      if ((!raw || isEmptyArray) && !field.required) continue
      if ((!raw || isEmptyArray) && field.required) {
        errors[field.name] = t('mcp.fieldRequired')
        hasError = true
        continue
      }

      if (field.isPrimitiveArray) {
        const result = coerceArrayItems(field, raw)
        if (result.error === 'invalidNumber') {
          errors[field.name] = t('mcp.invalidNumber')
          hasError = true
        } else if (result.error === 'invalidBoolean') {
          errors[field.name] = t('mcp.invalidBoolean')
          hasError = true
        } else {
          args[field.name] = result.value
        }
      } else if (field.isComplex) {
        try {
          args[field.name] = JSON.parse(raw)
        } catch {
          errors[field.name] = t('mcp.invalidJson')
          hasError = true
        }
      } else if (field.type === 'number' || field.type === 'integer') {
        const num = Number(raw)
        if (isNaN(num)) {
          errors[field.name] = t('mcp.invalidNumber')
          hasError = true
        } else {
          args[field.name] = num
        }
      } else if (field.type === 'boolean') {
        args[field.name] = raw === 'true'
      } else {
        args[field.name] = raw
      }
    }

    setFieldErrors(errors)
    return hasError ? null : args
  }

  const handleTest = async () => {
    const args = buildArguments()
    if (args === null) return
    setTesting(true)
    setTestResult(null)
    const result = await testTool(selectedTool.name, args)
    setTestResult(result)
    setTesting(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 truncate flex-1 min-w-0">
          <span
            className="font-semibold truncate"
            style={{ color: 'var(--text-primary)', fontSize: 14, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", minWidth: 0 }}
          >
            {selectedServer?.name ? mcpToolFullName(selectedServer.name, selectedTool.name) : selectedTool.name}
          </span>
          <ToolHeaderCopy fullName={selectedServer?.name ? mcpToolFullName(selectedServer.name, selectedTool.name) : selectedTool.name} />
          <span
            className="flex-shrink-0 uppercase px-1"
            style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
              color: 'var(--cyan)', border: '1px solid var(--cyan)',
              borderRadius: 2, lineHeight: '16px',
            }}
          >
            {t('mcp.toolBadge')}
          </span>
        </div>
        <button
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease',
          }}
          onClick={closeTool}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Top: description + schema + inputs + run — scrollable when no result, shrinks when result present */}
      <div
        className="overflow-y-auto px-3 py-3 flex flex-col gap-4 flex-shrink-0"
        style={{ maxHeight: testResult ? '50%' : undefined, flex: testResult ? '0 0 auto' : '1 1 0%' }}
      >
        {/* Description */}
        {selectedTool.description && (
          <div className="break-words" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {selectedTool.description}
          </div>
        )}

        {/* Input schema display — collapsible */}
        {selectedTool.input_schema && (
          <SchemaSection schema={selectedTool.input_schema} t={t} />
        )}

        {/* Test tool section */}
        <div className="flex flex-col gap-3" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <span className="uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.06em' }}>
            {t('mcp.testTool')}
          </span>

          {/* K/V input fields */}
          {fields.length > 0 ? (
            <div className="flex flex-col gap-2">
              {fields.map((field) => (
                <div key={field.name} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                      {field.name}
                    </span>
                    {field.required && (
                      <span style={{ color: 'var(--red)', fontSize: 10 }}>*</span>
                    )}
                    <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                      {field.type}
                    </span>
                  </div>
                  {field.description && (
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{field.description}</span>
                  )}
                  <FieldInput field={field} value={fieldValues[field.name] ?? ''} onChange={(v) => updateField(field.name, v)} error={fieldErrors[field.name]} t={t} />
                </div>
              ))}
            </div>
          ) : (
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {t('mcp.noArguments')}
            </span>
          )}

          {/* Run button */}
          <button
            className="flex items-center gap-1 px-3 py-1 self-start"
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 4, cursor: testing ? 'wait' : 'pointer',
              color: 'var(--text-secondary)', fontSize: 12,
              transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleTest}
            disabled={testing}
            onMouseEnter={(e) => { if (!testing) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            {testing ? (
              <>
                <Loader size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
                {t('mcp.running')}
              </>
            ) : (
              <>
                <Play size={12} strokeWidth={1.5} />
                {t('mcp.runTest')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bottom: result card — takes remaining space */}
      {testResult && (
        <div className="flex-1 flex flex-col min-h-0 px-3 pb-3">
          <ToolTestResult result={testResult} t={t} />
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

function ToolTestResult({ result, t }) {
  const [expanded, setExpanded] = useState(true)
  const bodyId = useId()
  const isSuccess = result.success && !result.is_error
  const statusColor = isSuccess ? 'var(--green)' : 'var(--red)'
  const blocks = result.content || []

  const allText = blocks
    .map((b) => (b.type === 'text' ? b.text : JSON.stringify(b, null, 2)))
    .join('\n')

  return (
    <div
      className="flex flex-col"
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: `2px solid ${statusColor}`,
        borderRadius: '0 2px 2px 0',
        flex: expanded ? '1 1 0%' : '0 0 auto',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Status header — clickable */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{
          borderBottom: expanded && blocks.length > 0 ? '1px solid var(--border-subtle)' : 'none',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => { if (blocks.length > 0) e.currentTarget.style.background = 'var(--bg-surface)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <button
          type="button"
          className="flex items-center gap-2 min-w-0 flex-1"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: blocks.length > 0 ? 'pointer' : 'default',
            minWidth: 0,
            padding: 0,
            textAlign: 'left',
          }}
          onClick={() => { if (blocks.length > 0) setExpanded(!expanded) }}
          aria-expanded={blocks.length > 0 ? expanded : undefined}
          aria-controls={blocks.length > 0 ? bodyId : undefined}
        >
          {blocks.length > 0 && (
            <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
              <ChevronDown size={10} strokeWidth={1.5} />
            </AnimatedChevron>
          )}
          {isSuccess ? (
            <Check size={12} strokeWidth={1.5} style={{ color: statusColor, flexShrink: 0 }} />
          ) : (
            <AlertCircle size={12} strokeWidth={1.5} style={{ color: statusColor, flexShrink: 0 }} />
          )}
          <span className="flex-1" style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>
            {isSuccess ? t('mcp.toolSuccess') : t('mcp.toolFailed')}
          </span>
          {!isSuccess && result.error && (
            <span className="truncate" style={{ color: 'var(--red)', fontSize: 11 }}>
              {result.error}
            </span>
          )}
        </button>
        {allText && <CopyButton content={allText} inline />}
      </div>

      {/* Content — scrollable, collapsible */}
      <AnimatedCollapse
        open={expanded && blocks.length > 0}
        id={bodyId}
        className="flex-1"
        innerClassName="overflow-y-auto px-3 py-2 flex flex-col gap-2"
        innerStyle={{ minHeight: 0 }}
      >
          {blocks.map((block, i) => (
            <ContentBlock key={i} block={block} />
          ))}
      </AnimatedCollapse>
    </div>
  )
}

function ContentBlock({ block }) {
  const preStyle = {
    fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  }

  if (block.type === 'text') {
    const trimmed = (block.text || '').trim()
    const looksLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))

    if (looksLikeJson) {
      try {
        const formatted = JSON.stringify(JSON.parse(trimmed), null, 2)
        return <pre style={{ ...preStyle, color: 'var(--text-secondary)' }}>{formatted}</pre>
      } catch { /* fall through */ }
    }

    const hasMd = /[#*`\-|>\[\]]/.test(trimmed) && trimmed.length > 20
    if (hasMd) {
      return <div style={{ fontSize: 12 }}><MarkdownRenderer content={block.text} /></div>
    }

    return <pre style={{ ...preStyle, color: 'var(--text-primary)', fontSize: 12 }}>{block.text}</pre>
  }

  if (block.type === 'image') {
    return (
      <div>
        <span className="uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.06em' }}>IMAGE</span>
        {block.data ? (
          <img src={`data:${block.mimeType || 'image/png'};base64,${block.data}`} alt="" style={{ maxWidth: '100%', borderRadius: 2, marginTop: 4 }} />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>{block.mimeType || 'image data'}</div>
        )}
      </div>
    )
  }

  if (block.type === 'resource') {
    return (
      <div>
        <div className="flex items-center gap-1">
          <span className="uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.06em' }}>RESOURCE</span>
          {block.resource?.uri && (
            <span style={{ color: 'var(--text-dim)', fontSize: 10, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{block.resource.uri}</span>
          )}
        </div>
        {block.resource?.text && <pre style={{ ...preStyle, color: 'var(--text-secondary)', marginTop: 4 }}>{block.resource.text}</pre>}
      </div>
    )
  }

  return <pre style={{ ...preStyle, color: 'var(--text-dim)' }}>{JSON.stringify(block, null, 2)}</pre>
}

function SchemaSection({ schema, t }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const schemaText = JSON.stringify(schema, null, 2)

  return (
    <div className="flex flex-col gap-1">
      <button
        className="flex items-center gap-1 uppercase font-semibold"
        style={{
          color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.06em',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0, transition: 'color 150ms ease',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded}>
          <ChevronDown size={10} strokeWidth={1.5} />
        </AnimatedChevron>
        {t('mcp.inputSchema')}
      </button>
      <AnimatedCollapse open={expanded} id={bodyId}>
        <div className="relative copyable">
          <pre
            className="overflow-x-auto"
            style={{
              background: 'var(--bg-elevated)', borderRadius: 2, padding: '8px 10px',
              fontSize: 11, color: 'var(--text-secondary)', margin: 0,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {schemaText}
          </pre>
          <div style={{ position: 'absolute', top: 4, right: 4 }}>
            <CopyButton content={schemaText} />
          </div>
        </div>
      </AnimatedCollapse>
    </div>
  )
}

function FieldInput({ field, value, onChange, error, t }) {
  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
    borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none',
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  }

  if (field.isPrimitiveArray) {
    return (
      <>
        <PrimitiveArrayInput field={field} value={value} onChange={onChange} error={error} t={t} />
        {error && <span style={{ color: 'var(--red)', fontSize: 10 }}>{error}</span>}
      </>
    )
  }

  if (field.enum) {
    return (
      <>
        <select
          className="w-full px-2 py-1"
          style={inputStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.enum.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        {error && <span style={{ color: 'var(--red)', fontSize: 10 }}>{error}</span>}
      </>
    )
  }

  if (field.isComplex) {
    return (
      <>
        <textarea
          className="w-full px-2 py-1"
          style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'array' ? '[]' : '{}'}
        />
        {error && <span style={{ color: 'var(--red)', fontSize: 10 }}>{error}</span>}
      </>
    )
  }

  if (field.type === 'boolean') {
    return (
      <select
        className="w-full px-2 py-1"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  }

  return (
    <>
      <input
        className="w-full px-2 py-1"
        style={inputStyle}
        type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.type}
      />
      {error && <span style={{ color: 'var(--red)', fontSize: 10 }}>{error}</span>}
    </>
  )
}

function PrimitiveArrayInput({ field, value, onChange, error, t }) {
  const values = Array.isArray(value) ? value : []
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    setDraft('')
  }, [field.name])

  const removeAt = (index) => {
    onChange(values.filter((_, i) => i !== index))
  }

  const addDraft = () => {
    const nextValue = draft.trim()
    if (!nextValue) return
    onChange([...values, nextValue])
    setDraft('')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      addDraft()
      return
    }

    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      event.preventDefault()
      removeAt(values.length - 1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft('')
    }
  }

  const containerStyle = {
    background: 'var(--bg-elevated)',
    border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
    borderRadius: 4,
    color: 'var(--text-primary)',
    minHeight: 32,
    boxSizing: 'border-box',
    cursor: 'text',
    transition: 'border-color 150ms ease, background 150ms ease',
  }

  const chipStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    minWidth: 0,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    color: 'var(--text-primary)',
    padding: '2px 4px 2px 6px',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  }

  const removeButtonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 2,
    color: 'var(--text-dim)',
    cursor: 'pointer',
    padding: 1,
    transition: 'color 150ms ease, background 150ms ease',
  }

  const inputStyle = {
    flex: '1 1 120px',
    minWidth: 96,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
    padding: '3px 0',
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 w-full min-w-0 px-2 py-1"
      style={containerStyle}
      onClick={() => inputRef.current?.focus()}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = error ? 'var(--red)' : 'var(--border-strong)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = error ? 'var(--red)' : 'var(--border)'
      }}
    >
      {values.map((itemValue, index) => (
        <span key={`${itemValue}-${index}`} style={chipStyle}>
          <span className="truncate" style={{ minWidth: 0 }}>
            {String(itemValue)}
          </span>
          <button
            type="button"
            style={removeButtonStyle}
            onClick={() => removeAt(index)}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--red)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
            aria-label={`Remove ${field.name} item`}
            title="Remove item"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        list={field.itemEnum ? `${field.name}-options` : undefined}
        style={inputStyle}
        type={field.itemType === 'number' || field.itemType === 'integer' ? 'number' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addDraft}
        placeholder={values.length === 0 ? t('mcp.listInputPlaceholder') : ''}
      />
      {field.itemEnum && (
        <datalist id={`${field.name}-options`}>
          {field.itemEnum.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </div>
  )
}
