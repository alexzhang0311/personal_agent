import { useId, useState, useMemo } from 'react'
import { Save, RotateCcw, Trash2, ChevronDown, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSubagentsStore from '../../stores/subagentsStore'
import useUiStore from '../../stores/uiStore'
import CategoryDropdown from '../shared/CategoryDropdown'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import ToolPicker from './ToolPicker'
import SkillPicker from './SkillPicker'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import MCPServerPicker from './MCPServerPicker'

const NAME_RE = /^[a-z0-9-]+$/
const CUSTOM_MODEL_VALUE = '__custom__'
const PERMISSION_MODE_OPTIONS = [
  { value: '', label: 'inherit (default)' },
  { value: 'default', label: 'default' },
  { value: 'acceptEdits', label: 'acceptEdits' },
  { value: 'plan', label: 'plan' },
  { value: 'bypassPermissions', label: 'bypassPermissions' },
  { value: 'ask', label: 'ask' },
  { value: 'deny', label: 'deny' },
]
const MEMORY_OPTIONS = [
  { value: '', label: 'inherit (default)' },
  { value: 'none', label: 'none' },
  { value: 'user', label: 'user' },
  { value: 'project', label: 'project' },
  { value: 'local', label: 'local' },
]
const MODEL_OPTIONS = [
  { value: '', label: 'inherit (default)' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus' },
  { value: 'haiku', label: 'haiku' },
  { value: CUSTOM_MODEL_VALUE, label: '(custom)' },
]
const PRESET_MODELS = new Set(['', 'sonnet', 'opus', 'haiku'])

const labelStyle = {
  fontSize: 11,
  color: 'var(--text-dim)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontWeight: 600,
}

const inputStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: 13,
  height: 30,
  outline: 'none',
}

export default function SubAgentEditor() {
  const { t } = useTranslation()
  const draft = useSubagentsStore((s) => s.formDraft)
  const dirty = useSubagentsStore((s) => s.dirty)
  const list = useSubagentsStore((s) => s.list)
  const catalog = useSubagentsStore((s) => s.catalog)
  const setFormField = useSubagentsStore((s) => s.setFormField)
  const saveDraft = useSubagentsStore((s) => s.saveDraft)
  const discardDraft = useSubagentsStore((s) => s.discardDraft)
  const deleteSelected = useSubagentsStore((s) => s.deleteSelected)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedBodyId = useId()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [promptMode, setPromptMode] = useState('raw') // 'raw' | 'preview'
  const isPresetModel = PRESET_MODELS.has(draft?.model || '')
  const modelDropdownValue = isPresetModel ? (draft?.model || '') : CUSTOM_MODEL_VALUE

  const isEditMode = draft?.__mode === 'edit'

  const validation = useMemo(() => {
    if (!draft) return { ok: false, message: '' }
    if (!draft.name) return { ok: false, message: t('subagents.errors.required') }
    if (!NAME_RE.test(draft.name)) return { ok: false, message: t('subagents.errors.nameRegex') }
    if (catalog?.reserved_names?.includes(draft.name.toLowerCase())) {
      return { ok: false, message: t('subagents.errors.nameReserved') }
    }
    if (!draft.description) return { ok: false, message: t('subagents.errors.required') }
    if ((draft.tools || []).includes('Agent')) {
      return { ok: false, message: t('subagents.errors.agentToolForbidden') }
    }
    const taken = list.some(
      (a) => a.name === draft.name && (!isEditMode || a.name !== draft.__originalName)
    )
    if (taken) return { ok: false, message: t('subagents.errors.nameTaken') }
    return { ok: true, message: '' }
  }, [draft, list, catalog, isEditMode, t])

  if (!draft) return null

  const handleSave = async () => {
    if (!validation.ok) {
      setError(validation.message)
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveDraft()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    if (!dirty) return
    showConfirmDialog({
      title: t('subagents.unsavedTitle'),
      message: t('subagents.unsavedMessage'),
      confirmLabel: t('subagents.discardConfirm'),
      danger: true,
      onConfirm: () => discardDraft(),
    })
  }

  const handleDelete = () => {
    if (!isEditMode) return
    showConfirmDialog({
      title: t('subagents.deleteTitle'),
      message: t('subagents.deleteMessage', { name: draft.__originalName }),
      confirmLabel: t('subagents.delete'),
      requireText: draft.__originalName,
      danger: true,
      onConfirm: async () => {
        try { await deleteSelected() } catch (e) { setError(e.message) }
      },
    })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{ height: 48, borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
          {isEditMode ? draft.__originalName : t('subagents.newAgent')}
        </span>

        <button
          onClick={handleSave}
          disabled={!dirty || !validation.ok || saving}
          className="flex items-center gap-1 px-3"
          style={{
            background: dirty && validation.ok ? 'var(--blue)' : 'var(--bg-elevated)',
            border: 'none',
            borderRadius: '4px',
            color: dirty && validation.ok ? 'var(--text-inverse)' : 'var(--text-dim)',
            cursor: dirty && validation.ok && !saving ? 'pointer' : 'not-allowed',
            opacity: dirty && validation.ok ? 1 : 0.5,
            fontSize: 12,
            height: 28,
            transition: 'opacity 150ms ease',
          }}
        >
          <Save size={12} strokeWidth={1.5} />
          {t('subagents.save')}
        </button>

        <button
          onClick={handleDiscard}
          disabled={!dirty}
          className="flex items-center gap-1 px-3"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            cursor: dirty ? 'pointer' : 'not-allowed',
            opacity: dirty ? 1 : 0.5,
            fontSize: 12,
            height: 28,
          }}
        >
          <RotateCcw size={12} strokeWidth={1.5} />
          {t('subagents.discard')}
        </button>

        {isEditMode && (
          <button
            onClick={handleDelete}
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--red)'
              e.currentTarget.style.borderColor = 'var(--red)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
            title={t('subagents.delete')}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto p-4" style={{ paddingBottom: 240 }}>
        <div className="flex flex-col gap-4" style={{ maxWidth: 760 }}>
          {error && (
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--red)',
                borderLeft: '2px solid var(--red)',
                borderRadius: '4px',
                color: 'var(--red)',
                fontSize: 12,
              }}
            >
              <AlertCircle size={12} strokeWidth={1.5} />
              {error}
            </div>
          )}

          {/* Required */}
          <div className="flex flex-col gap-1">
            <span style={labelStyle}>{t('subagents.fields.name')}</span>
            <input
              value={draft.name}
              onChange={(e) => setFormField('name', e.target.value)}
              className="px-2"
              placeholder="my-agent"
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {t('subagents.fields.nameHint')}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span style={labelStyle}>{t('subagents.fields.description')}</span>
            <textarea
              value={draft.description}
              onChange={(e) => setFormField('description', e.target.value)}
              className="px-2 py-1"
              rows={2}
              style={{ ...inputStyle, height: 'auto', resize: 'vertical' }}
            />
          </div>

          {/* Cross-field rules hint */}
          <div
            className="flex items-start gap-2 px-3 py-2"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderLeft: '2px solid var(--cyan)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            <AlertCircle size={12} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2, color: 'var(--cyan)' }} />
            <ul className="flex flex-col gap-1" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {(t('subagents.toolsHint', { returnObjects: true }) || []).map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span style={{ color: 'var(--text-dim)' }}>·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tools — two columns */}
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}
          >
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span style={labelStyle}>{t('subagents.fields.tools')}</span>
              <ToolPicker
                value={draft.tools}
                catalog={catalog?.tools || []}
                onChange={(v) => setFormField('tools', v)}
              />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span style={labelStyle}>{t('subagents.fields.disallowedTools')}</span>
              <ToolPicker
                value={draft.disallowedTools}
                catalog={catalog?.tools || []}
                onChange={(v) => setFormField('disallowedTools', v)}
              />
            </div>
          </div>

          {/* Skills + MCP servers — two columns */}
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}
          >
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span style={labelStyle}>{t('subagents.fields.skills')}</span>
              <SkillPicker
                value={draft.skills}
                catalog={catalog?.skills || []}
                onChange={(v) => setFormField('skills', v)}
              />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span style={labelStyle}>{t('subagents.fields.mcpServers')}</span>
              <MCPServerPicker
                value={draft.mcpServers}
                catalog={catalog?.mcp_servers || []}
                onChange={(v) => setFormField('mcpServers', v)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span style={labelStyle}>{t('subagents.fields.model')}</span>
            <div className="flex gap-2 items-center">
              <div style={{ flex: 1 }}>
                <CategoryDropdown
                  options={MODEL_OPTIONS}
                  selected={modelDropdownValue}
                  onSelect={(v) => {
                    if (v === CUSTOM_MODEL_VALUE) {
                      if (isPresetModel) setFormField('model', '')
                    } else {
                      setFormField('model', v)
                    }
                  }}
                />
              </div>
              {!isPresetModel && (
                <input
                  value={draft.model || ''}
                  onChange={(e) => setFormField('model', e.target.value)}
                  className="px-2"
                  placeholder="custom-model-id"
                  style={{ ...inputStyle, flex: 1, fontFamily: "'JetBrains Mono', monospace" }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span style={labelStyle}>{t('subagents.fields.prompt')}</span>
              <div
                className="flex"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                {['raw', 'preview'].map((mode) => {
                  const isActive = promptMode === mode
                  return (
                    <button
                      key={mode}
                      onClick={() => setPromptMode(mode)}
                      className="px-2"
                      style={{
                        background: isActive ? 'var(--bg-surface)' : 'transparent',
                        border: 'none',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                        cursor: 'pointer',
                        fontSize: 11,
                        height: 22,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        transition: 'background 150ms ease, color 150ms ease',
                      }}
                    >
                      {t(`subagents.prompt.${mode}`)}
                    </button>
                  )
                })}
              </div>
            </div>
            {promptMode === 'raw' ? (
              <textarea
                value={draft.prompt}
                onChange={(e) => setFormField('prompt', e.target.value)}
                className="px-2 py-1"
                rows={10}
                style={{
                  ...inputStyle,
                  height: 'auto',
                  minHeight: 240,
                  resize: 'vertical',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              />
            ) : (
              <div
                className="px-3 py-2 overflow-y-auto"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  minHeight: 240,
                  maxHeight: 480,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                }}
              >
                {draft.prompt
                  ? <MarkdownRenderer content={draft.prompt} />
                  : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {t('subagents.prompt.empty')}
                    </span>}
              </div>
            )}
          </div>

          {/* Advanced */}
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1 px-2"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 12,
              alignSelf: 'flex-start',
              padding: 0,
            }}
            aria-expanded={advancedOpen}
            aria-controls={advancedBodyId}
          >
            <AnimatedChevron open={advancedOpen}>
              <ChevronDown size={12} strokeWidth={1.5} />
            </AnimatedChevron>
            <span style={labelStyle}>{t('subagents.advanced')}</span>
          </button>

          <AnimatedCollapse open={advancedOpen} id={advancedBodyId}>
            <div className="flex flex-col gap-4 pl-1">
              <div className="flex flex-col gap-1">
                <span style={labelStyle}>{t('subagents.fields.permissionMode')}</span>
                <div style={{ width: 240 }}>
                  <CategoryDropdown
                    options={PERMISSION_MODE_OPTIONS}
                    selected={draft.permissionMode || ''}
                    onSelect={(v) => setFormField('permissionMode', v)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span style={labelStyle}>{t('subagents.fields.maxTurns')}</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxTurns ?? ''}
                  onChange={(e) =>
                    setFormField('maxTurns', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="px-2"
                  style={{ ...inputStyle, width: 120 }}
                />
              </div>

              <div className="flex flex-col gap-1">
                <span style={labelStyle}>{t('subagents.fields.memory')}</span>
                <div style={{ width: 200 }}>
                  <CategoryDropdown
                    options={MEMORY_OPTIONS}
                    selected={draft.memory || ''}
                    onSelect={(v) => setFormField('memory', v)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!draft.background}
                  onChange={(e) => setFormField('background', e.target.checked)}
                />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {t('subagents.fields.background')}
                </span>
              </label>
            </div>
          </AnimatedCollapse>
        </div>
      </div>
    </div>
  )
}
