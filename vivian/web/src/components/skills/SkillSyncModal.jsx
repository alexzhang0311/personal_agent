import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDownUp,
  ArrowUp,
  Check,
  Circle,
  Copy,
  Download,
  Loader,
  Plus,
  Search,
  UploadCloud,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSkillSyncStore from '../../stores/skillSyncStore'
import useSkillsStore from '../../stores/skillsStore'
import { copyTextToClipboard } from '../../utils/clipboard'

function StatusIcon({ state }) {
  if (state === 'pending') return <Circle size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
  if (state === 'downloading' || state === 'uploading') {
    return (
      <Loader
        size={12}
        strokeWidth={1.5}
        style={{ color: 'var(--purple)', animation: 'spin 1.2s linear infinite' }}
      />
    )
  }
  if (state === 'done') return <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
  if (state === 'failed') return <AlertCircle size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
  return null
}

export default function SkillSyncModal() {
  const { t } = useTranslation()
  const open = useSkillSyncStore((s) => s.open)
  const direction = useSkillSyncStore((s) => s.direction)
  const closeSync = useSkillSyncStore((s) => s.closeSync)
  const remoteUrl = useSkillSyncStore((s) => s.remoteUrl)
  const setRemoteUrl = useSkillSyncStore((s) => s.setRemoteUrl)
  const apiKey = useSkillSyncStore((s) => s.apiKey)
  const setApiKey = useSkillSyncStore((s) => s.setApiKey)
  const targetMode = useSkillSyncStore((s) => s.targetMode)
  const setTargetMode = useSkillSyncStore((s) => s.setTargetMode)
  const searchQuery = useSkillSyncStore((s) => s.searchQuery)
  const setSearchQuery = useSkillSyncStore((s) => s.setSearchQuery)
  const selected = useSkillSyncStore((s) => s.selected)
  const toggleOne = useSkillSyncStore((s) => s.toggleOne)
  const selectAll = useSkillSyncStore((s) => s.selectAll)
  const clearSelection = useSkillSyncStore((s) => s.clearSelection)
  const statuses = useSkillSyncStore((s) => s.statuses)
  const syncing = useSkillSyncStore((s) => s.syncing)
  const runSync = useSkillSyncStore((s) => s.runSync)
  const hint = useSkillSyncStore((s) => s.hint)
  const clearHint = useSkillSyncStore((s) => s.clearHint)
  const promptLoading = useSkillSyncStore((s) => s.promptLoading)
  const healthInfo = useSkillSyncStore((s) => s.healthInfo)
  const localApiKey = useSkillSyncStore((s) => s.localApiKey)
  const importSkillInput = useSkillSyncStore((s) => s.importSkillInput)
  const setImportSkillInput = useSkillSyncStore((s) => s.setImportSkillInput)
  const importSkillNames = useSkillSyncStore((s) => s.importSkillNames)
  const addImportSkill = useSkillSyncStore((s) => s.addImportSkill)
  const removeImportSkill = useSkillSyncStore((s) => s.removeImportSkill)
  const getDownloadPrompt = useSkillSyncStore((s) => s.getDownloadPrompt)
  const getUploadPrompt = useSkillSyncStore((s) => s.getUploadPrompt)

  const skills = useSkillsStore((s) => s.skills)
  const [copiedKey, setCopiedKey] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !syncing) closeSync() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, syncing, closeSync])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return skills.filter((s) => !q || s.name.toLowerCase().includes(q))
  }, [skills, searchQuery])

  const projectSkills = filtered.filter((s) => s.level === 'project')
  const globalSkills = filtered.filter((s) => s.level === 'global')
  const selectedCount = Object.keys(selected).length
  const totalCount = filtered.length
  const downloadPrompt = getDownloadPrompt()
  const uploadPrompt = getUploadPrompt()
  const canSync = !syncing && selectedCount > 0 && remoteUrl.trim().length > 0

  const handleCopy = async (content, key) => {
    const ok = await copyTextToClipboard(content)
    if (!ok) return
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 800)
  }

  if (!open) return null

  const title = direction === 'pull' ? t('skillSync.importTitle') : t('skillSync.title')
  const description = direction === 'pull' ? t('skillSync.importDescription') : t('skillSync.description')

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 1000, background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !syncing) closeSync() }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 'min(1040px, 94vw)',
          height: 'min(700px, 88vh)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          animation: 'modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <ArrowDownUp size={16} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <span className="font-bold flex-shrink-0" style={{ color: 'var(--text-primary)', fontSize: 16 }}>
            {title}
          </span>
          <span className="truncate" style={{ color: 'var(--text-dim)', fontSize: 12, minWidth: 0 }}>
            {description}
          </span>
          <div className="flex-1" />
          <button
            className="flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              cursor: syncing ? 'not-allowed' : 'pointer',
              color: 'var(--text-dim)',
              borderRadius: 4,
              transition: 'color 150ms ease',
              opacity: syncing ? 0.4 : 1,
            }}
            onClick={() => { if (!syncing) closeSync() }}
            disabled={syncing}
            onMouseEnter={(e) => { if (!syncing) e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {direction === 'pull' ? (
          <PullPromptPane
            importSkillInput={importSkillInput}
            setImportSkillInput={setImportSkillInput}
            importSkillNames={importSkillNames}
            addImportSkill={addImportSkill}
            removeImportSkill={removeImportSkill}
            uploadPrompt={uploadPrompt}
            promptLoading={promptLoading}
            healthInfo={healthInfo}
            localApiKey={localApiKey}
            copied={copiedKey === 'upload'}
            onCopy={() => handleCopy(uploadPrompt, 'upload')}
            hint={hint}
            clearHint={clearHint}
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <SkillSelectionPane
              projectSkills={projectSkills}
              globalSkills={globalSkills}
              filtered={filtered}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selected={selected}
              statuses={statuses}
              syncing={syncing}
              toggleOne={toggleOne}
              selectAll={selectAll}
              clearSelection={clearSelection}
              selectedCount={selectedCount}
              totalCount={totalCount}
            />
            <PushDestinationPane
              selectedCount={selectedCount}
              targetMode={targetMode}
              setTargetMode={setTargetMode}
              remoteUrl={remoteUrl}
              setRemoteUrl={setRemoteUrl}
              apiKey={apiKey}
              setApiKey={setApiKey}
              syncing={syncing}
              canSync={canSync}
              runSync={runSync}
              downloadPrompt={downloadPrompt}
              promptLoading={promptLoading}
              healthInfo={healthInfo}
              localApiKey={localApiKey}
              copied={copiedKey === 'download'}
              onCopy={() => handleCopy(downloadPrompt, 'download')}
              hint={hint}
              clearHint={clearHint}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes modal-scale-in {
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

function SkillSelectionPane({
  projectSkills,
  globalSkills,
  filtered,
  searchQuery,
  setSearchQuery,
  selected,
  statuses,
  syncing,
  toggleOne,
  selectAll,
  clearSelection,
  selectedCount,
  totalCount,
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col" style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <div
          className="flex items-center gap-1 flex-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            className="flex-1"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              minWidth: 0,
              fontSize: 13,
            }}
            placeholder={t('skills.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <ToolbarButton onClick={() => selectAll(filtered)}>{t('skillSync.selectAll')}</ToolbarButton>
        <ToolbarButton onClick={clearSelection}>{t('skillSync.clear')}</ToolbarButton>
      </div>

      <div
        className="px-3 py-1 uppercase"
        style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 11, fontWeight: 600 }}
      >
        {t('skillSync.selectedCount', { selected: selectedCount, total: totalCount })}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {projectSkills.length > 0 && (
          <>
            <SkillGroupLabel>{t('skills.project')}</SkillGroupLabel>
            {projectSkills.map((skill) => (
              <SyncRow
                key={`project-${skill.name}`}
                skill={skill}
                checked={!!selected[`project::${skill.name}`]}
                status={statuses[`project::${skill.name}`]}
                onToggle={() => toggleOne('project', skill.name)}
                disabled={syncing}
              />
            ))}
          </>
        )}
        {globalSkills.length > 0 && (
          <>
            <SkillGroupLabel offset={projectSkills.length > 0}>{t('skills.global')}</SkillGroupLabel>
            {globalSkills.map((skill) => (
              <SyncRow
                key={`global-${skill.name}`}
                skill={skill}
                checked={!!selected[`global::${skill.name}`]}
                status={statuses[`global::${skill.name}`]}
                onToggle={() => toggleOne('global', skill.name)}
                disabled={syncing}
              />
            ))}
          </>
        )}
        {filtered.length === 0 && (
          <div className="px-3 py-4" style={{ color: 'var(--text-dim)', textAlign: 'center', fontSize: 13 }}>
            {t('skills.noSkills')}
          </div>
        )}
      </div>
    </div>
  )
}

function PushDestinationPane({
  selectedCount,
  targetMode,
  setTargetMode,
  remoteUrl,
  setRemoteUrl,
  apiKey,
  setApiKey,
  syncing,
  canSync,
  runSync,
  downloadPrompt,
  promptLoading,
  healthInfo,
  localApiKey,
  copied,
  onCopy,
  hint,
  clearHint,
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col flex-shrink-0" style={{ width: 400, padding: '16px 20px', gap: 14 }}>
      {selectedCount === 0 ? (
        <EmptySelection />
      ) : (
        <>
          <SegmentedTarget targetMode={targetMode} setTargetMode={setTargetMode} />
          <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
            {targetMode === 'vivian' ? t('skillSync.remoteVivianDesc') : t('skillSync.remoteOtherDesc')}
          </div>

          {targetMode === 'vivian' ? (
            <RemoteVivianForm
              remoteUrl={remoteUrl}
              setRemoteUrl={setRemoteUrl}
              apiKey={apiKey}
              setApiKey={setApiKey}
              syncing={syncing}
              canSync={canSync}
              runSync={runSync}
              selectedCount={selectedCount}
              hint={hint}
              clearHint={clearHint}
            />
          ) : (
            <PromptPanel
              title={t('skillSync.downloadPromptTitle')}
              prompt={downloadPrompt}
              promptLoading={promptLoading}
              healthInfo={healthInfo}
              localApiKey={localApiKey}
              copied={copied}
              onCopy={onCopy}
            />
          )}
        </>
      )}
    </div>
  )
}

function PullPromptPane({
  importSkillInput,
  setImportSkillInput,
  importSkillNames,
  addImportSkill,
  removeImportSkill,
  uploadPrompt,
  promptLoading,
  healthInfo,
  localApiKey,
  copied,
  onCopy,
  hint,
  clearHint,
}) {
  const { t } = useTranslation()
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      e.preventDefault()
      addImportSkill()
    }
    if (e.key === 'Backspace' && !importSkillInput && importSkillNames.length > 0) {
      removeImportSkill(importSkillNames[importSkillNames.length - 1])
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ padding: '16px 20px', gap: 14 }}>
      <div
        className="flex flex-col gap-2 flex-shrink-0"
        style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          <UploadCloud size={14} strokeWidth={1.5} />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('skillSync.skillNames')}
          </span>
        </div>
        <div className="flex items-start gap-2 min-w-0">
          <div
            className="flex flex-wrap items-center gap-1 flex-1 min-w-0 p-1"
            style={{
              minHeight: 36,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
            onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
          >
            {importSkillNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1"
                style={{
                  maxWidth: '100%',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  padding: '3px 6px',
                }}
              >
                <span className="truncate" style={{ minWidth: 0 }}>{name}</span>
                <button
                  className="flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeImportSkill(name)
                  }}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </span>
            ))}
            <input
              className="flex-1"
              style={{
                minWidth: 160,
                height: 26,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 13,
                padding: '0 4px',
              }}
              value={importSkillInput}
              onChange={(e) => setImportSkillInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => addImportSkill()}
              placeholder={importSkillNames.length === 0 ? t('skillSync.skillNamesPlaceholder') : ''}
            />
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 px-3 py-2 flex-shrink-0"
            style={{
              minHeight: 36,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
            }}
            onClick={() => addImportSkill()}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Plus size={14} strokeWidth={1.5} />
            {t('skillSync.addSkillName')}
          </button>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
          {t('skillSync.skillNamesHint')}
        </div>
        {hint && <HintBanner hint={hint} onDismiss={clearHint} />}
      </div>
      <PromptPanel
        title={t('skillSync.uploadPromptTitle')}
        prompt={uploadPrompt}
        promptLoading={promptLoading}
        healthInfo={healthInfo}
        localApiKey={localApiKey}
        copied={copied}
        onCopy={onCopy}
      />
    </div>
  )
}

