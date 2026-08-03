import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { PlusCircle, MessageSquare, CalendarClock, PanelLeftClose, PanelLeft, Trash2, ChevronDown, MoreHorizontal, RefreshCw, Settings, Search, X, Pencil, Flag, GitBranch, FolderInput, FolderPlus } from 'lucide-react'
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
import safeStorage from '../../utils/safeStorage'
import { formatSessionTime, groupSessionsByDate } from '../../utils/sessionList'
import { folderNameForSession } from '../../utils/sessionFolders'
import SessionFolderView from './SessionFolderView'

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
  onRenameCommit, onRenameCancel, onMoveStart, folderName,
  timeLabel, t,
}) {
  const [renameValue, setRenameValue] = useState(session.name || '')
  useEffect(() => {
    if (renameEditingId === session.id) setRenameValue(session.name || '')
  }, [renameEditingId, session.id, session.name])
  const editing = renameEditingId === session.id
  const isProject = session.sessionSource === 'project'
  const isScheduler = session.sessionKind === 'scheduler'
  const SessionIcon = isScheduler ? CalendarClock : MessageSquare
  const sessionTime = timeLabel ?? formatSessionTime(session.createdAt)
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
      onDoubleClick={(event) => {
        if (editing || !session.sessionId || event.target.closest('button, input, [role="menu"], [data-session-control]')) return
        event.stopPropagation()
        onRenameStart(session)
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <SessionIcon size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
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
        {sessionTime && !editing && (
          <span
            style={{
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 300,
              flexShrink: 0,
            }}
          >
            {sessionTime}
          </span>
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
                {session.sessionId && (
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
                )}
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
                {!isScheduler && session.sessionId && (
                  <button
                    className="flex items-center gap-2 px-3 py-2 w-full"
                    style={{ ...menuItemStyle, color: 'var(--text-primary)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onMenuToggle(null)
                      onMoveStart(session, e.currentTarget.getBoundingClientRect())
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <FolderInput size={13} strokeWidth={1.5} />
                    {t('sidebar.moveToFolder', { defaultValue: 'Move to folder' })}
                  </button>
                )}
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
      {isScheduler && session.schedulerContext?.job_name && !editing && (
        <div
          className="truncate"
          style={{
            paddingLeft: 19,
            color: 'var(--text-dim)',
            fontSize: 11,
            fontWeight: 300,
            minWidth: 0,
          }}
          title={session.schedulerContext.job_name}
        >
          {session.schedulerContext.job_name}
        </div>
      )}
      {folderName && !editing && (
        <div
          className="truncate"
          style={{
            paddingLeft: 19,
            color: 'var(--text-dim)',
            fontSize: 11,
            fontWeight: 300,
            minWidth: 0,
          }}
          title={`${folderName} / ${session.name}`}
        >
          {folderName} / {session.name}
        </div>
      )}
      {session.tag && !editing && (
        <div data-session-control className="flex items-center gap-1" style={{ paddingLeft: 19 }}>
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

function MovePopover({ session, folders, onClose, onMove }) {
  const { t } = useTranslation()
  const options = [{ id: null, name: t('sidebar.unfiled', { defaultValue: 'Unfiled' }) }, ...folders]
  return (
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 4, minWidth: 210, maxWidth: 'calc(100vw - 24px)',
        maxHeight: 280, overflowY: 'auto', padding: 4,
      }}
    >
      {options.map((folder) => {
        const current = (session.folderId || null) === folder.id
        return (
          <button
            key={folder.id || 'unfiled'}
            type="button"
            role="menuitem"
            disabled={current}
            className="flex items-center gap-2 px-3 py-2 w-full min-w-0"
            onClick={() => { if (!current) onMove(folder.id) }}
            style={{
              background: current ? 'var(--bg-surface)' : 'transparent',
              border: 'none', borderLeft: `2px solid ${current ? 'var(--blue)' : 'transparent'}`,
              borderRadius: 2, color: current ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: current ? 'default' : 'pointer', fontSize: 12, textAlign: 'left',
            }}
          >
            <FolderInput size={13} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span className="truncate">{folder.name}</span>
          </button>
        )
      })}
      <button
        type="button"
        className="px-3 py-2 w-full"
        onClick={onClose}
        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}
      >
        {t('confirm.cancel', { defaultValue: 'Cancel' })}
      </button>
    </div>
  )
}

function updateSessionCollections(state, sessionId, data) {
  return {
    sessions: state.sessions.map((row) => row.id === sessionId ? { ...row, ...data } : row),
    folderBuckets: Object.fromEntries(
      Object.entries(state.folderBuckets).map(([folderId, bucket]) => [folderId, {
        ...bucket,
        sessions: (bucket.sessions || []).map((row) =>
          row.id === sessionId ? { ...row, ...data } : row
        ),
      }])
    ),
  }
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
  const sessionKind = useSidebarStore((s) => s.sessionKind)
  const sessionQuery = useSidebarStore((s) => s.sessionQuery)
  const sessionCounts = useSidebarStore((s) => s.sessionCounts)
  const sessionFolders = useSidebarStore((s) => s.sessionFolders)
  const folderBuckets = useSidebarStore((s) => s.folderBuckets)
  const moveSessionToFolder = useSidebarStore((s) => s.moveSessionToFolder)
  const setSessionKind = useSidebarStore((s) => s.setSessionKind)
  const setSessionQuery = useSidebarStore((s) => s.setSessionQuery)
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
  const [searchQuery, setSearchQuery] = useState(sessionQuery)
  const menuRef = useRef(null)
  const [renameEditingId, setRenameEditingId] = useState(null)
  const [tagPopoverSession, setTagPopoverSession] = useState(null)
  const [tagPopoverTop, setTagPopoverTop] = useState(120)
  const [movePopoverSession, setMovePopoverSession] = useState(null)
  const [movePopoverTop, setMovePopoverTop] = useState(120)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const tagPopoverRef = useRef(null)
  const movePopoverRef = useRef(null)

  const availableTags = useMemo(() => {
    const seen = new Set()
    const out = []
    const bucketSessions = Object.values(folderBuckets)
      .flatMap((bucket) => bucket.sessions || [])
    for (const s of [...sessions, ...bucketSessions]) {
      if (s.tag && !seen.has(s.tag)) {
        seen.add(s.tag)
        out.push(s.tag)
      }
    }
    return out
  }, [sessions, folderBuckets])

  const groupedSessions = useMemo(() => groupSessionsByDate(sessions), [sessions])
  const folderView = sessionKind === 'chat' && !sessionQuery

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    const timer = window.setTimeout(() => setSessionQuery(searchQuery), 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery, setSessionQuery])

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

  useEffect(() => {
    if (!movePopoverSession) return undefined
    const handler = (event) => {
      if (movePopoverRef.current && !movePopoverRef.current.contains(event.target)) {
        setMovePopoverSession(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [movePopoverSession])

  const handleRenameStart = (session) => {
    if (session.sessionId) setRenameEditingId(session.id)
  }
  const handleRenameCancel = () => setRenameEditingId(null)
  const handleRenameCommit = async (session, nextTitle) => {
    const trimmed = (nextTitle || '').trim()
    setRenameEditingId(null)
    if (!session.sessionId || !trimmed || trimmed === session.name) return
    try {
      await apiRenameSession(session.sessionId || session.id, trimmed)
      useSidebarStore.setState((state) =>
        updateSessionCollections(state, session.id, { name: trimmed, customTitle: trimmed })
      )
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
    useSidebarStore.setState((state) =>
      updateSessionCollections(state, session.id, { tag: nextTag })
    )
  }
  const handleMoveStart = (session, anchorRect) => {
    setMovePopoverTop(Math.max(60, Math.min(window.innerHeight - 300, anchorRect?.bottom + 4 || 120)))
    setMovePopoverSession(session)
  }
  const handleMoveSession = async (folderId) => {
    const session = movePopoverSession
    setMovePopoverSession(null)
    if (!session) return
    try {
      await moveSessionToFolder(session, folderId)
    } catch (error) {
      useToastStore.getState().pushToast({
        level: 'error',
        title: t('sidebar.moveFailed', { defaultValue: 'Move failed' }),
        body: String(error?.message || error),
      })
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
    if (sessionKind !== 'chat') setSessionKind('chat')
    if (searchQuery) {
      setSearchQuery('')
      setSessionQuery('')
    }
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
    const loadedFolderSessions = Object.values(folderBuckets).flatMap((bucket) => bucket.sessions || [])
    if (restoredActiveRef.current || !activeSessionId || (sessions.length === 0 && loadedFolderSessions.length === 0)) return
    const active = [...sessions, ...loadedFolderSessions].find((session) => session.id === activeSessionId)
    if (!active) return
    restoredActiveRef.current = true
    if (useChatStore.getState().messages.length === 0) {
      handleSelectSession(active)
    }
  }, [activeSessionId, sessions, folderBuckets]) // handleSelectSession intentionally uses the latest render state

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
          return
        }
        safeStorage.removeItem(`vivian-rewind:${session.sessionId || session.id}`)
        const store = useSidebarStore.getState()
        const kind = session.sessionKind || 'chat'
        const nextBuckets = Object.fromEntries(
          Object.entries(store.folderBuckets).map(([folderId, bucket]) => [folderId, {
            ...bucket,
            sessions: (bucket.sessions || []).filter((row) => row.id !== session.id),
          }])
        )
        useSidebarStore.setState({
          sessions: store.sessions.filter((row) => row.id !== session.id),
          folderBuckets: nextBuckets,
          sessionsTotal: Math.max(0, store.sessionsTotal - (folderView && session.folderId ? 0 : 1)),
          unfiledCount: Math.max(0, store.unfiledCount - (!session.folderId && kind === 'chat' ? 1 : 0)),
          sessionFolders: store.sessionFolders.map((folder) => folder.id === session.folderId
            ? { ...folder, sessionCount: Math.max(0, folder.sessionCount - 1) }
            : folder),
          sessionCounts: {
            ...store.sessionCounts,
            [kind]: Math.max(0, store.sessionCounts[kind] - 1),
            all: Math.max(0, store.sessionCounts.all - 1),
          },
        })
        if (activeSessionId === session.id) {
          clearMessages()
          clearTasks()
          useFileOpsStore.getState().clearFileOps()
          useFileBrowserStore.getState().clear()
        }
      },
    })
  }

  const renderSession = (session, { wrapperProps = {}, timeLabel } = {}) => (
    <div key={session.id} {...wrapperProps} style={{ touchAction: 'pan-y', minWidth: 0 }}>
      <SessionItem
        session={session}
        isActive={session.id === activeSessionId}
        openMenuId={openMenuId}
        menuRef={menuRef}
        onSelect={handleSelectSession}
        onMenuToggle={setOpenMenuId}
        onDelete={handleDeleteSession}
        onRenameStart={handleRenameStart}
        onTagStart={handleTagStart}
        onMoveStart={handleMoveStart}
        renameEditingId={renameEditingId}
        onRenameCommit={handleRenameCommit}
        onRenameCancel={handleRenameCancel}
        folderName={sessionQuery ? folderNameForSession(session, sessionFolders) : null}
        timeLabel={timeLabel}
        t={t}
      />
    </div>
  )

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

          {/* Session origin filter */}
          <div
            className="flex items-center gap-1 px-3 py-2"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            {[
              ['chat', t('sidebar.chats'), sessionCounts.chat],
              ['scheduler', t('sidebar.scheduled'), sessionCounts.scheduler],
              ['all', t('sidebar.all'), sessionCounts.all],
            ].map(([kind, label, count]) => {
              const active = sessionKind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  className="flex-1 min-w-0 truncate"
                  aria-pressed={active}
                  onClick={() => setSessionKind(kind)}
                  style={{
                    background: active ? 'var(--bg-elevated)' : 'transparent',
                    border: 'none',
                    borderLeft: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
                    borderRadius: 2,
                    color: active ? 'var(--text-primary)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    padding: '4px 3px',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                  title={`${label} (${count})`}
                >
                  {label}
                  {width >= 220 && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 300,
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

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
            {sessionKind === 'chat' && !searchQuery && (
              <button
                type="button"
                aria-label={t('sidebar.newFolder', { defaultValue: 'New folder' })}
                title={t('sidebar.newFolder', { defaultValue: 'New folder' })}
                onClick={() => setCreatingFolder(true)}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-dim)',
                  cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0,
                  transition: 'color 150ms ease',
                }}
              >
                <FolderPlus size={14} strokeWidth={1.5} />
              </button>
            )}
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
              <RefreshCw size={13} strokeWidth={1.5} />
            </button>
          </div>

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

          {movePopoverSession && (
            <div
              className="fixed"
              ref={movePopoverRef}
              style={{ top: movePopoverTop, left: 12, zIndex: 85 }}
            >
              <MovePopover
                session={movePopoverSession}
                folders={sessionFolders}
                onClose={() => setMovePopoverSession(null)}
                onMove={handleMoveSession}
              />
            </div>
          )}

          {/* Session List */}
          <div className="flex-1 overflow-y-auto py-1" ref={listRef} onScroll={handleScroll}>
            {sessions.length === 0 && (!folderView || sessionFolders.length === 0) && !sessionsLoading && !sessionQuery && (
              <div className="px-3 py-4" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {sessionKind === 'scheduler'
                  ? t('sidebar.noScheduledSessions')
                  : sessionKind === 'chat'
                    ? t('sidebar.noChatSessions')
                    : t('sidebar.noSessions')}
              </div>
            )}

            {sessionQuery && sessions.length === 0 && !sessionsLoading && (
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

            {folderView ? (
              <SessionFolderView
                activeSessionId={activeSessionId}
                creating={creatingFolder}
                listRef={listRef}
                onCreatingChange={setCreatingFolder}
                renderSession={renderSession}
                sessions={sessions}
                sessionsHasMore={sessionsHasMore}
                sessionsLoading={sessionsLoading}
                onLoadMoreUnfiled={fetchMoreSessions}
              />
            ) : (
              <>
                {groupedSessions.map((group) => (
                  <div key={group.key}>
                    <div
                      className="sticky"
                      style={{
                        top: 0, zIndex: 2, background: 'var(--bg-surface)',
                        color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
                        letterSpacing: '0.06em', padding: '7px 12px 3px',
                      }}
                    >
                      {group.key === 'today' ? t('sidebar.today')
                        : group.key === 'yesterday' ? t('sidebar.yesterday')
                          : group.key === 'earlier' ? t('sidebar.more') : group.key}
                    </div>
                    {group.sessions.map((session) => renderSession(session))}
                  </div>
                ))}
                {sessionsHasMore && (
                  <button
                    className="flex items-center justify-center gap-1 px-3 py-2 w-full"
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-dim)',
                      cursor: sessionsLoading ? 'default' : 'pointer', fontSize: 13,
                      transition: 'color 150ms ease',
                    }}
                    onClick={fetchMoreSessions}
                    disabled={sessionsLoading}
                  >
                    {sessionsLoading ? t('sidebar.loading') : (
                      <><ChevronDown size={13} strokeWidth={1.5} />{t('sidebar.loadMore')}</>
                    )}
                  </button>
                )}
              </>
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
