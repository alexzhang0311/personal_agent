import { useRef, useEffect, useState, useCallback } from 'react'
import { Send, Square, Shield, Cable, ChevronRight, X, AlertTriangle, Cpu, CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useUiStore from '../../stores/uiStore'
import useSettingsStore from '../../stores/settingsStore'
import useMcpStore from '../../stores/mcpStore'
import useTaskStore from '../../stores/taskStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { useSSE } from '../../hooks/useSSE'
import AskUserQuestionCard from './AskUserQuestionCard'
import PermissionRequestCard from './PermissionRequestCard'
import PlanApprovalCard from './PlanApprovalCard'
import ModelSelector from './ModelSelector'
import PromptComposer from '../shared/PromptComposer'
import ErrorBoundary from '../shared/ErrorBoundary'
import FileReferenceCard from '../shared/FileReferenceCard'
import SelectedXlsxCard from '../shared/SelectedXlsxCard'
import SelectedFileCard from '../shared/SelectedFileCard'
import CwdIndicator from './CwdIndicator'
import QueuedMessagesStack from './QueuedMessagesStack'
import { buildSelectedXlsxXml } from '../../utils/selectedXlsx'
import { buildSelectedFileXml } from '../../utils/selectedFile'

function findNextVariable(text, fromPos) {
  const regex = /\{[^}]+\}/g
  regex.lastIndex = fromPos
  const match = regex.exec(text)
  if (match) return { start: match.index, end: match.index + match[0].length }
  regex.lastIndex = 0
  const wrapMatch = regex.exec(text)
  if (wrapMatch && wrapMatch.index < fromPos) return { start: wrapMatch.index, end: wrapMatch.index + wrapMatch[0].length }
  return null
}