function RemoteVivianForm({
  remoteUrl,
  setRemoteUrl,
  apiKey,
  setApiKey,
  syncing,
  canSync,
  runSync,
  selectedCount,
  hint,
  clearHint,
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="uppercase" style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
          {t('skillSync.remoteUrl')}
        </label>
        <input
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            padding: '6px 8px',
          }}
          placeholder="https://vivian.example.com"
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          disabled={syncing}
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="uppercase" style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
          {t('skillSync.apiKey')}
        </label>
        <input
          type="password"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            padding: '6px 8px',
            fontFamily: 'JetBrains Mono, monospace',
          }}
          placeholder={t('skillSync.apiKeyPlaceholder')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={syncing}
          spellCheck={false}
          autoComplete="off"
        />
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {t('skillSync.apiKeyHint')}
        </span>
      </div>

      <div className="flex-1" />
      {hint && <HintBanner hint={hint} onDismiss={clearHint} />}
      <button
        className="flex items-center justify-center gap-2 px-3 py-2"
        style={{
          background: canSync ? 'var(--blue)' : 'var(--bg-elevated)',
          border: canSync ? '1px solid var(--blue)' : '1px solid var(--border)',
          borderRadius: 4,
          cursor: canSync ? 'pointer' : 'not-allowed',
          color: canSync ? 'var(--text-inverse)' : 'var(--text-dim)',
          fontSize: 13,
          fontWeight: 600,
          transition: 'opacity 150ms ease',
          opacity: syncing ? 0.6 : 1,
        }}
        onClick={runSync}
        disabled={!canSync}
      >
        {syncing ? (
          <Loader size={14} strokeWidth={1.5} style={{ animation: 'spin 1.2s linear infinite' }} />
        ) : (
          <ArrowUp size={14} strokeWidth={1.5} />
        )}
        {syncing ? t('skillSync.syncing') : t('skillSync.syncSelected', { count: selectedCount })}
      </button>
    </>
  )
}

