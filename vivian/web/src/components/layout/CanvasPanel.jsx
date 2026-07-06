import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'
import useTaskStore from '../../stores/taskStore'
import useChatStore from '../../stores/chatStore'
import useSidebarStore from '../../stores/sidebarStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { useResizable } from '../../hooks/useResizable'
import ErrorBoundary from '../shared/ErrorBoundary'
import CanvasHeader from '../canvas/CanvasHeader'
import SubagentInspector from '../canvas/SubagentInspector'
import FileOpsPanel from '../canvas/FileOpsPanel'
import FileBrowserPanel from '../canvas/FileBrowserPanel'
import PlanReviewPanel from '../canvas/PlanReviewPanel'
import BrowserDebugPanel from '../canvas/BrowserDebugPanel'

const CANVAS_MIN_WIDTH = 280
const MIN_CHAT_WIDTH = 360

// Combined budget: sidebar + canvas may never squeeze the chat column below
// MIN_CHAT_WIDTH. Also keeps the historical 60vw ceiling.
function getCanvasMax(sidebarWidth, collapsed) {
  const sidebar = collapsed ? 48 : sidebarWidth
  return Math.max(
    CANVAS_MIN_WIDTH,
    Math.min(window.innerWidth * 0.6, window.innerWidth - sidebar - MIN_CHAT_WIDTH),
  )
}

export default function CanvasPanel() {
  const { t } = useTranslation()
  const canvasVisible = useUiStore((s) => s.canvasVisible)
  const canvasWidth = useUiStore((s) => s.canvasWidth)
  const canvasMinimized = useUiStore((s) => s.canvasMinimized)
  const setCanvasWidth = useUiStore((s) => s.setCanvasWidth)
  const setCanvasMinimized = useUiStore((s) => s.setCanvasMinimized)
  const activeCanvasTab = useUiStore((s) => s.activeCanvasTab)
  const todos = useTaskStore((s) => s.todos)
  const subagentContent = useChatStore((s) => s.subagentContent)
  const sidebarWidth = useSidebarStore((s) => s.width)
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed)
  const changeOpsCount = useFileOpsStore((s) => s.fileOps.filter((op) => op.type === 'write' || op.type === 'edit').length)
  const fileBrowserCount = useFileBrowserStore((s) => s.tabs.length)

  const hasRunning = Object.values(subagentContent || {}).some((blocks) =>
    blocks.some((b) => b.type === 'tool_use' && (b.status === 'running' || !b.status))
  )
  const todoTotal = todos ? todos.length : 0
  const todoCompleted = todos ? todos.filter((t) => t.status === 'completed').length : 0

  const [canvasMax, setCanvasMax] = useState(() => getCanvasMax(sidebarWidth, sidebarCollapsed))

  // Re-budget on window resize and on sidebar width/collapse changes.
  useEffect(() => {
    const update = () => {
      const sb = useSidebarStore.getState()
      setCanvasMax(getCanvasMax(sb.width, sb.collapsed))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [sidebarWidth, sidebarCollapsed])

  // Clamp DOWNWARD only — never grow the canvas automatically, which would
  // feed back into another resize.
  useEffect(() => {
    if (canvasWidth > canvasMax) setCanvasWidth(canvasMax)
  }, [canvasMax, canvasWidth, setCanvasWidth])

  const { dragging, onMouseDown } = useResizable({
    initial: canvasWidth,
    min: CANVAS_MIN_WIDTH,
    max: canvasMax,
    direction: 'left',
    onResize: setCanvasWidth,
  })

  if (!canvasVisible) return null

  // Minimized rail
  if (canvasMinimized) {
    const label = activeCanvasTab === 'plan'
      ? 'PLAN'
      : activeCanvasTab === 'file-browser'
        ? `${fileBrowserCount}F`
        : activeCanvasTab === 'changes' || activeCanvasTab === 'files'
          ? `${changeOpsCount}Δ`
        : activeCanvasTab === 'browser'
          ? 'WEB'
        : `${todoCompleted}/${todoTotal}`
    return (
      <div
        className="flex flex-col items-center justify-center flex-shrink-0"
        role="button"
        tabIndex={0}
        aria-label={t('canvas.expand')}
        style={{
          width: 40,
          height: '100%',
          minHeight: 0,
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          cursor: 'pointer',
          animation: hasRunning ? 'pulse-border 1.5s ease infinite' : 'none',
          borderLeftColor: hasRunning ? 'var(--purple)' : undefined,
        }}
        onClick={() => setCanvasMinimized(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCanvasMinimized(false)
          }
        }}
        title={t('canvas.expand')}
      >
        <span
          className="text-xs font-semibold"
          style={{
            color: 'var(--text-secondary)',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
          }}
        >
          {label}
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 relative"
      style={{
        width: canvasWidth,
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        transition: dragging ? 'none' : 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          background: dragging ? 'var(--blue)' : 'transparent',
          transition: 'background 100ms ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = 'var(--blue)' }}
        onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent' }}
      />

      <CanvasHeader />

      <ErrorBoundary resetKey={activeCanvasTab} compact>
        {activeCanvasTab === 'file-browser' ? (
          <FileBrowserPanel />
        ) : activeCanvasTab === 'changes' || activeCanvasTab === 'files' ? (
          <FileOpsPanel />
        ) : activeCanvasTab === 'plan' ? (
          <PlanReviewPanel />
        ) : activeCanvasTab === 'browser' ? (
          <BrowserDebugPanel />
        ) : (
          // Default inspector view: execution artifacts grouped by conversation turn.
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <SubagentInspector />
          </div>
        )}
      </ErrorBoundary>
    </div>
  )
}
