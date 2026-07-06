import { lazy, Suspense, useState, useEffect, useCallback, useId, useRef } from 'react'
import { X, Plus, Trash2, Check, XCircle, Loader, ChevronDown, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSchedulerStore from '../../stores/schedulerStore'
import useUiStore from '../../stores/uiStore'
import useChatStore from '../../stores/chatStore'
import { postJSON } from '../../api/client'
import { previewFile } from '../../api/userFiles'
import TriggerConfigForm from './TriggerConfigForm'
import PromptComposer from '../shared/PromptComposer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import safeStorage from '../../utils/safeStorage'

const ScriptEditor = lazy(() => import('../shared/ScriptEditor'))

// Modal resize constraints — width 480-1200px, height 400px to 90vh
const SIZE_MIN_W = 480
const SIZE_MAX_W = 1200
const SIZE_MIN_H = 400
const SIZE_MAX_H_RATIO = 0.9
const SIZE_DEFAULT = { width: 560, height: 640 }
const SIZE_STORAGE_KEY = 'jobform-size'

// Drag deltas are doubled because the modal is centered (transform: translate(-50%, -50%));
// growing width by 2*deltaX moves each edge by deltaX, so the cursor tracks the edge 1:1.
const RESIZE_HANDLES = [
  { dir: 'n',  dx:  0, dy: -2, cursor: 'ns-resize',   style: { top: -3, left: 12, right: 12, height: 6 } },
  { dir: 's',  dx:  0, dy:  2, cursor: 'ns-resize',   style: { bottom: -3, left: 12, right: 12, height: 6 } },
  { dir: 'e',  dx:  2, dy:  0, cursor: 'ew-resize',   style: { top: 12, bottom: 12, right: -3, width: 6 } },
  { dir: 'w',  dx: -2, dy:  0, cursor: 'ew-resize',   style: { top: 12, bottom: 12, left: -3, width: 6 } },
  { dir: 'ne', dx:  2, dy: -2, cursor: 'nesw-resize', style: { top: -3, right: -3, width: 15, height: 15 } },
  { dir: 'nw', dx: -2, dy: -2, cursor: 'nwse-resize', style: { top: -3, left: -3, width: 15, height: 15 } },
  { dir: 'se', dx:  2, dy:  2, cursor: 'nwse-resize', style: { bottom: -3, right: -3, width: 15, height: 15 } },
  { dir: 'sw', dx: -2, dy:  2, cursor: 'nesw-resize', style: { bottom: -3, left: -3, width: 15, height: 15 } },
]

const clampSize = (w, h) => ({
  width: Math.max(SIZE_MIN_W, Math.min(SIZE_MAX_W, Math.min(w, window.innerWidth - 32))),
  height: Math.max(SIZE_MIN_H, Math.min(Math.floor(window.innerHeight * SIZE_MAX_H_RATIO), h)),
})

const loadSavedSize = () => {
  const v = safeStorage.getJSON(SIZE_STORAGE_KEY)
  if (typeof v?.width === 'number' && typeof v?.height === 'number') {
    return clampSize(v.width, v.height)
  }
  return clampSize(SIZE_DEFAULT.width, SIZE_DEFAULT.height)
}

const inputStyle = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: '2px',
  padding: '8px 10px',
  fontSize: 13,
  width: '100%',
  outline: 'none',
}

const textareaStyle = {
  ...inputStyle,
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  minHeight: 100,
  resize: 'vertical',
}

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238b949e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 28,
}

const JOB_TYPES = ['scheduled_agent', 'http_call', 'user_script']

const typeTabStyle = (active) => ({
  flex: 1,
  padding: '6px 0',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  background: active ? 'var(--bg-elevated)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-dim)',
  border: 'none',
  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
  transition: 'color 150ms ease, background 150ms ease',
  textAlign: 'center',
})

function Label({ children }) {
  return (
    <label className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
      {children}
    </label>
  )
}