function SegmentedTarget({ targetMode, setTargetMode }) {
  const { t } = useTranslation()
  const options = [
    { id: 'vivian', label: t('skillSync.remoteVivianMode') },
    { id: 'other', label: t('skillSync.remoteOtherMode') },
  ]
  return (
    <div
      className="flex items-stretch p-1"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, gap: 4 }}
    >
      {options.map((option) => {
        const active = option.id === targetMode
        return (
          <button
            key={option.id}
            className="flex-1 px-2 py-2"
            style={{
              minWidth: 0,
              background: active ? 'var(--bg-surface)' : 'transparent',
              border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
              borderRadius: 4,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              textAlign: 'center',
              transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
              overflowWrap: 'break-word',
            }}
            onClick={() => setTargetMode(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function PromptPanel({ title, prompt, promptLoading, healthInfo, localApiKey, copied, onCopy }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ gap: 10 }}>
      <div className="flex items-center gap-2">
        <Download size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span className="font-semibold flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {title}
        </span>
        <button
          className="inline-flex items-center justify-center gap-2 px-2 py-1"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: copied ? 'var(--green)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
          }}
          onClick={onCopy}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-strong)'
            e.currentTarget.style.background = 'var(--bg-elevated)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
          {copied ? t('skillSync.copied') : t('skillSync.copyPrompt')}
        </button>
      </div>
      {promptLoading && (
        <InlineNotice level="info">{t('skillSync.healthLoading')}</InlineNotice>
      )}
      {!localApiKey && (
        <InlineNotice level="warning">{t('skillSync.vivianApiMissing')}</InlineNotice>
      )}
      {healthInfo?.base_url && (
        <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {t('skillSync.localVivian', { url: healthInfo.base_url })}
        </div>
      )}
      <pre
        className="flex-1 min-h-0 overflow-auto"
        style={{
          margin: 0,
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text-secondary)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          lineHeight: 1.6,
          padding: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {prompt}
      </pre>
    </div>
  )
}

function EmptySelection() {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col gap-2"
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: '2px solid var(--status-pending)',
        borderRadius: 2,
        padding: 12,
      }}
    >
      <div className="flex items-center gap-2" style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
        <Download size={14} strokeWidth={1.5} />
        {t('skillSync.selectSkillsFirstTitle')}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
        {t('skillSync.selectSkillsFirstDesc')}
      </div>
    </div>
  )
}

