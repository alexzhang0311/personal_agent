import { useState, useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Pencil, Trash2, Plus, ChevronDown, Code, Loader, Settings } from 'lucide-react'
import { getRiskyTools, updateRiskyTools } from '../../api/admin'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github-dark.css'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import ruby from 'highlight.js/lib/languages/ruby'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import useHooksStore from '../../stores/hooksStore'
import useUiStore from '../../stores/uiStore'
import { HOOK_DEFINITIONS } from '../../data/hookDefinitions'
import { fetchScriptContent } from '../../api/hooks'
import Chip from '../shared/Chip'
import CopyButton from '../shared/CopyButton'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

if (!hljs.getLanguage('python')) hljs.registerLanguage('python', python)
if (!hljs.getLanguage('bash')) hljs.registerLanguage('bash', bash)
if (!hljs.getLanguage('javascript')) hljs.registerLanguage('javascript', javascript)
if (!hljs.getLanguage('typescript')) hljs.registerLanguage('typescript', typescript)
if (!hljs.getLanguage('ruby')) hljs.registerLanguage('ruby', ruby)
if (!hljs.getLanguage('go')) hljs.registerLanguage('go', go)
if (!hljs.getLanguage('rust')) hljs.registerLanguage('rust', rust)

const HANDLER_TYPES = ['command', 'http', 'prompt', 'agent']
const COMING_SOON_TYPES = new Set(['agent'])

const TYPE_COLORS = {
  command: 'var(--cyan)',
  http: 'var(--blue)',
  prompt: 'var(--green)',
  agent: 'var(--purple)',
}

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

