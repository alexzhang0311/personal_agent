import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'
import useToastStore from '../../stores/toastStore'
import { groupSessionsByDate } from '../../utils/sessionList'
import {
  captureSessionPointerAfterThreshold,
  formatFolderSessionTime,
  isSameFolderTarget,
} from '../../utils/sessionFolders'

const UNFILED_TARGET = '__unfiled__'

function InlineFolderInput({ initialValue = '', onCommit, onCancel }) {
  const [value, setValue] = useState(initialValue)
  const committedRef = useRef(false)
  const commit = () => {
    if (committedRef.current) return
    const trimmed = value.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    committedRef.current = true
    onCommit(trimmed)
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={64}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          committedRef.current = true
          onCancel()
        }
      }}
      onBlur={commit}
      style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        color: 'var(--text-primary)',
        fontSize: 12,
        outline: 'none',
        padding: '3px 5px',
      }}
    />
  )
}

function LoadMoreButton({ loading, onClick, children }) {
  return (
    <button
      type="button"
      className="flex items-center justify-center gap-1 px-3 py-2 w-full"
      disabled={loading}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-dim)',
        cursor: loading ? 'default' : 'pointer',
        fontSize: 12,
        transition: 'color 150ms ease',
      }}
    >
      <ChevronDown size={13} strokeWidth={1.5} />
      {children}
    </button>
  )
}