function SyntaxExpander({ syntaxStatus, syntaxErrors, syntaxExpanded, setSyntaxExpanded, t }) {
  const bodyId = useId()
  if (syntaxStatus === 'idle') return null
  const errorCount = syntaxErrors.filter((e) => e.severity === 'error').length
  const warningCount = syntaxErrors.filter((e) => e.severity !== 'error').length
  const hasDetails = syntaxErrors.length > 0
  const canExpand = hasDetails && (syntaxStatus === 'failed' || syntaxStatus === 'passed')

  // Border color: red if errors, yellow if warnings only, green if clean
  const borderColor = syntaxStatus === 'failed' ? 'var(--red)'
    : warningCount > 0 ? 'var(--yellow)' : 'var(--green)'

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: `2px solid ${borderColor}`,
        borderRadius: '0 2px 2px 0',
      }}
    >
      <button
        type="button"
        className="flex items-center gap-2 px-2 py-2 text-xs font-semibold uppercase"
        style={{
          cursor: canExpand ? 'pointer' : 'default',
          letterSpacing: '0.06em',
          color: 'var(--text-primary)',
          userSelect: 'none',
          background: 'transparent',
          border: 'none',
          width: '100%',
          textAlign: 'left',
        }}
        onClick={() => { if (canExpand) setSyntaxExpanded((v) => !v) }}
        aria-expanded={canExpand ? syntaxExpanded : undefined}
        aria-controls={canExpand ? bodyId : undefined}
      >
        {canExpand && (
          <AnimatedChevron open={syntaxExpanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
        )}
        {syntaxStatus === 'checking' && (
          <>
            <Loader size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite', color: 'var(--yellow)' }} />
            <span style={{ color: 'var(--yellow)' }}>{t('scheduler.syntaxChecking')}</span>
          </>
        )}
        {syntaxStatus === 'passed' && !warningCount && (
          <>
            <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
            <span style={{ color: 'var(--green)' }}>{t('scheduler.syntaxOk')}</span>
          </>
        )}
        {syntaxStatus === 'passed' && warningCount > 0 && (
          <>
            <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
            <span style={{ color: 'var(--green)' }}>{t('scheduler.syntaxOk')}</span>
            <span style={{ color: 'var(--yellow)', marginLeft: 4 }}>
              {warningCount} {warningCount === 1 ? 'WARNING' : 'WARNINGS'}
            </span>
          </>
        )}
        {syntaxStatus === 'failed' && (
          <>
            <XCircle size={12} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
            <span style={{ color: 'var(--red)' }}>
              {errorCount} {errorCount === 1 ? 'ERROR' : 'ERRORS'}
            </span>
            {warningCount > 0 && (
              <span style={{ color: 'var(--yellow)', marginLeft: 4 }}>
                {warningCount} {warningCount === 1 ? 'WARNING' : 'WARNINGS'}
              </span>
            )}
          </>
        )}
      </button>
      <AnimatedCollapse
        open={canExpand && syntaxExpanded}
        id={bodyId}
        style={{ borderTop: '1px solid var(--border-subtle)' }}
        innerClassName="flex flex-col gap-1 px-3 pb-2 text-xs"
        innerStyle={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
      >
          {syntaxErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <X size={10} strokeWidth={1.5} style={{
                color: err.severity === 'error' ? 'var(--red)' : 'var(--yellow)',
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text-secondary)' }}>
                Line {err.line}: {err.message}
              </span>
            </div>
          ))}
      </AnimatedCollapse>
    </div>
  )
}