function SourceCodeViewer({ code, language }) {
  const { t } = useTranslation()

  const highlightedLines = useMemo(() => {
    const raw = code.replace(/\n$/, '')
    let html
    try {
      if (language && hljs.getLanguage(language)) {
        html = hljs.highlight(raw, { language }).value
      } else {
        html = hljs.highlightAuto(raw).value
      }
    } catch {
      html = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    return html.split('\n')
  }, [code, language])

  const gutterWidth = String(highlightedLines.length).length

  return (
    <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
      <div className="flex items-center gap-2">
        <span style={{ ...labelStyle, marginBottom: 0 }}>{t('hooks.sourceCode')}</span>
        <span className="flex-1" />
        <CopyButton content={code} inline />
      </div>
      <div
        className="overflow-y-auto overflow-hidden"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 4,
          maxHeight: 300,
          margin: 0,
        }}
      >
        <table className="hljs" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 11, lineHeight: 1.5, background: 'var(--bg-elevated)' }}>
          <colgroup>
            <col style={{ width: `${gutterWidth + 3}ch` }} />
            <col />
          </colgroup>
          <tbody>
            {highlightedLines.map((lineHtml, i) => (
              <tr key={i}>
                <td
                  style={{
                    padding: '0 8px',
                    textAlign: 'right',
                    color: 'var(--text-dim)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border-subtle)',
                    verticalAlign: 'top',
                  }}
                >
                  {i + 1}
                </td>
                <td
                  style={{
                    padding: '0 10px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    overflowWrap: 'break-word',
                  }}
                  dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScriptContentLoader({ command }) {
  const { t } = useTranslation()
  const bodyId = useId()
  const [content, setContent] = useState(null)
  const [language, setLanguage] = useState('text')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    if (content != null) {
      setExpanded(true)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchScriptContent(command)
      setContent(data.content)
      setLanguage(data.language || 'text')
      setExpanded(true)
    } catch (e) {
      setError(e.message || t('hooks.failedToLoadScript'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col" style={{ marginTop: 4 }}>
      <button
        className="flex items-center gap-1"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          padding: 0,
          fontSize: 11,
          transition: 'color 150ms ease',
        }}
        onClick={handleToggle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        {loading ? (
          <Loader size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <Code size={12} strokeWidth={1.5} />
        )}
        <span>{t('hooks.viewSource')}</span>
        {!loading && (
          <AnimatedChevron open={expanded}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
        )}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</div>
      )}
      <AnimatedCollapse open={expanded && content != null} id={bodyId}>
        <SourceCodeViewer code={content} language={language} />
      </AnimatedCollapse>
    </div>
  )
}

// ---- Risky-tool pattern editor --------------------------------------------
//
// Admin-only UI embedded in the require-permission-risky-tools built-in hook
// card. The user fills in two fields (tool dropdown + pattern input) and we
// serialize each row back to Claude Code native grammar before POSTing.
//
//   {tool: 'Bash',     pattern: 'rm:*'}            -> 'Bash(rm:*)'
//   {tool: 'Bash',     pattern: ''}                -> 'Bash'
//   {tool: 'Write',    pattern: '/etc/**'}         -> 'Write(/etc/**)'
//   {tool: 'WebFetch', pattern: 'domain:github.com'} -> 'WebFetch(domain:github.com)'
//   {tool: 'MCP',      pattern: 'mcp__*__delete_*'}  -> 'mcp__*__delete_*'

const RISKY_TOOL_OPTIONS = ['Bash', 'Write', 'Edit', 'Read', 'WebFetch', 'MCP']

const RISKY_PLACEHOLDERS = {
  Bash: 'rm:*  or  git push:*  (empty = any)',
  Write: '/etc/**  or  **/.env',
  Edit: '/etc/**  or  package.json',
  Read: '**/.env  or  ~/.ssh/**',
  WebFetch: 'domain:github.com',
  MCP: 'mcp__*__delete_*',
}

function serializeRiskyEntry({ tool, pattern }) {
  const p = (pattern || '').trim()
  if (tool === 'MCP') return p
  if (!p) return tool
  return `${tool}(${p})`
}

function deserializeRiskyEntry(raw) {
  if (typeof raw !== 'string') return { tool: 'Bash', pattern: '' }
  const s = raw.trim()
  if (!s) return { tool: 'Bash', pattern: '' }
  if (s.startsWith('mcp__')) return { tool: 'MCP', pattern: s }
  const m = s.match(/^([A-Za-z_]\w*)(?:\((.*)\))?$/)
  if (!m) return { tool: 'Bash', pattern: s }
  const tool = m[1]
  const pattern = m[2] || ''
  if (!RISKY_TOOL_OPTIONS.includes(tool)) {
    return { tool: 'Bash', pattern: s }
  }
  return { tool, pattern }
}

const riskyInputStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  outline: 'none',
  boxSizing: 'border-box',
}

const riskySelectStyle = {
  ...riskyInputStyle,
  minWidth: 92,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage:
    'linear-gradient(45deg, transparent 50%, var(--text-dim) 50%), linear-gradient(135deg, var(--text-dim) 50%, transparent 50%)',
  backgroundPosition: 'calc(100% - 12px) 50%, calc(100% - 8px) 50%',
  backgroundSize: '4px 4px, 4px 4px',
  backgroundRepeat: 'no-repeat',
  paddingRight: 22,
}

function RiskyPatternsEditor() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [newTool, setNewTool] = useState('Bash')
  const [newPattern, setNewPattern] = useState('')
  const [addError, setAddError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getRiskyTools()
        const raws = Array.isArray(data?.risky_tool_list) ? data.risky_tool_list : []
        const parsed = raws.map(deserializeRiskyEntry)
        if (!cancelled) {
          setEntries(parsed)
          setLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setEntries([])
          setLoaded(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleAdd = () => {
    const entry = { tool: newTool, pattern: newPattern }
    const raw = serializeRiskyEntry(entry)
    if (!raw) {
      setAddError(t('hooks.patternInvalid'))
      return
    }
    setEntries((prev) => [...prev, entry])
    setNewPattern('')
    setAddError(null)
    setDirty(true)
  }

  const handleDelete = (idx) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = entries
        .map(serializeRiskyEntry)
        .filter((r) => r.length > 0)
      await updateRiskyTools({ risky_tool_list: payload })
      setDirty(false)
    } catch (e) {
      setSaveError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-1" style={{ marginTop: 8 }}>
        <div className="skeleton" style={{ height: 36, borderRadius: 2 }} />
        <div className="skeleton" style={{ height: 36, borderRadius: 2 }} />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        marginTop: 8,
        padding: 12,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
      }}
    >
      {/* Column headers */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2" style={{ ...labelStyle, marginBottom: 0 }}>
          <span style={{ minWidth: 92 }}>{t('hooks.patternTool')}</span>
          <span className="flex-1">{t('hooks.patternContent')}</span>
          <span style={{ width: 20 }} />
        </div>
      )}

      {/* Existing rows (display-only; delete + re-add to edit) */}
      {entries.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div
            className="px-2 py-1"
            style={{
              minWidth: 92,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--cyan)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {entry.tool}
          </div>
          <div
            className="flex-1 px-2 py-1"
            style={{
              fontSize: 12,
              color: 'var(--text-primary)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              wordBreak: 'break-all',
              minWidth: 0,
            }}
          >
            {entry.pattern || <span style={{ color: 'var(--text-dim)' }}>—</span>}
          </div>
          <button
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 2,
              flexShrink: 0,
              transition: 'color 150ms ease',
            }}
            onClick={() => handleDelete(idx)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}

      {/* Add row */}
      <div
        className="flex flex-col gap-1"
        style={{
          marginTop: entries.length > 0 ? 6 : 0,
          paddingTop: entries.length > 0 ? 10 : 0,
          borderTop: entries.length > 0 ? '1px solid var(--border-subtle)' : 'none',
        }}
      >
        <div style={labelStyle}>{t('hooks.addPattern')}</div>
        <div className="flex items-center gap-2">
          <select
            style={riskySelectStyle}
            value={newTool}
            onChange={(e) => { setNewTool(e.target.value); setAddError(null) }}
          >
            {RISKY_TOOL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <input
            style={{ ...riskyInputStyle, flex: 1, minWidth: 0 }}
            value={newPattern}
            onChange={(e) => { setNewPattern(e.target.value); setAddError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder={RISKY_PLACEHOLDERS[newTool]}
            onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
          <button
            onClick={handleAdd}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--blue)',
              cursor: 'pointer',
              padding: '6px 8px',
              flexShrink: 0,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        </div>
        {addError && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>{addError}</div>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-2" style={{ marginTop: 6 }}>
        {saveError && (
          <span style={{ fontSize: 11, color: 'var(--red)', marginRight: 'auto' }}>{saveError}</span>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-3 py-1 text-xs font-semibold"
          style={{
            background: dirty && !saving ? 'var(--blue)' : 'var(--bg-surface)',
            border: dirty && !saving ? 'none' : '1px solid var(--border)',
            borderRadius: 4,
            color: dirty && !saving ? 'var(--text-inverse)' : 'var(--text-dim)',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            opacity: dirty && !saving ? 1 : 0.6,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            transition: 'all 150ms ease',
          }}
        >
          {saving ? (
            <Loader size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }} />
          ) : (
            t('hooks.saveChanges')
          )}
        </button>
      </div>
    </div>
  )
}


function BuiltInHookCard({ hook: bh, onDisable, onEnable }) {
  const { t } = useTranslation()
  const [showSource, setShowSource] = useState(false)
  const [showPatterns, setShowPatterns] = useState(false)
  const sourceBodyId = useId()
  const patternsBodyId = useId()
  const isActive = bh.enabled || bh.enforced
  const isRiskyHook = bh.id === 'require-permission-risky-tools'

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: isActive ? '2px solid var(--green)' : '2px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
          {bh.name}
        </span>
        <Chip color="var(--purple)">BUILT-IN</Chip>
        {bh.enforced && (
          <span className="flex items-center gap-1">
            <Lock size={12} strokeWidth={1.5} style={{ color: 'var(--yellow)' }} />
            <span style={{ fontSize: 10, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('hooks.enforced')}
            </span>
          </span>
        )}
        {bh.can_block && (
          <Chip color="var(--red)">{t('hooks.canBlock')}</Chip>
        )}
        <span className="flex-1" />
        {bh.enforced ? (
          <Chip color="var(--yellow)">{t('hooks.enforced')}</Chip>
        ) : isActive ? (
          <button
            className="px-2 py-1 text-xs uppercase font-semibold"
            style={{
              background: 'transparent',
              border: '1px solid var(--green)',
              borderRadius: 4,
              color: 'var(--green)',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              flexShrink: 0,
              transition: 'all 150ms ease',
            }}
            onClick={onDisable}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--red)'
              e.currentTarget.style.color = 'var(--red)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--green)'
              e.currentTarget.style.color = 'var(--green)'
            }}
          >
            {t('hooks.disable')}
          </button>
        ) : (
          <button
            className="px-2 py-1 text-xs uppercase font-semibold"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--blue)',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              flexShrink: 0,
              transition: 'all 150ms ease',
            }}
            onClick={onEnable}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--blue)'
              e.currentTarget.style.color = 'var(--text-inverse)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--blue)'
            }}
          >
            {t('hooks.enable')}
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-word' }}>
        {bh.description}
      </div>
      {bh.source_code && (
        <div className="flex flex-col" style={{ marginTop: 4 }}>
          <button
            className="flex items-center gap-1"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
              fontSize: 11,
              transition: 'color 150ms ease',
            }}
            onClick={() => setShowSource(!showSource)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            aria-expanded={showSource}
            aria-controls={sourceBodyId}
          >
            <Code size={12} strokeWidth={1.5} />
            <span>{t('hooks.viewSource')}</span>
            <AnimatedChevron open={showSource}>
              <ChevronDown size={12} strokeWidth={1.5} />
            </AnimatedChevron>
          </button>
          <AnimatedCollapse open={showSource} id={sourceBodyId}>
            <SourceCodeViewer code={bh.source_code} language="python" />
          </AnimatedCollapse>
        </div>
      )}
      {isRiskyHook && (
        <div className="flex flex-col" style={{ marginTop: 4 }}>
          <button
            className="flex items-center gap-1"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
              fontSize: 11,
              transition: 'color 150ms ease',
            }}
            onClick={() => setShowPatterns(!showPatterns)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            aria-expanded={showPatterns}
            aria-controls={patternsBodyId}
          >
            <Settings size={12} strokeWidth={1.5} />
            <span>{t('hooks.managePatterns')}</span>
            <AnimatedChevron open={showPatterns}>
              <ChevronDown size={12} strokeWidth={1.5} />
            </AnimatedChevron>
          </button>
          <AnimatedCollapse open={showPatterns} id={patternsBodyId}>
            <RiskyPatternsEditor />
          </AnimatedCollapse>
        </div>
      )}
    </div>
  )
}