export default function ChatInput({ cwd, cwdPlacement = 'top' }) {
  const { t } = useTranslation()
  const inputText = useChatStore((s) => s.inputText)
  const setInputText = useChatStore((s) => s.setInputText)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const pendingAskUser = useChatStore((s) => s.pendingAskUser)
  const pendingPermission = useChatStore((s) => s.pendingPermission)
  const pendingPlanApproval = useChatStore((s) => s.pendingPlanApproval)
  const permissionMode = useChatStore((s) => s.permissionMode)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)
  const mcpServers = useChatStore((s) => s.mcpServers)
  const setMcpServers = useChatStore((s) => s.setMcpServers)
  const mcpServerList = useMcpStore((s) => s.servers)
  const mcpServersLoading = useMcpStore((s) => s.serversLoading)
  const fetchMcpServers = useMcpStore((s) => s.fetchServers)
  const attachments = useChatStore((s) => s.attachments)
  const queuedUserMessages = useChatStore((s) => s.queuedUserMessages)
  const clearAttachments = useChatStore((s) => s.clearAttachments)
  const clearTasks = useTaskStore((s) => s.clearTasks)
  const hasRunningTasks = useTaskStore((s) => Object.values(s.tasks).some((t) => t.status === 'running'))
  const clearFileOps = useFileOpsStore((s) => s.clearFileOps)
  const clearFileBrowser = useFileBrowserStore((s) => s.clear)
  const quickActionVariableMode = useChatStore((s) => s.quickActionVariableMode)
  const setQuickActionVariableMode = useChatStore((s) => s.setQuickActionVariableMode)
  const quotedText = useChatStore((s) => s.quotedText)
  const clearQuotedText = useChatStore((s) => s.clearQuotedText)
  const fileReference = useChatStore((s) => s.fileReference)
  const clearFileReference = useChatStore((s) => s.clearFileReference)
  const selectedXlsxReference = useChatStore((s) => s.selectedXlsxReference)
  const clearSelectedXlsxReference = useChatStore((s) => s.clearSelectedXlsxReference)
  const selectedFileReference = useChatStore((s) => s.selectedFileReference)
  const clearSelectedFileReference = useChatStore((s) => s.clearSelectedFileReference)
  const { sendMessage, stopStream, sendAnswer, declineAskUser, respondPermission } = useSSE()
  const visionModel = useSettingsStore((s) => s.visionModel)
  const textareaRef = useRef(null)
  const isBlocked = !!pendingAskUser || !!pendingPermission || !!pendingPlanApproval

  const [selectedSkill, setSelectedSkill] = useState(null)
  const [showPermissionMenu, setShowPermissionMenu] = useState(false)
  const permMenuRef = useRef(null)
  // Composer-warning callback registered by PromptComposer.
  const composerWarnRef = useRef(null)

  // Bridge chatStore attachments to PromptComposer's functional setter
  const setAttachments = useCallback((updater) => {
    const current = useChatStore.getState().attachments
    const next = typeof updater === 'function' ? updater(current) : updater
    // Revoke blob URLs for removed items
    const removed = current.filter((a) => !next.find((n) => n.id === a.id))
    removed.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) })
    useChatStore.setState({ attachments: next })
  }, [])

  // Fetch MCP servers on mount
  useEffect(() => { fetchMcpServers() }, [fetchMcpServers])

  // Stopping a run is destructive — both the stop button and Escape route
  // through the same red confirm dialog; nothing insta-aborts.
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const confirmStop = useCallback(() => {
    showConfirmDialog({
      danger: true,
      title: t('confirm.stopRunTitle'),
      message: t('confirm.stopRunMessage'),
      confirmLabel: t('confirm.stopRunConfirm'),
      onConfirm: () => stopStream(),
    })
  }, [showConfirmDialog, stopStream, t])

  // Escape opens the stop confirmation while streaming. Pickers/modals that
  // consume Escape call preventDefault, so they always win over this.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape' || !isStreaming) return
      if (e.defaultPrevented) return
      e.preventDefault()
      confirmStop()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isStreaming, confirmStop])

  // Quick action variable mode: focus and select first variable
  useEffect(() => {
    if (!quickActionVariableMode) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const match = findNextVariable(inputText, 0)
    if (match) {
      requestAnimationFrame(() => { el.setSelectionRange(match.start, match.end) })
    } else {
      requestAnimationFrame(() => { el.setSelectionRange(inputText.length, inputText.length) })
    }
  }, [quickActionVariableMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle pending auto-send from Skills optimize flow
  const pendingOptimize = useChatStore((s) => s.pendingOptimize)
  const clearPendingOptimize = useChatStore((s) => s.clearPendingOptimize)
  const handleSendRef = useRef(null)
  useEffect(() => {
    if (!pendingOptimize?.autoSend) return
    clearPendingOptimize()
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => { handleSendRef.current?.() })
      raf1._inner = raf2
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf1._inner) cancelAnimationFrame(raf1._inner)
    }
  }, [pendingOptimize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close permission menu on click outside
  useEffect(() => {
    if (!showPermissionMenu) return
    const handler = (e) => {
      if (permMenuRef.current && !permMenuRef.current.contains(e.target)) {
        setShowPermissionMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPermissionMenu])

  const hasUploading = attachments.some((a) => a.status === 'uploading' || a.status === 'processing')
  const doneAttachments = attachments.filter((a) => a.status === 'done')
  const imageAttachments = doneAttachments.filter((a) => a.isImage)
  const fileAttachments = doneAttachments.filter((a) => !a.isImage)

  const handleSend = () => {
    const text = inputText.trim()
    const hasFileRef = !!useChatStore.getState().fileReference
    const hasSelectedXlsxRef = !!useChatStore.getState().selectedXlsxReference
    const hasSelectedFileRef = !!useChatStore.getState().selectedFileReference
    const hasContent = !!text || !!selectedSkill || doneAttachments.length > 0 || hasFileRef || hasSelectedXlsxRef || hasSelectedFileRef
    if (!hasContent || isBlocked || hasUploading) return
    // Running tasks only block fresh sends; mid-stream queueing is still allowed
    if (!isStreaming && hasRunningTasks) return
    const fullText = selectedSkill ? `/${selectedSkill.name} ${text}`.trim() : text
    if (!fullText && doneAttachments.length === 0) return
    setInputText('')
    setSelectedSkill(null)
    setQuickActionVariableMode(false)

    // Handle file reference: prepend XML block and use stored template
    const currentFileRef = useChatStore.getState().fileReference
    const fileRefTemplate = useChatStore.getState().fileReferenceTemplate
    let finalText = fullText
    if (currentFileRef) {
      const xmlBlock = `<file-reference path="${currentFileRef.filePath}" startLine="${currentFileRef.startLine}" endLine="${currentFileRef.endLine}" language="${currentFileRef.language || ''}">\n${currentFileRef.selectedText}\n</file-reference>`
      // Use stored template if available, otherwise build from user text
      if (fileRefTemplate) {
        finalText = xmlBlock + '\n' + fileRefTemplate
      } else {
        finalText = xmlBlock + '\n' + fullText
      }
      useChatStore.getState().clearFileReference()
      useChatStore.getState().clearFileReferenceTemplate()
    }

    const currentSelectedXlsxRef = useChatStore.getState().selectedXlsxReference
    if (currentSelectedXlsxRef) {
      const xmlBlock = buildSelectedXlsxXml(currentSelectedXlsxRef)
      finalText = finalText ? `${xmlBlock}\n${finalText}` : xmlBlock
      useChatStore.getState().clearSelectedXlsxReference()
    }

    const currentSelectedFileRef = useChatStore.getState().selectedFileReference
    if (currentSelectedFileRef) {
      const xmlBlock = buildSelectedFileXml(currentSelectedFileRef)
      finalText = finalText ? `${xmlBlock}\n${finalText}` : xmlBlock
      useChatStore.getState().clearSelectedFileReference()
    }

    const currentQuote = useChatStore.getState().quotedText
    if (currentQuote && finalText) {
      finalText = t('quote.template', { content: currentQuote, feedback: finalText })
      useChatStore.getState().clearQuotedText()
    }

    const attItems = fileAttachments.map((a) => ({ path: a.path, name: a.originalName || a.name }))
    const imageItems = imageAttachments.map((a) => ({
      data: a.base64Data, media_type: a.mediaType, filename: a.name,
    }))
    // Display metadata only — no base64Data/previewUrl. The image bytes
    // already live in the message content blocks; duplicating them here
    // pins multi-MB strings in memory for the session's lifetime.
    const attMeta = doneAttachments.map((a) => ({
      name: a.name, size: a.size, path: a.path,
      isImage: a.isImage || false, mediaType: a.mediaType,
    }))
    // Failed uploads stay visible as error chips (with a warning) so the user
    // notices they were NOT sent; sending itself is not blocked.
    const hasErrorAtts = attachments.some((a) => a.status === 'error')
    if (hasErrorAtts) {
      composerWarnRef.current?.(t('chat.failedAttachmentsKept'))
      clearAttachments({ keepErrors: true })
    } else {
      clearAttachments()
    }

    const messageToSend = finalText || (imageItems.length > 0 ? 'Describe the uploaded image(s).' : 'Please read the uploaded files.')

    if (isStreaming) {
      // Mid-stream: queue for injection at next tool-result boundary
      const queueSender = useChatStore.getState().queueSender
      if (!queueSender?.sendQueue) return
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      queueSender.sendQueue({
        id,
        text: messageToSend,
        attachments: attItems.length > 0 ? attItems : undefined,
        images: imageItems.length > 0 ? imageItems : undefined,
      })
      useChatStore.getState().enqueueUserMessage({
        id,
        text: messageToSend,
        attachments: attItems,
        images: imageItems,
        attachmentsMeta: attMeta,
      })
      return
    }

    sendMessage(
      messageToSend,
      permissionMode,
      attItems.length > 0 ? attItems : undefined,
      attMeta.length > 0 ? attMeta : undefined,
      imageItems.length > 0 ? imageItems : undefined,
    )
  }
  handleSendRef.current = handleSend

  // Chat-specific keydown: quote backspace, quick-action-variable Tab/Escape, Enter-to-send
  const handleKeyDown = (e) => {
    if (quickActionVariableMode) {
      if (e.key === 'Tab') {
        e.preventDefault()
        const el = textareaRef.current
        if (!el) return
        const curPos = el.selectionEnd
        const match = findNextVariable(inputText, curPos)
        if (match) {
          el.setSelectionRange(match.start, match.end)
        } else {
          setQuickActionVariableMode(false)
          el.setSelectionRange(inputText.length, inputText.length)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuickActionVariableMode(false)
        setInputText('')
        return
      }
    }
    // Backspace on empty: clear fileReference or quote first (before PromptComposer handles skill/attachments)
    if (e.key === 'Backspace' && !inputText) {
      const selectedFile = useChatStore.getState().selectedFileReference
      if (selectedFile) {
        e.preventDefault()
        clearSelectedFileReference()
        return
      }
      const selectedXlsx = useChatStore.getState().selectedXlsxReference
      if (selectedXlsx) {
        e.preventDefault()
        clearSelectedXlsxReference()
        return
      }
      const fr = useChatStore.getState().fileReference
      if (fr) {
        e.preventDefault()
        clearFileReference()
        return
      }
      const q = useChatStore.getState().quotedText
      if (q) {
        e.preventDefault()
        clearQuotedText()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleDecline = () => {
    declineAskUser()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const hasContentToSend = !!inputText.trim() || !!selectedSkill || doneAttachments.length > 0 || !!fileReference || !!selectedXlsxReference || !!selectedFileReference
  const canSendIdle = hasContentToSend && !isStreaming && !isBlocked && !hasUploading && !hasRunningTasks
  const canQueue = hasContentToSend && isStreaming && !isBlocked && !hasUploading
  const canSend = canSendIdle || canQueue

  const handlePlanApproval = (option, feedbackText) => {
    const { requestId, planContent, planFilePath } = pendingPlanApproval
    respondPermission(requestId, 'allow')
    useChatStore.getState().clearPendingPlanApproval()

    if (option === 'feedback') {
      const feedback = `Plan feedback:\n${feedbackText}`
      sendMessage(feedback, permissionMode)
      return
    }

    const template = [
      'User has approved your plan. You can now start coding. Start with updating your todo list if applicable',
      '',
      planFilePath ? `Your plan has been saved to: ${planFilePath}` : '',
      planFilePath ? 'You can refer back to it if needed during implementation.' : '',
      '---',
      planContent || '',
      '---',
    ].filter((line) => line !== '' || true).join('\n')

    if (option === 'newSessionAutoEdits') {
      clearMessages()
      clearTasks()
      clearFileOps()
      clearFileBrowser()
      setPermissionMode('acceptEdits')
      setTimeout(() => { sendMessage(template, 'acceptEdits') }, 50)
    } else if (option === 'sameSessionAutoEdits') {
      setPermissionMode('acceptEdits')
      sendMessage(template, 'acceptEdits')
    } else if (option === 'sameSessionManual') {
      setPermissionMode('default')
      sendMessage(template, 'default')
    }
  }

  const PERMISSION_MODES = [
    { value: 'bypassPermissions', label: t('permission.bypass'), desc: t('permission.bypassDesc'), color: 'var(--yellow)' },
    { value: 'default', label: t('permission.default'), desc: t('permission.defaultDesc'), color: 'var(--green)' },
    { value: 'acceptEdits', label: t('permission.acceptEdits'), desc: t('permission.acceptEditsDesc'), color: 'var(--purple)' },
    { value: 'plan', label: t('permission.plan'), desc: t('permission.planDesc'), color: 'var(--cyan)' },
  ]

  // File reference card rendered before the textarea inside PromptComposer
  const fileRefCard = fileReference ? (
    <div className="px-3 pt-3 pb-0">
      <FileReferenceCard
        filePath={fileReference.filePath}
        startLine={fileReference.startLine}
        endLine={fileReference.endLine}
        selectedText={fileReference.selectedText}
        language={fileReference.language}
        onDismiss={clearFileReference}
      />
    </div>
  ) : null

  const selectedXlsxCard = selectedXlsxReference ? (
    <div className="px-3 pt-3 pb-0">
      <SelectedXlsxCard
        filePath={selectedXlsxReference.filePath}
        sheetName={selectedXlsxReference.sheetName}
        range={selectedXlsxReference.range}
        contentTsv={selectedXlsxReference.contentTsv}
        onDismiss={clearSelectedXlsxReference}
      />
    </div>
  ) : null

  const selectedFileCard = selectedFileReference ? (
    <div className="px-3 pt-3 pb-0">
      <SelectedFileCard
        kind={selectedFileReference.kind}
        filePath={selectedFileReference.filePath}
        fileName={selectedFileReference.fileName}
        locator={selectedFileReference.locator}
        content={selectedFileReference.content}
        onDismiss={clearSelectedFileReference}
      />
    </div>
  ) : null

  // Quote badge rendered before the textarea inside PromptComposer
  const quoteBadge = quotedText ? (
    <div className="flex items-center gap-2 px-3 pt-3 pb-0">
      <div className="flex items-center gap-2 px-2 py-1" style={{
        background: 'var(--bg-surface)',
        borderLeft: '2px solid var(--blue)',
        borderRadius: 2,
        maxWidth: '100%',
        minWidth: 0,
      }}>
        <CornerDownLeft size={12} strokeWidth={1.5} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="uppercase" style={{
          color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600, flexShrink: 0,
        }}>
          {t('quote.quoted')}
        </span>
        <span className="truncate" style={{
          color: 'var(--text-secondary)', fontSize: 12, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        }}>
          &ldquo;{quotedText.length > 60 ? quotedText.slice(0, 60) + '...' : quotedText}&rdquo;
        </span>
        <button
          className="flex items-center justify-center flex-shrink-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, marginLeft: 2, transition: 'color 150ms ease' }}
          onClick={clearQuotedText}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  ) : null

  // Vision model hint banners rendered after image thumbnails
  const hasImages = attachments.some((a) => a.isImage)
  const visionHints = hasImages ? (
    <>
      {!visionModel && (
        <div className="flex items-center gap-2 px-3 py-1 mx-3 mt-1"
          style={{ background: 'var(--bg-elevated)', borderLeft: '2px solid var(--yellow)', borderRadius: 2, fontSize: 11, color: 'var(--text-dim)', userSelect: 'none' }}>
          <AlertTriangle size={12} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
          {t('chat.noVisionModel')}
        </div>
      )}
      {visionModel && (
        <div className="flex items-center gap-2 px-3 py-1 mx-3 mt-1"
          style={{ background: 'var(--bg-elevated)', borderLeft: '2px solid var(--cyan)', borderRadius: 2, fontSize: 11, color: 'var(--text-dim)', userSelect: 'none' }}>
          <Cpu size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          {t('chat.usingVisionModel', { model: visionModel })}
        </div>
      )}
    </>
  ) : null

  // MCP submenu inside the + dropdown
  const mcpMenuContent = (
    <McpSubMenu
      mcpServers={mcpServers}
      setMcpServers={setMcpServers}
      serverList={mcpServerList}
      loading={mcpServersLoading}
      t={t}
    />
  )

  // Permission mode button (toolbar left, after + button)
  const toolbarLeftContent = (
    <div className="relative" ref={permMenuRef}>
      <button
        className="flex items-center gap-1 px-2"
        style={{
          height: 28,
          background: 'transparent', border: 'none', borderRadius: '4px',
          cursor: isStreaming ? 'not-allowed' : 'pointer',
          color: PERMISSION_MODES.find((m) => m.value === permissionMode)?.color || 'var(--text-dim)',
          fontSize: 12, fontWeight: 600,
          opacity: isStreaming ? 0.5 : 1,
          transition: 'color 150ms ease, background 150ms ease',
        }}
        onMouseEnter={(e) => { if (!isStreaming) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        onClick={(e) => {
          e.stopPropagation()
          if (!isStreaming) setShowPermissionMenu(!showPermissionMenu)
        }}
      >
        <Shield size={12} strokeWidth={1.5} />
        <span>{PERMISSION_MODES.find((m) => m.value === permissionMode)?.label}</span>
      </button>

      {showPermissionMenu && (
        <div
          className="absolute"
          style={{
            bottom: '100%', left: 0, marginBottom: 4,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, minWidth: 200, zIndex: 20, padding: '4px 0',
          }}
        >
          {PERMISSION_MODES.map((mode) => {
            const isActive = permissionMode === mode.value
            return (
              <button
                key={mode.value}
                className="flex flex-col gap-0 px-3 py-2 w-full"
                style={{
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? `2px solid ${mode.color}` : '2px solid transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'background 150ms ease',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = isActive ? 'var(--bg-surface)' : 'transparent' }}
                onClick={() => {
                  setPermissionMode(mode.value)
                  setShowPermissionMenu(false)
                }}
              >
                <span style={{ color: isActive ? mode.color : 'var(--text-secondary)', fontSize: 13, fontWeight: isActive ? 600 : 400 }}>
                  {mode.label}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  {mode.desc}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  // Model selector + send/stop buttons (toolbar right)
  const sendBtnBg = canQueue ? 'var(--yellow)' : 'var(--blue)'
  const toolbarRightContent = (
    <>
      <ModelSelector />
      {isStreaming && (
        <button
          className="flex items-center justify-center"
          style={{
            width: 28, height: 28,
            background: 'var(--red)', border: 'none', borderRadius: '4px',
            cursor: 'pointer', color: 'var(--text-inverse)', transition: 'opacity 150ms ease',
          }}
          onClick={confirmStop}
          title={t('chat.stopEscape')}
        >
          <Square size={14} strokeWidth={1.5} />
        </button>
      )}
      {canSend && (
        <button
          className="flex items-center justify-center"
          style={{
            width: 28, height: 28,
            background: sendBtnBg, border: 'none', borderRadius: '4px',
            cursor: 'pointer', color: 'var(--text-inverse)',
            transition: 'background 150ms ease, color 150ms ease',
          }}
          onClick={handleSend}
          title={canQueue ? t('chat.queueForBoundary') : t('chat.send')}
        >
          <Send size={14} strokeWidth={1.5} />
        </button>
      )}
      {/* Running tasks block fresh sends — keep the button visible but inert
          so the user understands why nothing happens. */}
      {!canSend && hasContentToSend && !isStreaming && hasRunningTasks && (
        <button
          className="flex items-center justify-center"
          disabled
          style={{
            width: 28, height: 28,
            background: 'var(--bg-elevated)', border: 'none', borderRadius: '4px',
            cursor: 'not-allowed', color: 'var(--text-dim)',
          }}
          title={t('chat.waitForTasks')}
        >
          <Send size={14} strokeWidth={1.5} />
        </button>
      )}
    </>
  )

  return (
    <div
      className="flex-shrink-0 pt-3 pb-3"
      style={{ background: 'var(--bg-base)' }}
    >
      <div style={{ maxWidth: 900, width: '80%', margin: '0 auto' }}>
        {cwdPlacement === 'top' && cwd && (
          <div className="min-w-0" style={{ marginBottom: 8 }}>
            <div className="min-w-0" style={{ maxWidth: '100%' }}>
              <CwdIndicator cwd={cwd} />
            </div>
          </div>
        )}

        {queuedUserMessages.length > 0 && (
          <QueuedMessagesStack
            entries={queuedUserMessages}
            style={{ marginBottom: 8 }}
          />
        )}

        {pendingPlanApproval ? (
          <ErrorBoundary compact resetKey={pendingPlanApproval.requestId}>
            <PlanApprovalCard approval={pendingPlanApproval} onApprove={handlePlanApproval} />
          </ErrorBoundary>
        ) : pendingPermission ? (
          <ErrorBoundary compact resetKey={pendingPermission.requestId}>
            <PermissionRequestCard block={pendingPermission} onRespond={respondPermission} />
          </ErrorBoundary>
        ) : pendingAskUser ? (
          <ErrorBoundary compact resetKey={pendingAskUser.toolUseId}>
            <AskUserQuestionCard block={pendingAskUser} onAnswer={sendAnswer} onSkip={handleDecline} />
          </ErrorBoundary>
        ) : (
          <PromptComposer
            value={inputText}
            onChange={setInputText}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            skill={selectedSkill}
            onSkillChange={setSelectedSkill}
            placeholder={t('chat.placeholder')}
            minHeight={62}
            onKeyDown={handleKeyDown}
            textareaRef={textareaRef}
            toolbarLeft={toolbarLeftContent}
            toolbarRight={toolbarRightContent}
            plusMenuExtra={mcpMenuContent}
            beforeTextarea={<>{selectedFileCard}{selectedXlsxCard}{fileRefCard}{quoteBadge}</>}
            afterImages={visionHints}
            currentDirectory={cwd}
            onRegisterWarn={(fn) => { composerWarnRef.current = fn }}
          />
        )}

        {cwdPlacement === 'below' && cwd && (
          <div className="min-w-0" style={{ marginTop: 8 }}>
            <CwdIndicator cwd={cwd} />
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, fontWeight: 400, paddingTop: 4 }}>
        {t('chat.disclaimer')}
      </div>
    </div>
  )
}

function McpSubMenu({ mcpServers, setMcpServers, serverList, loading, t }) {
  const [showSub, setShowSub] = useState(false)
  const hoverTimeout = useRef(null)

  const isAuto = mcpServers === 'auto'
  const isDisabled = mcpServers === 'disable'
  const isCustom = Array.isArray(mcpServers)
  const selectedNames = isCustom ? mcpServers : []
  const serverCount = serverList?.length || 0
  const allServerNames = (serverList || []).map((srv) => srv.name)

  const statusColor = isAuto ? 'var(--green)' : isDisabled ? 'var(--red)' : 'var(--cyan)'

  const enter = () => { clearTimeout(hoverTimeout.current); setShowSub(true) }
  const leave = () => { hoverTimeout.current = setTimeout(() => setShowSub(false), 220) }

  useEffect(() => () => clearTimeout(hoverTimeout.current), [])

  const toggleServer = (name) => {
    const current = isAuto ? allServerNames : Array.isArray(mcpServers) ? [...mcpServers] : []
    const idx = current.indexOf(name)
    if (idx >= 0) {
      current.splice(idx, 1)
      setMcpServers(current.length > 0 ? current : 'disable')
    } else {
      current.push(name)
      setMcpServers(current)
    }
  }

  return (
    <div
      className="relative"
      style={{ borderTop: '1px solid var(--border-subtle)' }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-2 w-full text-sm"
        style={{
          background: showSub ? 'var(--bg-surface)' : 'transparent',
          border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', textAlign: 'left',
          fontFamily: "'Noto Sans', sans-serif", fontSize: 13,
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
        onMouseLeave={(e) => { if (!showSub) e.currentTarget.style.background = 'transparent' }}
        onClick={(e) => {
          e.stopPropagation()
          enter()
        }}
      >
        <Cable size={14} strokeWidth={1.5} style={{ color: statusColor }} />
        <span className="flex-1">MCP</span>
        <ChevronRight size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
      </button>

      {showSub && (
        <div
          style={{
            position: 'absolute', left: '100%', bottom: 0,
            marginLeft: 0,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, minWidth: 220, zIndex: 30,
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          <div className="flex items-center gap-1 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {[
              { value: 'auto', label: t('mcp.policyAuto'), color: 'var(--green)' },
              { value: 'disable', label: t('mcp.policyDisable'), color: 'var(--red)' },
            ].map((mode) => {
              const active = (mode.value === 'auto' && isAuto) || (mode.value === 'disable' && isDisabled)
              return (
                <button
                  type="button"
                  key={mode.value}
                  className="px-2 py-0 text-xs"
                  style={{
                    background: active ? 'var(--bg-surface)' : 'transparent',
                    border: active ? `1px solid ${mode.color}` : '1px solid transparent',
                    borderRadius: 4, color: active ? mode.color : 'var(--text-dim)',
                    cursor: 'pointer', fontWeight: active ? 700 : 500,
                    fontSize: 11, lineHeight: '20px', transition: 'all 150ms ease',
                  }}
                  onClick={(e) => { e.stopPropagation(); setMcpServers(mode.value) }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = mode.color }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-dim)' }}
                >
                  {mode.label}
                </button>
              )
            })}
            {isCustom && (
              <span style={{ color: 'var(--cyan)', fontSize: 10, fontWeight: 600, marginLeft: 'auto' }}>
                {selectedNames.length}/{serverCount}
              </span>
            )}
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 0' }}>
            {loading ? (
              <div className="px-3 py-2" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                {t('sidebar.loading')}
              </div>
            ) : serverList.length === 0 ? (
              <div className="px-3 py-2" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                {t('mcp.noServers')}
              </div>
            ) : serverList.map((srv) => {
              const checked = isAuto || selectedNames.includes(srv.name)
              return (
                <button
                  type="button"
                  key={srv.name}
                  className="flex items-center gap-2 w-full px-3 py-1"
                  style={{
                    background: 'transparent', border: 'none',
                    cursor: 'pointer',
                    color: checked ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12, textAlign: 'left', transition: 'background 150ms ease',
                    opacity: isDisabled ? 0.4 : 1,
                  }}
                  onClick={(e) => { e.stopPropagation(); toggleServer(srv.name) }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 2, flexShrink: 0,
                    border: checked ? '1px solid var(--cyan)' : '1px solid var(--border)',
                    background: checked ? 'var(--cyan)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 150ms ease',
                  }}>
                    {checked && <span style={{ color: 'var(--text-inverse)', fontSize: 10, fontWeight: 700 }}>&#10003;</span>}
                  </span>
                  <span className="truncate flex-1">{srv.name}</span>
                  <span className="uppercase flex-shrink-0" style={{
                    fontSize: 9, color: srv.type === 'http' ? 'var(--cyan)' : 'var(--purple)',
                    letterSpacing: '0.06em',
                  }}>
                    {srv.type}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