export default function JobForm() {
  const { t } = useTranslation()
  const formOpen = useSchedulerStore((s) => s.formOpen)
  const editingJob = useSchedulerStore((s) => s.editingJob)
  const setFormOpen = useSchedulerStore((s) => s.setFormOpen)
  const setEditingJob = useSchedulerStore((s) => s.setEditingJob)
  const createJob = useSchedulerStore((s) => s.createJob)
  const updateJobAction = useSchedulerStore((s) => s.updateJob)

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const [name, setName] = useState('')
  const [jobType, setJobType] = useState('scheduled_agent')
  const [trigger, setTrigger] = useState({ type: 'cron', expr: '0 9 * * *' })
  const [timezone, setTimezone] = useState(browserTz)
  const [saving, setSaving] = useState(false)

  // Agent Run fields
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [agentAttachments, setAgentAttachments] = useState([])
  const [agentSkill, setAgentSkill] = useState(null)

  // Functional updater wrapper for PromptComposer
  const handleAttachmentsChange = useCallback((updater) => {
    setAgentAttachments((prev) => typeof updater === 'function' ? updater(prev) : updater)
  }, [])

  // HTTP Call fields
  const [httpMethod, setHttpMethod] = useState('GET')
  const [httpUrl, setHttpUrl] = useState('')
  const [httpHeaders, setHttpHeaders] = useState([])
  const [httpBody, setHttpBody] = useState('')
  const [httpTimeout, setHttpTimeout] = useState(30)

  // User Script fields
  const [scriptLanguage, setScriptLanguage] = useState('python')
  const [scriptSource, setScriptSource] = useState('file')
  const [scriptFilePath, setScriptFilePath] = useState('')
  const [scriptContent, setScriptContent] = useState('')
  const [scriptTimeout, setScriptTimeout] = useState(300)

  // Syntax check state: 'idle' | 'checking' | 'passed' | 'failed'
  const [syntaxStatus, setSyntaxStatus] = useState('idle')
  const [syntaxErrors, setSyntaxErrors] = useState([])
  const [syntaxExpanded, setSyntaxExpanded] = useState(false)
  const checkedContentRef = useRef('')

  // File preview state
  const [fileContent, setFileContent] = useState('')
  const [fileError, setFileError] = useState('')
  const [fileLoading, setFileLoading] = useState(false)

  // Resizable modal state — width/height persisted to localStorage['jobform-size']
  const [size, setSize] = useState(loadSavedSize)
  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])

  // Clamp size to current viewport on open and whenever the window resizes.
  useEffect(() => {
    if (!formOpen) return
    const refit = () => setSize((s) => clampSize(s.width, s.height))
    refit()
    window.addEventListener('resize', refit)
    return () => window.removeEventListener('resize', refit)
  }, [formOpen])

  const handleResizeStart = useCallback((e, handle) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = sizeRef.current.width
    const startH = sizeRef.current.height
    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      setSize(clampSize(startW + handle.dx * dx, startH + handle.dy * dy))
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      safeStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(sizeRef.current))
    }
    document.body.style.cursor = handle.cursor
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name)
      setTrigger(editingJob.trigger)
      setTimezone(editingJob.timezone)

      const jc = editingJob.job_config
      if (jc) {
        // Backcompat: legacy job_type "agent_run" was renamed to "scheduled_agent"
        const normalizedType = jc.job_type === 'agent_run' ? 'scheduled_agent' : jc.job_type
        setJobType(normalizedType)
        if (normalizedType === 'scheduled_agent') {
          setPrompt(jc.prompt || '')
          setModel(jc.model || '')
        } else if (jc.job_type === 'http_call') {
          setHttpMethod(jc.method || 'GET')
          setHttpUrl(jc.url || '')
          setHttpHeaders(Object.entries(jc.headers || {}).map(([k, v]) => ({ key: k, value: v })))
          setHttpBody(jc.body || '')
          setHttpTimeout(jc.timeout_seconds || 30)
        } else if (jc.job_type === 'user_script') {
          setScriptLanguage(jc.language || 'python')
          setScriptSource(jc.source || 'file')
          setScriptFilePath(jc.file_path || '')
          setScriptContent(jc.script || '')
          setScriptTimeout(jc.timeout_seconds || 300)
        }
      } else {
        // Legacy job: prompt-only
        setJobType('scheduled_agent')
        setPrompt(editingJob.prompt || '')
        setModel(editingJob.model || '')
      }
    } else {
      setName('')
      setJobType('scheduled_agent')
      setTrigger({ type: 'cron', expr: '0 9 * * *' })
      setTimezone(browserTz)
      setPrompt('')
      setModel('')
      setAgentAttachments([])
      setAgentSkill(null)
      setHttpMethod('GET')
      setHttpUrl('')
      setHttpHeaders([])
      setHttpBody('')
      setHttpTimeout(30)
      setScriptLanguage('python')
      setScriptSource('file')
      setScriptFilePath('')
      setScriptContent('')
      setScriptTimeout(300)
    }
  }, [editingJob, formOpen])

  // Auto-run syntax check with debounce when code or language changes
  useEffect(() => {
    if (jobType !== 'user_script' || scriptSource !== 'inline') return
    if (!scriptContent.trim()) {
      setSyntaxStatus('idle')
      setSyntaxErrors([])
      return
    }
    setSyntaxStatus('idle')
    setSyntaxErrors([])
    const timer = setTimeout(async () => {
      setSyntaxStatus('checking')
      try {
        const { diagnostics } = await postJSON('/scheduler/lint-script', {
          code: scriptContent,
          language: scriptLanguage,
        })
        checkedContentRef.current = scriptContent
        const hasErrors = diagnostics.some((d) => d.severity === 'error')
        setSyntaxErrors(diagnostics)
        if (hasErrors) {
          setSyntaxStatus('failed')
          setSyntaxExpanded(true)
        } else {
          setSyntaxStatus('passed')
          setSyntaxExpanded(false)
        }
      } catch {
        setSyntaxStatus('failed')
        setSyntaxErrors([{ line: 1, severity: 'error', message: 'Syntax check service unavailable' }])
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [scriptContent, scriptLanguage, jobType, scriptSource])

  // File mode: fetch content + validate + syntax check when path changes
  useEffect(() => {
    if (jobType !== 'user_script' || scriptSource !== 'file') return
    if (!scriptFilePath.trim()) {
      setFileContent('')
      setFileError('')
      setSyntaxStatus('idle')
      setSyntaxErrors([])
      return
    }
    // Validate extension matches language
    const ext = scriptFilePath.split('.').pop()?.toLowerCase()
    const validExts = scriptLanguage === 'python' ? ['py', 'pyw'] : ['sh', 'bash', 'zsh', 'ksh']
    setFileContent('')
    setFileError('')
    setSyntaxStatus('idle')
    setSyntaxErrors([])
    setFileLoading(false)

    const timer = setTimeout(async () => {
      if (!validExts.includes(ext)) {
        setFileError(t('scheduler.fileExtMismatch', { expected: validExts.join(', '), got: ext || '?' }))
        return
      }
      setFileLoading(true)
      try {
        const preview = await previewFile(scriptFilePath.trim())
        if (preview.is_binary || !preview.content) {
          setFileError(t('scheduler.fileBinaryOrEmpty'))
          setFileLoading(false)
          return
        }
        setFileContent(preview.content)
        setFileLoading(false)
        // Run syntax check on the file content
        setSyntaxStatus('checking')
        try {
          const { diagnostics } = await postJSON('/scheduler/lint-script', {
            code: preview.content,
            language: scriptLanguage,
          })
          const hasErrors = diagnostics.some((d) => d.severity === 'error')
          setSyntaxErrors(diagnostics)
          if (hasErrors) {
            setSyntaxStatus('failed')
            setSyntaxExpanded(true)
          } else {
            setSyntaxStatus('passed')
            setSyntaxExpanded(false)
          }
        } catch {
          setSyntaxStatus('failed')
          setSyntaxErrors([{ line: 1, severity: 'error', message: 'Syntax check service unavailable' }])
        }
      } catch (err) {
        setFileLoading(false)
        setFileError(t('scheduler.fileNotFound'))
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [scriptFilePath, scriptLanguage, jobType, scriptSource])

  if (!formOpen) return null

  const handleClose = () => {
    setFormOpen(false)
    setEditingJob(null)
  }

  const isValid = () => {
    if (!name.trim()) return false
    if (jobType === 'scheduled_agent') return !!prompt.trim() || !!agentSkill || agentAttachments.some((a) => a.status === 'done')
    if (jobType === 'http_call') return !!httpUrl.trim()
    if (jobType === 'user_script') {
      if (scriptSource === 'file') return !!scriptFilePath.trim() && syntaxStatus === 'passed' && !fileError
      return !!scriptContent.trim() && syntaxStatus === 'passed'
    }
    return false
  }

  const buildJobConfig = () => {
    if (jobType === 'scheduled_agent') {
      const text = prompt.trim()
      const fullPrompt = agentSkill ? `/${agentSkill.name} ${text}`.trim() : text
      const doneFiles = agentAttachments.filter((a) => a.status === 'done' && !a.isImage)
      let finalPrompt = fullPrompt
      if (doneFiles.length > 0) {
        const fileRefs = doneFiles.map((a) => `<file name="${a.originalName || a.name}" path="${a.path}" />`).join('\n')
        finalPrompt = `<uploaded-files>\nDo NOT directly read non-plain-text binary files as plaintext. For files such as pdf, docx, xlsx, pptx, images, archives, or other binary formats, use an appropriate tool or processing method instead of treating them as plain text.\nIf you create, convert, render, export, modify, or even just read a non-plain-text file (such as pdf, docx, xlsx, pptx, html, images, or similar rich-preview files) — including when Bash invokes a python, node, or shell script that opens such a file (e.g. \`python parse.py data.xlsx\`, \`node read.js report.pdf\`, \`bash analyze.sh file.docx\`) — always call \`mcp__vivian_File__FileCanvas\` with that file's path so Vivian can register it to the frontend Canvas panel.\n${fileRefs}\n</uploaded-files>\n\n${fullPrompt}`
      }
      return {
        job_type: 'scheduled_agent',
        prompt: finalPrompt,
        model: model.trim() || null,
      }
    }
    if (jobType === 'http_call') {
      const headers = {}
      httpHeaders.forEach((h) => {
        if (h.key.trim()) headers[h.key.trim()] = h.value
      })
      return {
        job_type: 'http_call',
        method: httpMethod,
        url: httpUrl.trim(),
        headers,
        body: httpBody.trim() || null,
        timeout_seconds: httpTimeout,
      }
    }
    if (jobType === 'user_script') {
      return {
        job_type: 'user_script',
        language: scriptLanguage,
        source: scriptSource,
        file_path: scriptSource === 'file' ? scriptFilePath.trim() : null,
        script: scriptSource === 'inline' ? scriptContent : null,
        timeout_seconds: scriptTimeout,
      }
    }
  }

  const handleSubmit = async () => {
    if (!isValid()) return
    setSaving(true)
    try {
      const jobConfig = buildJobConfig()
      const data = {
        name: name.trim(),
        prompt: jobType === 'scheduled_agent' ? jobConfig.prompt : '',
        trigger,
        timezone,
        model: jobType === 'scheduled_agent' ? (model.trim() || null) : null,
        job_config: jobConfig,
      }
      if (editingJob) {
        await updateJobAction(editingJob.id, data)
      } else {
        await createJob(data)
      }
      handleClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0"
        style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)', zIndex: 200 }}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="fixed"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: size.width,
          height: size.height,
          overflow: 'hidden',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          zIndex: 201,
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Resize handles (8-way) — transparent hit zones, blue tint on hover */}
        {RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.dir}
            onPointerDown={(e) => handleResizeStart(e, handle)}
            style={{
              position: 'absolute',
              cursor: handle.cursor,
              zIndex: 10,
              background: 'transparent',
              transition: 'background 150ms ease',
              ...handle.style,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--blue)'; e.currentTarget.style.opacity = '0.25' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '1' }}
          />
        ))}

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}
        >
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {editingJob ? t('scheduler.editJob') : t('scheduler.createJob')}
          </span>
          <button
            onClick={handleClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-4" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Name */}
          <div className="flex flex-col gap-1">
            <Label>{t('scheduler.name')}</Label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('scheduler.namePlaceholder')} />
          </div>

          {/* Job Type Selector */}
          <div className="flex flex-col gap-1">
            <Label>{t('scheduler.jobType')}</Label>
            <div className="flex" style={{ border: '1px solid var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              {JOB_TYPES.map((type) => (
                <button
                  key={type}
                  style={typeTabStyle(jobType === type)}
                  onClick={() => setJobType(type)}
                  onMouseEnter={(e) => { if (jobType !== type) e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { if (jobType !== type) e.currentTarget.style.color = 'var(--text-dim)' }}
                >
                  {t(`scheduler.${type === 'scheduled_agent' ? 'agentRun' : type === 'http_call' ? 'httpCall' : 'userScript'}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Conditional fields per type */}
          {jobType === 'scheduled_agent' && (
            <>
              <div className="flex flex-col gap-1">
                <Label>{t('scheduler.prompt')}</Label>
                <PromptComposer
                  value={prompt}
                  onChange={setPrompt}
                  attachments={agentAttachments}
                  onAttachmentsChange={handleAttachmentsChange}
                  skill={agentSkill}
                  onSkillChange={setAgentSkill}
                  placeholder={t('scheduler.promptPlaceholder')}
                  minHeight={100}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t('scheduler.model')}</Label>
                <input style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('scheduler.modelPlaceholder')} />
              </div>
            </>
          )}

          {jobType === 'http_call' && (
            <>
              <div className="flex gap-2">
                <div className="flex flex-col gap-1" style={{ width: 120, flexShrink: 0 }}>
                  <Label>{t('scheduler.httpMethod')}</Label>
                  <select style={selectStyle} value={httpMethod} onChange={(e) => setHttpMethod(e.target.value)}>
                    {['GET', 'POST', 'PUT', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Label>{t('scheduler.httpUrl')}</Label>
                  <input style={inputStyle} value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} placeholder={t('scheduler.httpUrlPlaceholder')} />
                </div>
              </div>

              {/* Headers */}
              <div className="flex flex-col gap-1">
                <Label>{t('scheduler.httpHeaders')}</Label>
                <div className="flex flex-col gap-1">
                  {httpHeaders.map((h, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={h.key}
                        onChange={(e) => {
                          const next = [...httpHeaders]
                          next[i] = { ...next[i], key: e.target.value }
                          setHttpHeaders(next)
                        }}
                        placeholder={t('scheduler.httpHeaderKey')}
                      />
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={h.value}
                        onChange={(e) => {
                          const next = [...httpHeaders]
                          next[i] = { ...next[i], value: e.target.value }
                          setHttpHeaders(next)
                        }}
                        placeholder={t('scheduler.httpHeaderValue')}
                      />
                      <button
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, flexShrink: 0, transition: 'color 150ms ease' }}
                        onClick={() => setHttpHeaders(httpHeaders.filter((_, j) => j !== i))}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="flex items-center gap-1 text-xs"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '4px 0', transition: 'color 150ms ease' }}
                    onClick={() => setHttpHeaders([...httpHeaders, { key: '', value: '' }])}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  >
                    <Plus size={12} strokeWidth={1.5} />
                    {t('scheduler.addHeader')}
                  </button>
                </div>
              </div>

              {/* Body */}
              {(httpMethod === 'POST' || httpMethod === 'PUT') && (
                <div className="flex flex-col gap-1">
                  <Label>{t('scheduler.httpBody')}</Label>
                  <textarea style={textareaStyle} value={httpBody} onChange={(e) => setHttpBody(e.target.value)} placeholder={t('scheduler.httpBodyPlaceholder')} />
                </div>
              )}

              <div className="flex flex-col gap-1" style={{ width: 140 }}>
                <Label>{t('scheduler.timeout')}</Label>
                <input style={inputStyle} type="number" min={1} max={300} value={httpTimeout} onChange={(e) => setHttpTimeout(Number(e.target.value) || 30)} />
              </div>
            </>
          )}

          {jobType === 'user_script' && (
            <>
              <div className="flex gap-2">
                <div className="flex flex-col gap-1" style={{ width: 140, flexShrink: 0 }}>
                  <Label>{t('scheduler.scriptLanguage')}</Label>
                  <select style={selectStyle} value={scriptLanguage} onChange={(e) => setScriptLanguage(e.target.value)}>
                    <option value="python">Python</option>
                    <option value="shell">Shell</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1" style={{ width: 140, flexShrink: 0 }}>
                  <Label>{t('scheduler.scriptSource')}</Label>
                  <div className="flex" style={{ border: '1px solid var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                    {['file', 'inline'].map((src) => (
                      <button
                        key={src}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: scriptSource === src ? 'var(--bg-elevated)' : 'transparent',
                          color: scriptSource === src ? 'var(--text-primary)' : 'var(--text-dim)',
                          border: 'none',
                          borderBottom: scriptSource === src ? '2px solid var(--blue)' : '2px solid transparent',
                          transition: 'color 150ms ease',
                        }}
                        onClick={() => setScriptSource(src)}
                      >
                        {t(`scheduler.script${src === 'file' ? 'File' : 'Inline'}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {scriptSource === 'file' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>{t('scheduler.scriptFilePath')}</Label>
                    <input
                      style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
                      value={scriptFilePath}
                      onChange={(e) => setScriptFilePath(e.target.value)}
                      placeholder={scriptLanguage === 'shell' ? 'path/to/script.sh' : 'path/to/script.py'}
                    />
                  </div>

                  {/* File error message */}
                  {fileError && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 text-xs"
                      style={{
                        background: 'var(--bg-elevated)',
                        borderLeft: '2px solid var(--red)',
                        borderRadius: '0 2px 2px 0',
                        color: 'var(--red)',
                      }}
                    >
                      <XCircle size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                      <span>{fileError}</span>
                    </div>
                  )}

                  {/* File loading skeleton */}
                  {fileLoading && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 text-xs"
                      style={{
                        background: 'var(--bg-elevated)',
                        borderLeft: '2px solid var(--yellow)',
                        borderRadius: '0 2px 2px 0',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <Loader size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite', color: 'var(--yellow)' }} />
                      <span>{t('scheduler.fileLoading')}</span>
                    </div>
                  )}

                  {/* File content preview */}
                  {fileContent && !fileLoading && (
                    <div className="flex flex-col gap-1">
                      <Label>{t('scheduler.filePreview')}</Label>
                      <Suspense fallback={<div className="skeleton" style={{ height: 100, borderRadius: 2 }} />}>
                        <ScriptEditor
                          value={fileContent}
                          onChange={() => {}}
                          language={scriptLanguage}
                          minHeight={100}
                          maxHeight={240}
                          readOnly
                          diagnostics={syntaxErrors}
                          modalFooter={syntaxStatus !== 'idle' ? (
                            <SyntaxExpander
                              syntaxStatus={syntaxStatus}
                              syntaxErrors={syntaxErrors}
                              syntaxExpanded={syntaxExpanded}
                              setSyntaxExpanded={setSyntaxExpanded}
                              t={t}
                            />
                          ) : null}
                        />
                      </Suspense>
                    </div>
                  )}

                  {/* Syntax status expander (file mode) */}
                  {!fileError && !fileLoading && fileContent && syntaxStatus !== 'idle' && (
                    <SyntaxExpander
                      syntaxStatus={syntaxStatus}
                      syntaxErrors={syntaxErrors}
                      syntaxExpanded={syntaxExpanded}
                      setSyntaxExpanded={setSyntaxExpanded}
                      t={t}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>{t('scheduler.scriptContent')}</Label>
                    <Suspense fallback={<div className="skeleton" style={{ height: 140, borderRadius: 2 }} />}>
                      <ScriptEditor
                        value={scriptContent}
                        onChange={setScriptContent}
                        language={scriptLanguage}
                        placeholder={t('scheduler.scriptContentPlaceholder')}
                        minHeight={140}
                        maxHeight={300}
                        diagnostics={syntaxErrors}
                        modalFooter={syntaxStatus !== 'idle' ? (
                          <SyntaxExpander
                            syntaxStatus={syntaxStatus}
                            syntaxErrors={syntaxErrors}
                            syntaxExpanded={syntaxExpanded}
                            setSyntaxExpanded={setSyntaxExpanded}
                            t={t}
                          />
                        ) : null}
                      />
                    </Suspense>
                  </div>

                  {/* Ask Vivian button */}
                  <button
                    className="flex items-center gap-1 text-xs"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-dim)',
                      padding: 0,
                      alignSelf: 'flex-start',
                      transition: 'color 150ms ease',
                    }}
                    onClick={() => {
                      const lang = scriptLanguage === 'python' ? 'Python' : 'Shell'
                      useUiStore.getState().setActiveNavTab('vivian')
                      useChatStore.getState().setInputText(t('scheduler.askVivianPrompt', { language: lang }))
                      handleClose()
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--purple)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  >
                    <Sparkles size={12} strokeWidth={1.5} />
                    {t('scheduler.askVivian')}
                  </button>

                  {/* Syntax status expander (inline mode) */}
                  <SyntaxExpander
                    syntaxStatus={syntaxStatus}
                    syntaxErrors={syntaxErrors}
                    syntaxExpanded={syntaxExpanded}
                    setSyntaxExpanded={setSyntaxExpanded}
                    t={t}
                  />
                </div>
              )}

              <div className="flex flex-col gap-1" style={{ width: 140 }}>
                <Label>{t('scheduler.timeout')}</Label>
                <input style={inputStyle} type="number" min={1} max={3600} value={scriptTimeout} onChange={(e) => setScriptTimeout(Number(e.target.value) || 300)} />
              </div>
            </>
          )}

          {/* Trigger */}
          <div className="flex flex-col gap-1">
            <Label>{t('scheduler.trigger')}</Label>
            <TriggerConfigForm trigger={trigger} onChange={setTrigger} />
          </div>

          {/* Timezone — only show when editing (users rarely change it) */}
          {editingJob && (
            <div className="flex flex-col gap-1">
              <Label>{t('scheduler.timezone')}</Label>
              <input style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}
        >
          <button
            className="px-3 py-1 text-sm"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onClick={handleClose}
          >
            {t('confirm.cancel')}
          </button>
          <button
            className="px-3 py-1 text-sm"
            style={{
              background: 'var(--blue)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: '2px',
              cursor: saving || !isValid() ? 'default' : 'pointer',
              opacity: saving || !isValid() ? 0.5 : 1,
              transition: 'opacity 150ms ease',
            }}
            onClick={handleSubmit}
            disabled={saving || !isValid()}
          >
            {saving ? t('settings.saving') : editingJob ? t('settings.save') : t('admin.create')}
          </button>
        </div>
      </div>
    </>
  )
}
