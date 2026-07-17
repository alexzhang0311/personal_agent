import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { PlusCircle, MessageSquare, PanelLeftClose, PanelLeft, Trash2, ChevronDown, MoreHorizontal, RefreshCw, Settings, Search, X, Pencil, Flag, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useChatStore from '../../stores/chatStore'
import useTaskStore from '../../stores/taskStore'
import useUiStore from '../../stores/uiStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import useToastStore from '../../stores/toastStore'
import {
  fetchSessionMessages,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
  tagSession as apiTagSession,
} from '../../api/sessions'
import { UnauthorizedError } from '../../api/client'
import { hasCanvasInspectorItems, transformSessionMessages } from '../../utils/sessionTransform'
import { useSSE } from '../../hooks/useSSE'
import SidebarResizer from './SidebarResizer'
import SettingsPopover from '../settings/SettingsPopover'
import CopyButton from '../shared/CopyButton'
import TagFilterChip from '../shared/TagFilterChip'
import safeStorage from '../../utils/safeStorage'

const chatDraftCache = new Map()

function saveChatDraft(chatId) {
  if (!chatId) return
  const chat = useChatStore.getState()
  chatDraftCache.set(chatId, {
    inputText: chat.inputText,
    attachments: chat.attachments,
    quotedText: chat.quotedText,
    fileReference: chat.fileReference,
    fileReferenceTemplate: chat.fileReferenceTemplate,
    selectedXlsxReference: chat.selectedXlsxReference,
    selectedFileReference: chat.selectedFileReference,
  })
}

function SessionItem({
  session, isActive, openMenuId, menuRef, onSelect, onMenuToggle,
  onDelete, onRenameStart, onTagStart, renameEditingId,
  onRenameCommit, onRenameCancel, t,
}) {
  const [renameValue, setRenameValue] = useState(session.name || '')
  useEffect(() => {
    if (renameEditingId === session.id) setRenameValue(session.name || '')
  }, [renameEditingId, session.id, session.name])
  const editing = renameEditingId === session.id
  const isProject = session.sessionSource === 'project'
  const statusLabel = session.runStatus === 'waiting_user'
    ? 'ACTION'
    : session.runStatus === 'running'
      ? 'RUNNING'
      : null
  const statusBorder = session.runStatus === 'waiting_user'
    ? 'var(--status-pending)'
    : session.runStatus === 'running'
      ? 'var(--status-running)'
      : isActive
        ? 'var(--blue)'
        : 'transparent'
  const menuItemStyle = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    transition: 'background 150ms ease',
  }

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 group"
      style={{
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: `2px solid ${statusBorder}`,
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: editing ? 'default' : 'pointer',
        fontSize: 13,
        transition: 'background 150ms ease',
      }}
      onClick={() => { if (!editing) onSelect(session) }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <MessageSquare size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
        {editing ? (
          <input
            type="text"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onRenameCommit(session, renameValue)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onRenameCancel()
              }
            }}
            onBlur={() => onRenameCommit(session, renameValue)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              outline: 'none',
              fontSize: 13,
              padding: '2px 4px',
            }}
          />
        ) : (
          <span className="flex-1 truncate" style={{ minWidth: 0 }}>{session.name}</span>
        )}
        {session.forkCount > 0 && !editing && (
          <span
            className="inline-flex items-center gap-1"
            style={{
              color: 'var(--cyan)',
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
            title={`${session.forkCount} fork${session.forkCount === 1 ? '' : 's'}`}
          >
            <GitBranch size={11} strokeWidth={1.5} />
            {session.forkCount}
          </span>
        )}
        {statusLabel && !editing && (
          <span
            className="uppercase"
            style={{
              color: session.runStatus === 'waiting_user' ? 'var(--yellow)' : 'var(--purple)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              flexShrink: 0,
            }}
          >
            {statusLabel}
          </span>
        )}
        {isProject && !editing && (
          <div className="relative" ref={openMenuId === session.id ? menuRef : undefined}>
            <button
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                padding: 2,
                opacity: openMenuId === session.id ? 1 : 0,
                transition: 'opacity 150ms ease, color 150ms ease',
              }}
              className="group-hover-visible"
              onClick={(e) => {
                e.stopPropagation()
                onMenuToggle(openMenuId === session.id ? null : session.id)
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                if (openMenuId !== session.id) {
                  e.currentTarget.style.color = 'var(--text-dim)'
                }
              }}
            >
              <MoreHorizontal size={13} strokeWidth={1.5} />
            </button>
            {openMenuId === session.id && (
              <div
                className="absolute"
                style={{
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  zIndex: 50,
                  minWidth: 140,
                  overflow: 'hidden',
                }}
              >
                <button
                  className="flex items-center gap-2 px-3 py-2 w-full"
                  style={{ ...menuItemStyle, color: 'var(--text-primary)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMenuToggle(null)
                    onRenameStart(session)
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Pencil size={13} strokeWidth={1.5} />
                  {t('sidebar.rename')}
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 w-full"
                  style={{ ...menuItemStyle, color: 'var(--text-primary)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMenuToggle(null)
                    onTagStart(session, e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Flag size={13} strokeWidth={1.5} />
                  {session.tag ? t('sidebar.changeTag') : t('sidebar.setTag')}
                </button>
                <div style={{ height: 1, background: 'var(--border-subtle)' }} />
                <button
                  className="flex items-center gap-2 px-3 py-2 w-full"
                  style={{ ...menuItemStyle, color: 'var(--red)' }}
                  onClick={(e) => {
                    onMenuToggle(null)
                    onDelete(e, session)
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  {t('sidebar.delete')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {session.tag && !editing && (
        <div className="flex items-center gap-1" style={{ paddingLeft: 19 }}>
          <span
            className="inline-flex items-center gap-1 px-2 uppercase"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderLeft: '2px solid var(--orange)',
              borderRadius: 2,
              color: 'var(--text-dim)',
              fontSize: 10,
              letterSpacing: '0.06em',
              fontWeight: 600,
              padding: '1px 6px',
              maxWidth: '100%',
            }}
            title={session.tag}
          >
            <Flag size={10} strokeWidth={1.5} style={{ color: 'var(--orange)', flexShrink: 0 }} />
            <span className="truncate">{session.tag}</span>
          </span>
        </div>
      )}
    </div>
  )
}

function TagPopover({ session, onClose, recentTags, onSaved }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(session.tag || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const commit = async (nextTag) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await apiTagSession(session.sessionId || session.id, nextTag || null)
      onSaved(session, nextTag || null)
      onClose()
    } catch (e) {
      setError(String(e?.message || e))
      setSaving(false)
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        zIndex: 60,
        minWidth: 240,
        maxWidth: 'calc(100vw - 24px)',
        padding: 10,
      }}
    >
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('sidebar.tagPlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(value.trim()) }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        style={{
          width: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          color: 'var(--text-primary)',
          padding: '4px 6px',
          fontSize: 12,
          outline: 'none',
          marginBottom: 6,
        }}
      />
      {recentTags.length > 0 && (
        <div className="flex flex-wrap gap-1" style={{ marginBottom: 6 }}>
          {recentTags.slice(0, 6).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setValue(t)}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
                padding: '1px 6px',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 6 }}>{error}</div>
      )}
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() => commit('')}
          disabled={saving}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 2,
            color: 'var(--text-secondary)',
            cursor: saving ? 'default' : 'pointer',
            fontSize: 11,
            padding: '2px 8px',
          }}
        >
          {t('sidebar.tagClear')}
        </button>
        <button
          type="button"
          onClick={() => commit(value.trim())}
          disabled={saving}
          style={{
            background: 'var(--blue)',
            border: 'none',
            borderRadius: 2,
            color: 'var(--text-inverse)',
            cursor: saving ? 'default' : 'pointer',
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 10px',
          }}
        >
          {t('sidebar.tagSave')}
        </button>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { t } = useTranslation()
  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const sessions = useSidebarStore((s) => s.sessions)
  const activeSessionId = useSidebarStore((s) => s.activeSessionId)
  const setActiveSessionId = useSidebarStore((s) => s.setActiveSessionId)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const fetchSessions = useSidebarStore((s) => s.fetchSessions)
  const fetchMoreSessions = useSidebarStore((s) => s.fetchMoreSessions)
  const sessionsHasMore = useSidebarStore((s) => s.sessionsHasMore)
  const sessionsLoading = useSidebarStore((s) => s.sessionsLoading)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const loadSession = useChatStore((s) => s.loadSession)
  const currentSessionId = useChatStore((s) => s.sessionId)
  const clearTasks = useTaskStore((s) => s.clearTasks)
  const clearFileOps = useFileOpsStore((s) => s.clearFileOps)
  const clearFileBrowser = useFileBrowserStore((s) => s.clear)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)
  const clearPlanContent = useUiStore((s) => s.clearPlanContent)
  const hideCanvas = useUiStore((s) => s.hideCanvas)
  const { resumeRun } = useSSE()
  const listRef = useRef(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const menuRef = useRef(null)
  const [renameEditingId, setRenameEditingId] = useState(null)
  const [tagPopoverSession, setTagPopoverSession] = useState(null)
  const [tagPopoverTop, setTagPopoverTop] = useState(120)
  const tagPopoverRef = useRef(null)

  const activeTag = useSidebarStore((s) => s.activeTag)
  const setActiveTag = useSidebarStore((s) => s.setActiveTag)
  const availableTags = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const s of sessions) {
      if (s.tag && !seen.has(s.tag)) {
        seen.add(s.tag)
        out.push(s.tag)
      }
    }
    return out
  }, [sessions])

  // Filter sessions by tag + search query into a single flat list
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const tagFiltered = activeTag ? sessions.filter((s) => s.tag === activeTag) : sessions
    return q
      ? tagFiltered.filter((s) => {
          const sid = (s.sessionId || s.id || '').toLowerCase()
          const name = (s.name || '').toLowerCase()
          return sid.includes(q) || name.includes(q)
        })
      : tagFiltered
  }, [sessions, searchQuery, activeTag])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Active-run state is process-local and may change while another chat is
  // open. A lightweight refresh keeps RUNNING/ACTION labels current without
  // routing background content through the active chat stores.
  useEffect(() => {
    if (!sessions.some((session) => session.runStatus === 'running' || session.runStatus === 'waiting_user')) return undefined
    const timer = window.setInterval(fetchSessions, 3000)
    return () => window.clearInterval(timer)
  }, [sessions, fetchSessions])

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenuId])

  // Close tag popover on outside click
  useEffect(() => {
    if (!tagPopoverSession) return
    const handler = (e) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target)) {
        setTagPopoverSession(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tagPopoverSession])

  const handleRenameStart = (session) => setRenameEditingId(session.id)
  const handleRenameCancel = () => setRenameEditingId(null)
  const handleRenameCommit = async (session, nextTitle) => {
    const trimmed = (nextTitle || '').trim()
    setRenameEditingId(null)
    if (!trimmed || trimmed === session.name) return
    try {
      await apiRenameSession(session.sessionId || session.id, trimmed)
      useSidebarStore.setState((s) => ({
        sessions: s.sessions.map((row) =>
          row.id === session.id ? { ...row, name: trimmed, customTitle: trimmed } : row
        ),
      }))
    } catch (err) {
      showConfirmDialog({
        title: t('sidebar.renameFailed'),
        message: String(err?.message || err),
        confirmLabel: t('confirm.ok'),
      })
    }
  }
  const handleTagStart = (session, anchorRect) => {
    if (anchorRect) {
      // Anchor below the trigger row; keep the popup body on-screen.
      setTagPopoverTop(Math.max(60, Math.min(window.innerHeight - 240, anchorRect.bottom + 4)))
    }
    setTagPopoverSession(session)
  }
  const handleTagSaved = (session, nextTag) => {
    useSidebarStore.setState((s) => ({
      sessions: s.sessions.map((row) =>
        row.id === session.id ? { ...row, tag: nextTag } : row
      ),
    }))
    // If the currently-active tag filter matches a tag that no longer exists, reset.
    if (activeTag && nextTag !== activeTag) {
      const stillExists = useSidebarStore.getState().sessions.some((s) => s.tag === activeTag)
      if (!stillExists) setActiveTag(null)
    }
  }

  // Infinite scroll: load more when scrolled near bottom
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      fetchMoreSessions()
    }
  }, [fetchMoreSessions])

  const effectiveWidth = collapsed ? 48 : width

  const handleNewChat = () => {
    saveChatDraft(activeSessionId)
    setActiveSessionId(null)
    clearMessages()
    clearTasks()
    clearFileOps()
    clearFileBrowser()
    clearPlanContent()
    hideCanvas()
  }

  const handleSelectSession = async (session) => {
    if (activeSessionId !== session.id) saveChatDraft(activeSessionId)
    setActiveSessionId(session.id)
    clearTasks()
    useFileOpsStore.getState().clearFileOps()
    useFileBrowserStore.getState().clear()
    clearPlanContent()
    try {
      const data = session.sessionId
        ? await fetchSessionMessages(session.sessionId)
        : { messages: [] }
      const transformed = transformSessionMessages(data.messages || [])
      const { fileOps, fileBrowserTabs, tasks, subagentContent } = transformed
      let messages = transformed.messages
      let pendingAskUser = null
      let pendingPermission = null
      let pendingPlanApproval = null
      const pending = session.pendingRequest
      if (pending?.tool_name === 'AskUserQuestion' && pending.input?.questions) {
        pendingAskUser = {
          toolUseId: pending.request_id,
          questions: pending.input.questions,
          _permissionRequestId: pending.request_id,
        }
        const askBlock = {
          type: 'ask_user', id: pending.request_id, toolUseId: pending.request_id,
          questions: pending.input.questions, status: 'pending',
        }
        const last = messages[messages.length - 1]
        if (last?.role === 'assistant') {
          if (!last.content.some((block) => block.toolUseId === pending.request_id)) {
            messages = [...messages.slice(0, -1), { ...last, content: [...last.content, askBlock] }]
          }
        } else {
          messages = [...messages, { role: 'assistant', content: [askBlock], timestamp: Date.now() }]
        }
      } else if (pending?.tool_name === 'ExitPlanMode') {
        pendingPlanApproval = {
          requestId: pending.request_id,
          planContent: pending.input?.plan || pending.input?.content || '',
          planFilePath: null,
        }
      } else if (pending) {
        pendingPermission = pending
      }
      if (!messages.length && session.firstPrompt) {
        messages = [
          { role: 'user', content: [{ type: 'text', text: session.firstPrompt }], timestamp: session.createdAt || Date.now() },
          { role: 'assistant', content: [], timestamp: Date.now() },
        ]
      }
      const cachedDraft = chatDraftCache.get(session.id) || {}
      loadSession(session.sessionId || null, messages, null, subagentContent, {
        ...cachedDraft,
        runId: session.runId,
        isStreaming: session.runStatus === 'running' || session.runStatus === 'waiting_user',
        pendingAskUser,
        pendingPermission,
        pendingPlanApproval,
      })
      if (session.runId && (session.runStatus === 'running' || session.runStatus === 'waiting_user')) {
        resumeRun(session)
      }

      // Populate file ops store
      const fileOpsStore = useFileOpsStore.getState()
      for (const op of fileOps) {
        fileOpsStore.addFileOp(op)
      }
      useFileBrowserStore.getState().setTabs(fileBrowserTabs)

      // Populate task store
      const taskStore = useTaskStore.getState()
      for (const task of tasks) {
        taskStore.addTask(task)
      }

      // Show Canvas only when this session has artifacts that a Canvas tab
      // can actually render. Plain Skill/Bash sessions should not inherit
      // the previous session's visible Canvas state.
      const hasInspectorItems = hasCanvasInspectorItems(messages)
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
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      console.error('Failed to load session messages:', err)
      // Keep the previous view instead of loading an empty session — an empty
      // chat looks like data loss. Offer a retry via toast.
      useToastStore.getState().pushToast({
        level: 'error',
        title: t('sidebar.loadFailedTitle'),
        body: String(err?.message || err),
        action: {
          label: t('sidebar.loadFailedRetry'),
          onClick: () => handleSelectSession(session),
        },
      })
    }
  }

  const restoredActiveRef = useRef(false)
  useEffect(() => {
    if (restoredActiveRef.current || !activeSessionId || sessions.length === 0) return
    const active = sessions.find((session) => session.id === activeSessionId)
    if (!active) return
    restoredActiveRef.current = true
    if (useChatStore.getState().messages.length === 0) {
      handleSelectSession(active)
    }
  }, [activeSessionId, sessions]) // handleSelectSession intentionally uses the latest render state

  const handleDeleteSession = (e, session) => {
    e.stopPropagation()
    showConfirmDialog({
      title: t('sidebar.deleteTitle'),
      message: t('sidebar.deleteMessage', { name: session.name }),
      confirmLabel: t('sidebar.deleteConfirm'),
      danger: true,
      onConfirm: async () => {
        try {
          await apiDeleteSession(session.sessionId || session.id)
        } catch (err) {
          console.error('Failed to delete session:', err)
        }
        safeStorage.removeItem(`vivian-rewind:${session.sessionId || session.id}`)
        const store = useSidebarStore.getState()
        const newSessions = store.sessions.filter((s) => s.id !== session.id)
        useSidebarStore.setState({ sessions: newSessions, sessionsTotal: store.sessionsTotal - 1 })
        if (activeSessionId === session.id) {
          clearMessages()
          clearTasks()
          useFileOpsStore.getState().clearFileOps()
          useFileBrowserStore.getState().clear()
        }
      },
    })
  }

  return (
    <aside
      className="fixed flex flex-col overflow-hidden"
      style={{
        width: effectiveWidth,
        top: 'var(--navbar-height)',
        left: 0,
        bottom: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {collapsed ? (
        /* Collapsed: icon-only new chat + bottom settings/collapse */
        <div className="flex flex-col items-center p-2 flex-1">
          <button
            style={{
              width: 32,
              height: 32,
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 150ms ease',
            }}
            onClick={handleNewChat}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('chat.newChat')}
          >
            <PlusCircle size={16} strokeWidth={1.5} />
          </button>
          <div className="flex-1" />
          {/* Settings icon */}
          <div className="relative flex flex-col items-center gap-1">
            <SettingsPopover />
            <button
              style={{
                width: 32,
                height: 32,
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 150ms ease',
              }}
              onClick={toggleSettingsPopover}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              title={t('sidebar.settings')}
            >
              <Settings size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* New Chat Button */}
          <div className="px-3 py-3">
            <button
              className="flex items-center gap-2 px-3 py-2 w-full"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                transition: 'border-color 150ms ease, color 150ms ease',
              }}
              onClick={handleNewChat}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-strong)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              <PlusCircle size={13} strokeWidth={1.5} />
              {t('sidebar.newChat')}
            </button>
          </div>

          {/* Current Session Indicator */}
          {currentSessionId && (
            <>
              <div className="px-3 py-2">
                <div
                  className="uppercase"
                  style={{
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    marginBottom: 4,
                  }}
                >
                  {t('chat.session')}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex-1 truncate"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      minWidth: 0,
                    }}
                    title={currentSessionId}
                  >
                    {currentSessionId}
                  </span>
                  <CopyButton content={currentSessionId} inline />
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />
            </>
          )}

          {/* Search + Refresh */}
          <div className="flex items-center gap-2 px-3 py-1">
            <div
              className="flex items-center gap-2 flex-1"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '4px 8px',
                minWidth: 0,
              }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.searchPlaceholder')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: "'Noto Sans', sans-serif",
                  minWidth: 0,
                }}
              />
              {searchQuery && (
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    padding: 0,
                    display: 'flex',
                    transition: 'color 150ms ease',
                  }}
                  onClick={() => setSearchQuery('')}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <button
              style={{
                background: 'transparent',
                border: 'none',
                cursor: sessionsLoading ? 'default' : 'pointer',
                color: 'var(--text-dim)',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'color 150ms ease',
              }}
              onClick={fetchSessions}
              disabled={sessionsLoading}
              onMouseEnter={(e) => { if (!sessionsLoading) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <RefreshCw
                size={13}
                strokeWidth={1.5}
                style={{
                  animation: sessionsLoading ? 'spin 1s linear infinite' : 'none',
                }}
              />
            </button>
          </div>

          {/* Tag filter bar (only when at least one tag exists) */}
          {availableTags.length > 0 && (
            <div
              className="flex flex-wrap gap-1 px-3 py-2"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <TagFilterChip
                active={activeTag === null}
                label={t('sidebar.all')}
                showIcon={false}
                onClick={() => setActiveTag(null)}
              />
              {availableTags.map((tag) => (
                <TagFilterChip
                  key={tag}
                  active={activeTag === tag}
                  label={tag}
                  onClick={() => setActiveTag(tag)}
                />
              ))}
            </div>
          )}

          {/* Tag popover host — fixed-position, anchored to the trigger row */}
          {tagPopoverSession && (
            <div
              className="fixed"
              ref={tagPopoverRef}
              style={{ top: tagPopoverTop, left: 12, zIndex: 80 }}
            >
              <TagPopover
                session={tagPopoverSession}
                recentTags={availableTags}
                onClose={() => setTagPopoverSession(null)}
                onSaved={handleTagSaved}
              />
            </div>
          )}

          {/* Session List */}
          <div className="flex-1 overflow-y-auto py-1" ref={listRef} onScroll={handleScroll}>
            {sessions.length === 0 && !sessionsLoading && (
              <div className="px-3 py-4" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {t('sidebar.noSessions')}
              </div>
            )}

            {searchQuery && sessions.length > 0 && filteredSessions.length === 0 && (
              <div className="px-3 py-4" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {t('sidebar.noResults')}
              </div>
            )}

            {sessions.length === 0 && sessionsLoading && (
              <div className="px-3 py-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2 px-0 py-2">
                    <div className="skeleton" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <div className="skeleton" style={{ height: 14, flex: 1 }} />
                  </div>
                ))}
              </div>
            )}

            {filteredSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                openMenuId={openMenuId}
                menuRef={menuRef}
                onSelect={handleSelectSession}
                onMenuToggle={setOpenMenuId}
                onDelete={handleDeleteSession}
                onRenameStart={handleRenameStart}
                onTagStart={handleTagStart}
                renameEditingId={renameEditingId}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
                t={t}
              />
            ))}

            {sessionsHasMore && (
              <button
                className="flex items-center justify-center gap-1 px-3 py-2 w-full"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: sessionsLoading ? 'default' : 'pointer',
                  fontSize: 13,
                  transition: 'color 150ms ease',
                }}
                onClick={fetchMoreSessions}
                disabled={sessionsLoading}
                onMouseEnter={(e) => { if (!sessionsLoading) e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                {sessionsLoading ? (
                  t('sidebar.loading')
                ) : (
                  <>
                    <ChevronDown size={13} strokeWidth={1.5} />
                    {t('sidebar.loadMore')}
                  </>
                )}
              </button>
            )}
          </div>
        </>
      )}

      {/* Bottom: Settings + Toggle */}
      <div
        className="p-2 flex items-center"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {collapsed ? (
          /* Collapse toggle only — settings icon is in collapsed top section */
          <button
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onClick={toggleCollapsed}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
            title={t('sidebar.expand')}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
        ) : (
          <>
            {/* Settings button with popover */}
            <div className="relative">
              <SettingsPopover />
              <button
                className="flex items-center gap-2"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  fontSize: 13,
                  transition: 'color 150ms ease, background 150ms ease',
                }}
                onClick={toggleSettingsPopover}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-dim)'
                  e.currentTarget.style.background = 'transparent'
                }}
                title={t('sidebar.settings')}
              >
                <Settings size={14} strokeWidth={1.5} />
                <span>{t('sidebar.settings')}</span>
              </button>
            </div>
            {/* Collapse toggle */}
            <button
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'color 150ms ease, background 150ms ease',
              }}
              onClick={toggleCollapsed}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-dim)'
                e.currentTarget.style.background = 'transparent'
              }}
              title={t('sidebar.collapse')}
            >
              <PanelLeftClose size={16} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      {!collapsed && <SidebarResizer />}

      {/* Group hover CSS for delete button */}
      <style>{`
        .group:hover .group-hover-visible { opacity: 1 !important; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </aside>
  )
}
