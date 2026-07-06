import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useUiStore from '../../stores/uiStore'
import useSidebarStore from '../../stores/sidebarStore'
import useTaskStore from '../../stores/taskStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import MessageBubble from './MessageBubble'
import CompactBoundary from './CompactBoundary'
import JumpToLatest from './JumpToLatest'
import { useSSE } from '../../hooks/useSSE'
import { rewindFiles, forkSession, fetchSessionMessages } from '../../api/sessions'
import { hasCanvasInspectorItems, transformSessionMessages } from '../../utils/sessionTransform'

export default function MessageList() {
  const { t } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const sessionId = useChatStore((s) => s.sessionId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const enableFileCheckpointing = useChatStore((s) => s.enableFileCheckpointing)
  const loadSession = useChatStore((s) => s.loadSession)
  const findCheckpointForAssistant = useChatStore((s) => s.findCheckpointForAssistant)
  const rewindMarker = useChatStore((s) => s.rewindMarker)
  const setRewindMarker = useChatStore((s) => s.setRewindMarker)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const refreshSessions = useSidebarStore((s) => s.fetchSessions)
  const setActiveSessionId = useSidebarStore((s) => s.setActiveSessionId)
  const clearTasks = useTaskStore((s) => s.clearTasks)
  const { sendAnswer } = useSSE()
  const bottomRef = useRef(null)
  const containerRef = useRef(null)
  const mountedCountRef = useRef(messages.length)
  const lastSessionRef = useRef(sessionId)
  const isNearBottomRef = useRef(true)
  const scrollFrameRef = useRef(null)

  // Reset mounted count when conversation changes
  if (sessionId !== lastSessionRef.current) {
    lastSessionRef.current = sessionId
    mountedCountRef.current = messages.length
  }
  const [showJump, setShowJump] = useState(false)

  const prefersReducedMotion = useCallback(() => (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ), [])

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = containerRef.current
    const requestedBehavior = behavior === 'auto' || behavior === 'smooth' ? behavior : 'smooth'
    const resolvedBehavior = prefersReducedMotion() ? 'auto' : requestedBehavior
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: resolvedBehavior })
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: resolvedBehavior })
  }, [prefersReducedMotion])

  const scheduleScrollToBottom = useCallback((behavior = 'smooth') => {
    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scrollToBottom(behavior)
    })
  }, [scrollToBottom])

  // Auto-scroll only while the viewer is already near the live edge. During
  // streaming we pin instantly to avoid repeated smooth-scroll animations.
  useEffect(() => {
    if (!isNearBottomRef.current) return
    scheduleScrollToBottom(isStreaming ? 'auto' : 'smooth')
  }, [messages, isStreaming, scheduleScrollToBottom])

  useEffect(() => () => {
    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const threshold = 80
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
      isNearBottomRef.current = isNearBottom
      setShowJump(!isNearBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const handleRewind = useCallback(async (idx) => {
    const uuid = findCheckpointForAssistant(idx)
    if (!uuid) {
      showConfirmDialog({
        title: t('confirm.noCheckpointTitle'),
        message: t('confirm.noCheckpointMessage'),
        confirmLabel: t('confirm.ok'),
      })
      return
    }
    if (!sessionId) return
    showConfirmDialog({
      title: t('confirm.rewindTitle'),
      message: t('confirm.rewindMessage'),
      requireText: 'rewind',
      danger: true,
      confirmLabel: t('confirm.rewindConfirm'),
      onConfirm: async () => {
        try {
          await rewindFiles(sessionId, uuid)
          const msgs = useChatStore.getState().messages
          const targetIdx = msgs.findIndex((m) => m.uuid === uuid)
          const revertedIds = []
          if (targetIdx >= 0) {
            const fileWriters = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
            for (let i = targetIdx; i < msgs.length; i++) {
              const content = msgs[i]?.content
              if (!Array.isArray(content)) continue
              for (const block of content) {
                if (block?.type === 'tool_use' && fileWriters.has(block.name) && block.id) {
                  revertedIds.push(block.id)
                } else if (block?.type === 'file_ref' && block.fileOpId) {
                  revertedIds.push(block.fileOpId)
                }
              }
            }
          }
          setRewindMarker({
            checkpointUuid: uuid,
            rewindTs: Date.now(),
            revertedToolUseIds: Array.from(new Set(revertedIds)),
          })
        } catch (e) {
          showConfirmDialog({
            title: t('confirm.rewindFailed'),
            message: String(e?.message || e),
            confirmLabel: t('confirm.ok'),
          })
        }
      },
    })
  }, [findCheckpointForAssistant, sessionId, showConfirmDialog, setRewindMarker])

  const handleFork = useCallback(async (idx) => {
    if (!sessionId) return
    const assistantMsg = messages[idx]
    // Best-effort: fork up to the user message preceding this assistant message
    const targetUuid = findCheckpointForAssistant(idx) || assistantMsg?.uuid || null
    showConfirmDialog({
      title: t('confirm.forkTitle'),
      message: t('confirm.forkMessage'),
      confirmLabel: t('confirm.forkConfirm'),
      onConfirm: async () => {
        try {
          const { new_session_id } = await forkSession(sessionId, targetUuid)
          const { messages: forkedMsgs } = await fetchSessionMessages(new_session_id)
          const { messages: parsed, fileOps, fileBrowserTabs, tasks, subagentContent } = transformSessionMessages(forkedMsgs || [])
          clearTasks()
          useFileOpsStore.getState().clearFileOps()
          useFileBrowserStore.getState().clear()
          useUiStore.getState().clearPlanContent()
          loadSession(new_session_id, parsed, sessionId, subagentContent)
          setActiveSessionId(new_session_id)
          const fileOpsStore = useFileOpsStore.getState()
          for (const op of fileOps) fileOpsStore.addFileOp(op)
          useFileBrowserStore.getState().setTabs(fileBrowserTabs)
          const taskStore = useTaskStore.getState()
          for (const task of tasks) taskStore.addTask(task)
          const hasInspectorItems = hasCanvasInspectorItems(parsed)
          const canvasTab = fileBrowserTabs.length > 0
            ? 'file-browser'
            : fileOps.length > 0
              ? 'changes'
              : hasInspectorItems
                ? 'tasks'
                : null
          if (canvasTab) {
            const ui = useUiStore.getState()
            ui.showCanvas()
            ui.setActiveCanvasTab(canvasTab)
          } else {
            useUiStore.getState().hideCanvas()
          }
          refreshSessions()
          setTimeout(() => document.querySelector('.chat-textarea')?.focus(), 0)
        } catch (e) {
          showConfirmDialog({
            title: t('confirm.forkFailed'),
            message: String(e?.message || e),
            confirmLabel: t('confirm.ok'),
          })
        }
      },
    })
  }, [sessionId, messages, findCheckpointForAssistant, loadSession, clearTasks, refreshSessions, setActiveSessionId, showConfirmDialog])

  const revertedIdSet = useMemo(
    () => new Set(rewindMarker?.revertedToolUseIds || []),
    [rewindMarker]
  )

  // Empty state handled by ChatPanel
  if (messages.length === 0) return null

  // Separate system compact messages from chat messages to keep stable indices for MessageBubble
  const chatMessages = []
  const compactInserts = [] // { beforeIndex, msg }
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system' && messages[i].type === 'compact') {
      compactInserts.push({ beforeIndex: chatMessages.length, msg: messages[i] })
    } else {
      chatMessages.push({ msg: messages[i], originalIndex: i })
    }
  }

  const lastAssistantIndex = [...chatMessages].reverse().findIndex((e) => e.msg.role === 'assistant')
  const latestAssistantChatIndex = lastAssistantIndex === -1
    ? -1
    : chatMessages.length - 1 - lastAssistantIndex

  // Build render list: interleave compact boundaries at correct positions
  const renderItems = []
  let compactPtr = 0
  for (let ci = 0; ci <= chatMessages.length; ci++) {
    while (compactPtr < compactInserts.length && compactInserts[compactPtr].beforeIndex === ci) {
      renderItems.push({ type: 'compact', msg: compactInserts[compactPtr].msg })
      compactPtr++
    }
    if (ci < chatMessages.length) {
      const entry = chatMessages[ci]
      if (rewindMarker && entry.msg.uuid && entry.msg.uuid === rewindMarker.checkpointUuid) {
        renderItems.push({ type: 'rewind_divider', rewindTs: rewindMarker.rewindTs })
      }
      renderItems.push({
        type: 'chat',
        msg: entry.msg,
        chatIndex: ci,
        originalIndex: entry.originalIndex,
        isLastAssistant: isStreaming && entry.msg.role === 'assistant' && ci === chatMessages.length - 1,
        isLatestAssistantMessage: entry.msg.role === 'assistant' && ci === latestAssistantChatIndex,
      })
    }
  }

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
      >
        <div
          className="overflow-hidden"
          style={{
            maxWidth: 900,
            width: '80%',
            margin: '0 auto',
            paddingTop: 24,
          }}
        >
          {renderItems.map((item, i) => {
            if (item.type === 'compact') {
              return (
                <div key={`compact-${item.msg.timestamp}`} className="overflow-hidden chat-message-in">
                  <CompactBoundary message={item.msg} />
                </div>
              )
            }

            if (item.type === 'rewind_divider') {
              return (
                <RewindDivider key={`rewind-${item.rewindTs}`} rewindTs={item.rewindTs} />
              )
            }

            const animClass = item.originalIndex >= mountedCountRef.current ? ' chat-message-in' : ' content-auto'
            return (
              <div key={item.msg._cid || `idx-${item.chatIndex}`} className={`overflow-hidden${animClass}`}>
                <MessageBubble
                  message={item.msg}
                  isStreaming={item.isLastAssistant}
                  isLatestAssistantMessage={item.isLatestAssistantMessage}
                  latestAssistantRefreshKey={messages.length}
                  onSendAnswer={sendAnswer}
                  assistantIndex={item.originalIndex}
                  onRewind={handleRewind}
                  onFork={handleFork}
                  showCheckpointActions={enableFileCheckpointing && !!sessionId}
                  revertedToolUseIds={revertedIdSet}
                />
              </div>
            )
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Jump to latest */}
      {showJump && (
        <JumpToLatest
          onClick={() => scrollToBottom('smooth')}
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
          }}
        />
      )}

    </div>
  )
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function RewindDivider({ rewindTs }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 my-2 px-4">
      <div className="flex-1" style={{ borderTop: '1px dashed var(--border-strong)' }} />
      <span
        className="text-xs font-bold uppercase flex items-center gap-1"
        style={{ color: 'var(--purple)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}
      >
        <RotateCcw size={12} strokeWidth={1.5} />
        {t('rewind.divider', { time: fmtTime(rewindTs) })}
      </span>
      <div className="flex-1" style={{ borderTop: '1px dashed var(--border-strong)' }} />
    </div>
  )
}
