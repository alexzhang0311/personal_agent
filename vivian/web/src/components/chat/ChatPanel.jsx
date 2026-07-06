import { lazy, Suspense } from 'react'
import { FileDiff, FolderTree, PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useSidebarStore from '../../stores/sidebarStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import MessageListBoundary from './MessageListBoundary'
import ChatInput from './ChatInput'
import UsageStatsOverview from './UsageStatsOverview'
import QuickActionChips from './QuickActionChips'
import CheckpointToggle from './CheckpointToggle'
import RewindBanner from './RewindBanner'

const MessageList = lazy(() => import('./MessageList'))

function CanvasShortcut({ icon: Icon, title, hidden, onClick }) {
  if (hidden) return null
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        padding: 0,
        transition: 'color 150ms ease, background 150ms ease',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = 'var(--text-secondary)'
        event.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = 'var(--text-dim)'
        event.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon size={16} strokeWidth={1.5} />
    </button>
  )
}

export default function ChatPanel() {
  const { t } = useTranslation()
  const sessionId = useChatStore((s) => s.sessionId)
  const messages = useChatStore((s) => s.messages)
  const sidebarSessions = useSidebarStore((s) => s.sessions)
  const authUser = useAuthStore((s) => s.user)
  const canvasVisible = useUiStore((s) => s.canvasVisible)
  const canvasMinimized = useUiStore((s) => s.canvasMinimized)
  const activeCanvasTab = useUiStore((s) => s.activeCanvasTab)
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setCanvasMinimized = useUiStore((s) => s.setCanvasMinimized)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const activeSidebarSession = sidebarSessions.find((s) => s.sessionId === sessionId || s.id === sessionId)
  const sessionTitle = activeSidebarSession?.name || (sessionId ? sessionId : '')
  const isEmpty = messages.length === 0
  const activeCwd = activeSidebarSession?.cwd || authUser?.workspace
  const activateCanvasTab = (tab) => {
    setActiveCanvasTab(tab)
    setCanvasMinimized(false)
    showCanvas()
  }
  const isCanvasTabVisible = (tab) => {
    if (!canvasVisible || canvasMinimized) return false
    if (tab === 'changes') return activeCanvasTab === 'changes' || activeCanvasTab === 'files'
    return activeCanvasTab === tab
  }

  if (isEmpty) {
    const TRACK_STYLE = { width: '70%', maxWidth: 1000, margin: '0 auto' }

    return (
      <div
        className="flex flex-col flex-1 min-w-0"
        style={{ background: 'var(--bg-base)' }}
      >
        {/* Top: scrollable overview (card at half-track width) + chips */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: 'var(--bg-base)' }}
        >
          <div className="flex min-h-full flex-col">
            <div style={{ ...TRACK_STYLE, paddingTop: 24 }}>
              <div style={{ width: '50%', minWidth: 320 }}>
                <UsageStatsOverview />
              </div>
            </div>
            <div
              className="flex flex-1 items-center justify-center"
              style={{ padding: '16px 0 24px' }}
            >
              <QuickActionChips />
            </div>
          </div>
        </div>

        {/* Bottom: pinned input at 70% track, same left edge as card */}
        <div
          className="flex-shrink-0 chat-empty-input"
          style={{ ...TRACK_STYLE, paddingBottom: 12 }}
        >
          <ChatInput cwd={activeCwd} cwdPlacement="below" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 min-w-0"
      style={{ background: 'var(--bg-base)', height: '100%', minHeight: 0 }}
    >
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 40,
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <span
          className="truncate"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            minWidth: 0,
            marginRight: 12,
          }}
          title={sessionTitle}
        >
          {sessionTitle}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <CheckpointToggle />
          <CanvasShortcut
            icon={PanelRight}
            title={t('canvas.tasks')}
            hidden={isCanvasTabVisible('tasks')}
            onClick={() => activateCanvasTab('tasks')}
          />
          <CanvasShortcut
            icon={FolderTree}
            title={t('canvas.fileBrowser')}
            hidden={isCanvasTabVisible('file-browser')}
            onClick={() => activateCanvasTab('file-browser')}
          />
          <CanvasShortcut
            icon={FileDiff}
            title={t('canvas.changeReview')}
            hidden={isCanvasTabVisible('changes')}
            onClick={() => activateCanvasTab('changes')}
          />
        </div>
      </div>
      <RewindBanner />
      <MessageListBoundary resetKey={sessionId ? `${sessionId}:${messages.length}` : `draft:${messages.length}`}>
        <Suspense fallback={<div className="flex-1" style={{ background: 'var(--bg-base)' }} />}>
          <MessageList />
        </Suspense>
      </MessageListBoundary>
      <ChatInput cwd={activeCwd} cwdPlacement="below" />
    </div>
  )
}