function HandlerCard({ entry, entryIndex, hookHandlerIndex, handler, isEnforced, onEdit, onDelete }) {
  const { t } = useTranslation()
  const type = handler.type || 'command'
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `2px solid ${TYPE_COLORS[type] || 'var(--border)'}`,
        borderRadius: 4,
        transition: 'background 150ms ease',
        ...(hovered && !isEnforced ? { background: 'var(--bg-elevated)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        {isEnforced && (
          <Lock size={12} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
        )}
        <Chip color={TYPE_COLORS[type]}>
          {type.toUpperCase()}
        </Chip>
        {isEnforced && (
          <span style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 300 }}>
            {t('hooks.adminEnforced')}
          </span>
        )}
        <span className="flex-1" />
        {!isEnforced && hovered && (
          <>
            <button
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease' }}
              onClick={onEdit}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <Pencil size={14} strokeWidth={1.5} />
            </button>
            <button
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease' }}
              onClick={onDelete}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", wordBreak: 'break-all' }}>
        {handler.command || handler.url || handler.prompt || '—'}
      </div>
      <div className="flex items-center gap-3" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        <span>{t('hooks.matcher')}: {entry.matcher || '—'}</span>
        <span>{t('hooks.timeout')}: {handler.timeout || 30}s</span>
      </div>
      {type === 'command' && handler.command && (
        <ScriptContentLoader command={handler.command} />
      )}
    </div>
  )
}