function ToolbarButton({ children, onClick }) {
  return (
    <button
      className="px-2 py-1 uppercase"
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 4,
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        transition: 'color 150ms ease, border-color 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)'
        e.currentTarget.style.borderColor = 'var(--border-strong)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {children}
    </button>
  )
}

function SkillGroupLabel({ children, offset = false }) {
  return (
    <div
      className="px-3 py-1 uppercase font-semibold"
      style={{
        color: 'var(--text-dim)',
        letterSpacing: '0.06em',
        fontSize: 11,
        marginTop: offset ? 8 : 0,
      }}
    >
      {children}
    </div>
  )
}

function SyncRow({ skill, checked, status, onToggle, disabled }) {
  const { t } = useTranslation()
  const stateLabel = (() => {
    if (!status) return ''
    if (status.state === 'pending') return t('skillSync.statePending')
    if (status.state === 'downloading') return t('skillSync.stateDownloading')
    if (status.state === 'uploading') return t('skillSync.stateUploading')
    if (status.state === 'done') return t('skillSync.stateDone')
    if (status.state === 'failed') return t('skillSync.stateFailed')
    return ''
  })()
  const stateColor = status?.state === 'failed'
    ? 'var(--red)'
    : status?.state === 'done'
      ? 'var(--green)'
      : status?.state === 'downloading' || status?.state === 'uploading'
        ? 'var(--purple)'
        : 'var(--text-dim)'

  return (
    <label
      className="flex items-center gap-2 px-3 py-2"
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        style={{ accentColor: 'var(--blue)', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="truncate" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {skill.name}
        </span>
        {skill.description && (
          <span className="truncate" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {skill.description}
          </span>
        )}
      </div>
      {status && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusIcon state={status.state} />
          <span
            className="uppercase"
            style={{ color: stateColor, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}
            title={status.state === 'failed' ? status.error : undefined}
          >
            {stateLabel}
          </span>
        </div>
      )}
    </label>
  )
}

function InlineNotice({ level, children }) {
  const color = level === 'warning' ? 'var(--yellow)' : 'var(--text-secondary)'
  const border = level === 'warning' ? 'var(--yellow)' : 'var(--border)'
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: `2px solid ${border}`,
        borderRadius: 2,
        color,
        fontSize: 12,
        lineHeight: 1.5,
        padding: '7px 9px',
      }}
    >
      {children}
    </div>
  )
}