export default function SessionFolderView({
  activeSessionId,
  creating,
  listRef,
  onCreatingChange,
  renderSession,
  sessions,
  sessionsHasMore,
  sessionsLoading,
  onLoadMoreUnfiled,
}) {
  const { t } = useTranslation()
  const folders = useSidebarStore((state) => state.sessionFolders)
  const buckets = useSidebarStore((state) => state.folderBuckets)
  const expandedFolderIds = useSidebarStore((state) => state.expandedFolderIds)
  const unfiledCount = useSidebarStore((state) => state.unfiledCount)
  const setFolderExpanded = useSidebarStore((state) => state.setFolderExpanded)
  const createFolder = useSidebarStore((state) => state.createSessionFolder)
  const renameFolder = useSidebarStore((state) => state.renameSessionFolder)
  const deleteFolder = useSidebarStore((state) => state.deleteSessionFolder)
  const fetchFolderSessions = useSidebarStore((state) => state.fetchFolderSessions)
  const moveSession = useSidebarStore((state) => state.moveSessionToFolder)
  const showConfirmDialog = useUiStore((state) => state.showConfirmDialog)
  const [editingFolderId, setEditingFolderId] = useState(null)
  const [openFolderMenuId, setOpenFolderMenuId] = useState(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const pointerRef = useRef(null)
  const autoScrollDirectionRef = useRef(0)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (!openFolderMenuId) return undefined
    const close = () => setOpenFolderMenuId(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [openFolderMenuId])

  useEffect(() => {
    if (!drag) return undefined
    let frameId
    const scroll = () => {
      const list = listRef.current
      if (list && autoScrollDirectionRef.current) {
        list.scrollTop += autoScrollDirectionRef.current * 8
      }
      frameId = window.requestAnimationFrame(scroll)
    }
    frameId = window.requestAnimationFrame(scroll)
    return () => window.cancelAnimationFrame(frameId)
  }, [Boolean(drag), listRef])

  const reportError = (error, title) => {
    useToastStore.getState().pushToast({
      level: 'error',
      title,
      body: String(error?.message || error),
    })
  }

  const beginPointer = (session, event) => {
    if (
      event.button !== 0 || !session.sessionId || session.sessionKind === 'scheduler' ||
      event.target.closest('button, input, [role="menu"], [data-session-control]')
    ) return
    const bounds = event.currentTarget.getBoundingClientRect()
    pointerRef.current = {
      session,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    }
  }

  const movePointer = (event) => {
    const candidate = pointerRef.current
    if (!captureSessionPointerAfterThreshold(
      candidate, event, Boolean(dragRef.current)
    )) return
    const targetElement = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-session-folder-target]')
    const rawTarget = targetElement?.dataset.sessionFolderTarget
    const targetFolderId = rawTarget === UNFILED_TARGET ? null : (rawTarget || undefined)
    const nextDrag = {
      session: candidate.session,
      x: event.clientX,
      y: event.clientY,
      offsetX: candidate.offsetX,
      offsetY: candidate.offsetY,
      targetFolderId,
    }
    dragRef.current = nextDrag
    setDrag(nextDrag)
    const list = listRef.current
    if (list) {
      const bounds = list.getBoundingClientRect()
      if (event.clientY < bounds.top + 32) autoScrollDirectionRef.current = -1
      else if (event.clientY > bounds.bottom - 32) autoScrollDirectionRef.current = 1
      else autoScrollDirectionRef.current = 0
    }
  }

  const endPointer = async (event) => {
    const candidate = pointerRef.current
    if (!candidate || candidate.pointerId !== event.pointerId) return
    pointerRef.current = null
    if (!dragRef.current) return
    suppressClickRef.current = true
    const dropped = dragRef.current
    dragRef.current = null
    autoScrollDirectionRef.current = 0
    setDrag(null)
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
    if (dropped.targetFolderId === undefined || isSameFolderTarget(
      dropped.session, dropped.targetFolderId
    )) return
    try {
      await moveSession(dropped.session, dropped.targetFolderId)
    } catch (error) {
      reportError(error, t('sidebar.moveFailed', { defaultValue: 'Move failed' }))
    }
  }

  const dragProps = (session) => ({
    onPointerDown: (event) => beginPointer(session, event),
    onPointerMove: movePointer,
    onPointerUp: endPointer,
    onPointerCancel: () => {
      pointerRef.current = null
      dragRef.current = null
      autoScrollDirectionRef.current = 0
      setDrag(null)
    },
    onClickCapture: (event) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onDoubleClickCapture: (event) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
  })

  const commitCreate = async (name) => {
    try {
      await createFolder(name)
      onCreatingChange(false)
    } catch (error) {
      reportError(error, t('sidebar.folderCreateFailed', { defaultValue: 'Create folder failed' }))
    }
  }

  const commitRename = async (folder, name) => {
    setEditingFolderId(null)
    if (name === folder.name) return
    try {
      await renameFolder(folder.id, name)
    } catch (error) {
      reportError(error, t('sidebar.folderRenameFailed', { defaultValue: 'Rename folder failed' }))
    }
  }

  const confirmDelete = (folder) => {
    setOpenFolderMenuId(null)
    showConfirmDialog({
      title: t('sidebar.folderDeleteTitle', { defaultValue: 'Delete folder' }),
      message: t('sidebar.folderDeleteMessage', {
        defaultValue: `Sessions in “${folder.name}” will return to Unfiled.`,
        name: folder.name,
      }),
      confirmLabel: t('sidebar.delete', { defaultValue: 'Delete' }),
      onConfirm: async () => {
        try {
          await deleteFolder(folder.id)
        } catch (error) {
          reportError(error, t('sidebar.folderDeleteFailed', { defaultValue: 'Delete folder failed' }))
        }
      },
    })
  }

  const groupedUnfiled = groupSessionsByDate(sessions)
  const targetBorder = (targetFolderId) => drag && drag.targetFolderId === targetFolderId
    ? 'var(--blue)'
    : 'transparent'

  return (
    <>
      {creating && (
        <div className="flex items-center gap-2 px-3 py-2">
          <Folder size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <InlineFolderInput
            onCommit={commitCreate}
            onCancel={() => onCreatingChange(false)}
          />
        </div>
      )}

      {folders.map((folder) => {
        const expanded = expandedFolderIds.includes(folder.id)
        const bucket = buckets[folder.id] || {}
        const FolderIcon = expanded ? FolderOpen : Folder
        return (
          <div key={folder.id}>
            <div
              data-session-folder-target={folder.id}
              className="flex items-center gap-1 px-2 py-2"
              style={{
                borderLeft: `2px solid ${targetBorder(folder.id)}`,
                background: drag?.targetFolderId === folder.id ? 'var(--bg-elevated)' : 'transparent',
                color: 'var(--text-secondary)',
                transition: 'background 150ms ease, border-color 150ms ease',
              }}
            >
              <button
                type="button"
                className="flex items-center gap-2 flex-1 min-w-0"
                onClick={() => setFolderExpanded(folder.id, !expanded)}
                style={{
                  background: 'transparent', border: 'none', color: 'inherit',
                  cursor: 'pointer', minWidth: 0, padding: '0 2px', textAlign: 'left',
                }}
              >
                {expanded
                  ? <ChevronDown size={13} strokeWidth={1.5} />
                  : <ChevronRight size={13} strokeWidth={1.5} />}
                <FolderIcon size={14} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                {editingFolderId === folder.id ? (
                  <InlineFolderInput
                    initialValue={folder.name}
                    onCommit={(name) => commitRename(folder, name)}
                    onCancel={() => setEditingFolderId(null)}
                  />
                ) : (
                  <span className="flex-1 truncate" title={folder.name}>{folder.name}</span>
                )}
                <span style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  {folder.sessionCount}
                </span>
              </button>
              {editingFolderId !== folder.id && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={t('sidebar.folderMenu', { defaultValue: 'Folder menu' })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenFolderMenuId(openFolderMenuId === folder.id ? null : folder.id)
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
                  >
                    <MoreHorizontal size={13} strokeWidth={1.5} />
                  </button>
                  {openFolderMenuId === folder.id && (
                    <div
                      role="menu"
                      className="absolute"
                      onPointerDown={(event) => event.stopPropagation()}
                      style={{
                        right: 0, top: '100%', zIndex: 70, minWidth: 140,
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: 4, overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 w-full"
                        onClick={() => { setOpenFolderMenuId(null); setEditingFolderId(folder.id) }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}
                      >
                        <Pencil size={13} strokeWidth={1.5} />
                        {t('sidebar.rename')}
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 w-full"
                        onClick={() => confirmDelete(folder)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                        {t('sidebar.delete')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {expanded && (
              <div style={{ paddingLeft: 10 }}>
                {bucket.loading && !bucket.loaded && (
                  <div className="px-3 py-2"><div className="skeleton" style={{ height: 14 }} /></div>
                )}
                {bucket.loaded && (bucket.sessions || []).length === 0 && (
                  <div className="px-3 py-2" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                    {t('sidebar.emptyFolder', { defaultValue: 'Empty folder' })}
                  </div>
                )}
                {(bucket.sessions || []).map((session) => renderSession(session, {
                  wrapperProps: dragProps(session),
                  timeLabel: formatFolderSessionTime(session.createdAt, {
                    yesterdayLabel: t('sidebar.yesterday'),
                  }),
                }))}
                {bucket.hasMore && (
                  <LoadMoreButton
                    loading={bucket.loading}
                    onClick={() => fetchFolderSessions(folder.id).catch((error) => reportError(error, t('sidebar.loadFailedTitle')))}
                  >
                    {bucket.loading ? t('sidebar.loading') : t('sidebar.loadMore')}
                  </LoadMoreButton>
                )}
              </div>
            )}
          </div>
        )
      })}

      <div
        data-session-folder-target={UNFILED_TARGET}
        className="uppercase"
        style={{
          borderLeft: `2px solid ${targetBorder(null)}`,
          background: drag?.targetFolderId === null ? 'var(--bg-elevated)' : 'var(--bg-surface)',
          color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', padding: '7px 12px 3px',
          transition: 'background 150ms ease, border-color 150ms ease',
        }}
      >
        {t('sidebar.unfiled', { defaultValue: 'Unfiled' })}
        <span style={{ marginLeft: 5, fontFamily: "'JetBrains Mono', monospace", fontWeight: 300 }}>{unfiledCount}</span>
      </div>

      {groupedUnfiled.map((group) => (
        <div key={group.key}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '6px 12px 2px' }}>
            {group.key === 'today' ? t('sidebar.today')
              : group.key === 'yesterday' ? t('sidebar.yesterday')
                : group.key === 'earlier' ? t('sidebar.more') : group.key}
          </div>
          {group.sessions.map((session) => renderSession(session, {
            wrapperProps: dragProps(session),
          }))}
        </div>
      ))}

      {sessionsHasMore && (
        <LoadMoreButton loading={sessionsLoading} onClick={onLoadMoreUnfiled}>
          {sessionsLoading ? t('sidebar.loading') : t('sidebar.loadMore')}
        </LoadMoreButton>
      )}

      {drag && createPortal(
        <div
          style={{
            position: 'fixed', left: 0, top: 0, zIndex: 200, pointerEvents: 'none',
            transform: `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)`,
            width: Math.min(320, Math.max(180, listRef.current?.clientWidth || 240)),
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            borderLeft: '2px solid var(--blue)', borderRadius: 2,
            color: 'var(--text-primary)', fontSize: 13, padding: '8px 10px',
          }}
        >
          <span className="block truncate">{drag.session.name}</span>
        </div>,
        document.body
      )}
    </>
  )
}
