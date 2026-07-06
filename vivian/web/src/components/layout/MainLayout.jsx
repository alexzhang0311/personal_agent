import { lazy, Suspense } from 'react'
import Sidebar from './Sidebar'
import ChatPanel from '../chat/ChatPanel'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'

const CanvasPanel = lazy(() => import('./CanvasPanel'))
const UserDataPanel = lazy(() => import('../userdata/UserDataPanel'))
const SkillsPanel = lazy(() => import('../skills/SkillsPanel'))
const MCPPanel = lazy(() => import('../mcp/MCPPanel'))
const SchedulerPanel = lazy(() => import('../scheduler/SchedulerPanel'))
const HooksPanel = lazy(() => import('../hooks/HooksPanel'))
const SubAgentsPanel = lazy(() => import('../subagents/SubAgentsPanel'))
const WebTerminalDrawer = lazy(() => import('../terminal/WebTerminalDrawer'))

function LazyPanel({ children }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />}>
      {children}
    </Suspense>
  )
}

export default function MainLayout() {
  const sidebarWidth = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const activeNavTab = useUiStore((s) => s.activeNavTab)
  const canvasVisible = useUiStore((s) => s.canvasVisible)
  const terminalOpen = useUiStore((s) => s.terminalOpen)

  if (activeNavTab === 'userdata') {
    return <LazyPanel><UserDataPanel /></LazyPanel>
  }

  if (activeNavTab === 'skills') {
    return <LazyPanel><SkillsPanel /></LazyPanel>
  }

  if (activeNavTab === 'mcp') {
    return <LazyPanel><MCPPanel /></LazyPanel>
  }

  if (activeNavTab === 'scheduler') {
    return <LazyPanel><SchedulerPanel /></LazyPanel>
  }

  if (activeNavTab === 'hooks') {
    return <LazyPanel><HooksPanel /></LazyPanel>
  }

  if (activeNavTab === 'subagents') {
    return <LazyPanel><SubAgentsPanel /></LazyPanel>
  }

  const effectiveSidebarWidth = collapsed ? 48 : sidebarWidth

  return (
    <div
      className="flex flex-col flex-1"
      style={{
        marginTop: 'var(--navbar-height)',
        marginLeft: effectiveSidebarWidth,
        transition: 'margin-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        height: 'calc(100vh - var(--navbar-height))',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <div
        className="flex"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Sidebar />
        <ChatPanel />
        {canvasVisible && (
          <Suspense fallback={null}>
            <CanvasPanel />
          </Suspense>
        )}
      </div>
      {terminalOpen && (
        <Suspense fallback={null}>
          <WebTerminalDrawer />
        </Suspense>
      )}
    </div>
  )
}