function HintBanner({ hint, onDismiss }) {
  const { t } = useTranslation()
  const palette = (() => {
    if (hint.level === 'error') return { color: 'var(--red)', border: 'var(--red)' }
    if (hint.level === 'warning') return { color: 'var(--yellow)', border: 'var(--yellow)' }
    if (hint.level === 'success') return { color: 'var(--green)', border: 'var(--green)' }
    return { color: 'var(--text-secondary)', border: 'var(--border)' }
  })()
  const Icon = hint.level === 'error' || hint.level === 'warning'
    ? AlertCircle
    : hint.level === 'success'
      ? Check
      : Loader
  const spin = hint.level === 'info'

  return (
    <div
      className="flex items-start gap-2"
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: `2px solid ${palette.border}`,
        borderRadius: 2,
        padding: '8px 10px',
        fontSize: 12,
        color: palette.color,
      }}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        style={{ flexShrink: 0, marginTop: 1, animation: spin ? 'spin 1.2s linear infinite' : 'none' }}
      />
      <span style={{ flex: 1, lineHeight: 1.5, wordBreak: 'break-word' }}>
        {t(hint.key, hint.values)}
      </span>
      {hint.level !== 'info' && (
        <button
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 16,
            height: 16,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: palette.color,
            borderRadius: 2,
          }}
          onClick={onDismiss}
          title="Dismiss"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}