function HandlerForm({ hookId, matcherTarget, editingHandler, onSave, onCancel }) {
  const { t } = useTranslation()
  const isEditing = !!editingHandler

  const [type, setType] = useState(editingHandler?.handler?.type || 'command')
  const [command, setCommand] = useState(editingHandler?.handler?.command || '')
  const [url, setUrl] = useState(editingHandler?.handler?.url || '')
  const [headers, setHeaders] = useState(() => {
    const h = editingHandler?.handler?.headers
    if (h && typeof h === 'object') {
      const pairs = Object.entries(h).map(([k, v]) => ({ key: k, value: v }))
      return pairs.length > 0 ? pairs : [{ key: '', value: '' }]
    }
    return [{ key: '', value: '' }]
  })
  const [prompt, setPrompt] = useState(editingHandler?.handler?.prompt || '')
  const [model, setModel] = useState(editingHandler?.handler?.model || '')
  const [matcher, setMatcher] = useState(editingHandler?.entry?.matcher || '')
  const [timeout, setTimeout_] = useState(editingHandler?.handler?.timeout || 30)

  const handleSave = () => {
    const handler = { type, timeout: Number(timeout) || 30 }
    if (type === 'command') handler.command = command
    if (type === 'http') {
      handler.url = url
      const h = {}
      headers.forEach(({ key, value }) => { if (key.trim()) h[key.trim()] = value })
      if (Object.keys(h).length > 0) handler.headers = h
    }
    if (type === 'prompt' || type === 'agent') {
      handler.prompt = prompt
      if (model.trim()) handler.model = model
    }

    const entry = {
      matcher: matcher.trim() || null,
      hooks: [handler],
    }

    onSave(entry)
  }

  const canSave = () => {
    if (type === 'command') return command.trim().length > 0
    if (type === 'http') return url.trim().length > 0
    if (type === 'prompt' || type === 'agent') return prompt.trim().length > 0
    return false
  }

  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <div style={labelStyle}>
        {isEditing ? t('hooks.editHandler') : t('hooks.addHandler')}
      </div>

      {/* Type selector */}
      <div className="flex flex-col gap-1">
        <div style={labelStyle}>{t('hooks.handlerType')}</div>
        <div className="flex gap-1">
          {HANDLER_TYPES.map((ht) => {
            const isSoon = COMING_SOON_TYPES.has(ht)
            return (
              <button
                key={ht}
                className="px-2 py-1 uppercase font-semibold"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  background: type === ht && !isSoon ? 'var(--bg-elevated)' : 'transparent',
                  border: type === ht && !isSoon ? `1px solid ${TYPE_COLORS[ht]}` : '1px solid var(--border)',
                  borderRadius: 4,
                  color: isSoon ? 'var(--text-dim)' : type === ht ? TYPE_COLORS[ht] : 'var(--text-dim)',
                  cursor: isSoon ? 'default' : 'pointer',
                  opacity: isSoon ? 0.5 : 1,
                  transition: 'all 150ms ease',
                  position: 'relative',
                }}
                onClick={() => { if (!isSoon) setType(ht) }}
                title={isSoon ? t('hooks.comingSoonShort') : undefined}
              >
                {ht}
                {isSoon && (
                  <span style={{
                    position: 'absolute',
                    top: -6,
                    right: -4,
                    fontSize: 7,
                    color: 'var(--yellow)',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}>
                    SOON
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Command field */}
      {type === 'command' && (
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
      )}

      {/* URL field */}
      {type === 'http' && (
        <>
          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.url')}</div>
            <input
              style={inputStyle}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hook"
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.headers')}</div>
            <div className="flex flex-col gap-1">
              {headers.map((pair, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <input
                    style={{ ...inputStyle, flex: '0 0 35%' }}
                    value={pair.key}
                    onChange={(e) => {
                      const next = [...headers]
                      next[idx] = { ...next[idx], key: e.target.value }
                      setHeaders(next)
                    }}
                    placeholder="Key"
                    onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
                  />
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={pair.value}
                    onChange={(e) => {
                      const next = [...headers]
                      next[idx] = { ...next[idx], value: e.target.value }
                      setHeaders(next)
                    }}
                    placeholder="Value"
                    onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
                  />
                  <button
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: headers.length <= 1 ? 'default' : 'pointer',
                      color: 'var(--text-dim)',
                      padding: 2,
                      opacity: headers.length <= 1 ? 0.3 : 1,
                      transition: 'color 150ms ease',
                      flexShrink: 0,
                    }}
                    onClick={() => {
                      if (headers.length > 1) setHeaders(headers.filter((_, i) => i !== idx))
                    }}
                    onMouseEnter={(e) => { if (headers.length > 1) e.currentTarget.style.color = 'var(--red)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  >
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              <button
                className="flex items-center gap-1"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: 0,
                  fontSize: 11,
                  transition: 'color 150ms ease',
                }}
                onClick={() => setHeaders([...headers, { key: '', value: '' }])}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                <Plus size={12} strokeWidth={1.5} />
                {t('hooks.addHeader')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Prompt field */}
      {(type === 'prompt' || type === 'agent') && (
        <>
          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.prompt')}</div>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('hooks.promptPlaceholder')}
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div style={labelStyle}>{t('hooks.model')}</div>
            <input
              style={inputStyle}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-4-6"
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
        </>
      )}

      {/* Matcher */}
      <div className="flex flex-col gap-1">
        <div style={labelStyle}>{t('hooks.matcher')}</div>
        <input
          style={inputStyle}
          value={matcher}
          onChange={(e) => setMatcher(e.target.value)}
          placeholder={matcherTarget || t('hooks.matcherPlaceholder')}
          onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
        />
      </div>

      {/* Timeout */}
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

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          className="px-3 py-1 text-sm"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'border-color 150ms ease',
          }}
          onClick={onCancel}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          {t('hooks.cancel')}
        </button>
        <button
          className="px-3 py-1 text-sm"
          style={{
            background: canSave() ? 'var(--blue)' : 'var(--bg-elevated)',
            border: 'none',
            borderRadius: 4,
            color: canSave() ? 'var(--text-inverse)' : 'var(--text-dim)',
            cursor: canSave() ? 'pointer' : 'not-allowed',
            opacity: canSave() ? 1 : 0.5,
            transition: 'opacity 150ms ease',
          }}
          disabled={!canSave()}
          onClick={handleSave}
        >
          {t('hooks.saveHandler')}
        </button>
      </div>
    </div>
  )
}

function ConfigSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
          <div className="flex items-center gap-2">
            <div className="skeleton" style={{ width: 60, height: 14 }} />
            <div className="skeleton" style={{ width: 100, height: 11 }} />
          </div>
          <div className="skeleton" style={{ width: '80%', height: 12 }} />
          <div className="flex gap-3">
            <div className="skeleton" style={{ width: 70, height: 11 }} />
            <div className="skeleton" style={{ width: 60, height: 11 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HookConfigTab({ hookId }) {
  const { t } = useTranslation()
  const configuredHooks = useHooksStore((s) => s.configuredHooks)
  const configLoading = useHooksStore((s) => s.configLoading)
  const catalog = useHooksStore((s) => s.catalog)
  const handlerFormOpen = useHooksStore((s) => s.handlerFormOpen)
  const editingHandler = useHooksStore((s) => s.editingHandler)
  const openHandlerForm = useHooksStore((s) => s.openHandlerForm)
  const closeHandlerForm = useHooksStore((s) => s.closeHandlerForm)
  const addHandler = useHooksStore((s) => s.addHandler)
  const updateHandler = useHooksStore((s) => s.updateHandler)
  const removeHandler = useHooksStore((s) => s.removeHandler)
  const enableBuiltInHook = useHooksStore((s) => s.enableBuiltInHook)
  const disableBuiltInHook = useHooksStore((s) => s.disableBuiltInHook)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  // Find hook definition for matcher target
  const hookDef = HOOK_DEFINITIONS.find((h) => h.id === hookId)
  const matcherTarget = hookDef?.matcherTarget || null

  // Get entries for this event type
  const entries = configuredHooks[hookId] || []

  // Only these event types support adding custom handlers
  const SUPPORTED_EVENTS = ['Setup', 'SessionStart', 'PreToolUse', 'PostToolUse']
  const canAddHandler = SUPPORTED_EVENTS.includes(hookId)

  // Built-in hooks that support this event, split into active vs available
  const matchingBuiltIn = catalog.filter((bh) =>
    bh.supported_events?.includes(hookId)
  )
  const activeBuiltIn = matchingBuiltIn.filter((bh) => bh.enabled || bh.enforced)
  const availableBuiltIn = matchingBuiltIn.filter((bh) => !bh.enabled && !bh.enforced)

  const handleSave = async (entry) => {
    if (editingHandler) {
      await updateHandler(hookId, editingHandler.index, entry)
    } else {
      await addHandler(hookId, entry)
    }
    closeHandlerForm()
  }

  const handleDelete = (entryIndex) => {
    showConfirmDialog({
      title: t('hooks.deleteHandlerTitle'),
      message: t('hooks.deleteHandlerMessage'),
      confirmLabel: t('hooks.deleteConfirm'),
      danger: true,
      onConfirm: () => removeHandler(hookId, entryIndex),
    })
  }

  if (configLoading) return <ConfigSkeleton />

  // Flatten entries to render: each entry has a matcher + hooks array
  // We render one card per handler within each entry
  let handlerIndex = 0

  return (
    <div className="flex flex-col gap-4">
      {/* ACTIVE HANDLERS section — custom handlers + enabled built-in hooks */}
      <div style={labelStyle}>{t('hooks.handlers')}</div>

      {entries.length === 0 && activeBuiltIn.length === 0 && !handlerFormOpen && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {t('hooks.noHandlers')}
        </div>
      )}

      {/* Active built-in hooks */}
      {activeBuiltIn.map((bh) => (
        <BuiltInHookCard key={`builtin-${bh.id}`} hook={bh} onDisable={() => disableBuiltInHook(bh.id)} />
      ))}

      {/* Custom handlers */}
      {entries.map((entry, entryIdx) =>
        (entry.hooks || []).map((handler, hIdx) => {
          const isEnforced = !!handler.__vivian_enforced
          const currentIdx = entryIdx
          return (
            <HandlerCard
              key={`${entryIdx}-${hIdx}`}
              entry={entry}
              entryIndex={entryIdx}
              hookHandlerIndex={hIdx}
              handler={handler}
              isEnforced={isEnforced}
              onEdit={() => openHandlerForm({ index: entryIdx, entry, handler })}
              onDelete={() => handleDelete(entryIdx)}
            />
          )
        })
      )}

      {/* Inline form / add button / coming soon */}
      {canAddHandler ? (
        handlerFormOpen ? (
          <HandlerForm
            hookId={hookId}
            matcherTarget={matcherTarget}
            editingHandler={editingHandler}
            onSave={handleSave}
            onCancel={closeHandlerForm}
          />
        ) : (
          <button
            className="flex items-center gap-2 px-3 py-2"
            style={{
              background: 'transparent',
              border: '1px dashed var(--border)',
              borderRadius: 4,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 12,
              transition: 'all 150ms ease',
            }}
            onClick={() => openHandlerForm()}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--blue)'
              e.currentTarget.style.color = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-dim)'
            }}
          >
            <Plus size={14} strokeWidth={1.5} />
            {t('hooks.addHandler')}
          </button>
        )
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          {t('hooks.comingSoon')}
        </div>
      )}

      {/* AVAILABLE BUILT-IN HOOKS section — disabled hooks that can be enabled */}
      {availableBuiltIn.length > 0 && (
        <>
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 4,
              paddingTop: 12,
            }}
          >
            <div style={labelStyle}>{t('hooks.builtInHooks')}</div>
          </div>

          {availableBuiltIn.map((bh) => (
            <BuiltInHookCard key={bh.id} hook={bh} onEnable={() => enableBuiltInHook(bh.id)} />
          ))}
        </>
      )}
    </div>
  )
}
