import { useRef, useState, useEffect } from 'react'
import { PanelLeftClose, PanelLeft, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'
import useSubagentsStore from '../../stores/subagentsStore'
import { useResizable } from '../../hooks/useResizable'
import SidebarResizer from '../layout/SidebarResizer'
import SettingsPopover from '../settings/SettingsPopover'
import SubAgentsSidebar from './SubAgentsSidebar'
import SubAgentEditor from './SubAgentEditor'
import SubAgentEmptyState from './SubAgentEmptyState'
import SubAgentTestPanel from './SubAgentTestPanel'

const MIN_TEST_WIDTH = 320

export default function SubAgentsPanel() {
  const { t } = useTranslation()
  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)

  const formDraft = useSubagentsStore((s) => s.formDraft)
  const testWidth = useSubagentsStore((s) => s.testWidth)
  const setTestWidth = useSubagentsStore((s) => s.setTestWidth)

  const contentRef = useRef(null)
  const [maxTestWidth, setMaxTestWidth] = useState(720)

  useEffect(() => {
    const update = () => {
      if (contentRef.current) {
        setMaxTestWidth(Math.floor(contentRef.current.offsetWidth * 0.6))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [collapsed, width])

  useEffect(() => {
    if (testWidth > maxTestWidth) {
      setTestWidth(maxTestWidth)
    }
  }, [maxTestWidth])

  const { dragging: testDragging, onMouseDown: onTestResizeDown } = useResizable({
    initial: testWidth,
    min: MIN_TEST_WIDTH,
    max: maxTestWidth,
    direction: 'left',
    onResize: setTestWidth,
  })

  const effectiveWidth = collapsed ? 48 : width
  const showEditor = !!formDraft

  return (
    <>
      {/* Sidebar */}
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
          <div className="flex flex-col items-center gap-2 p-2 flex-1">
            <SubAgentsSidebar collapsed />
            <div className="flex-1" />
            <div className="relative flex flex-col items-center gap-1">
              <SettingsPopover />
              <button
                style={{
                  width: 32, height: 32, background: 'transparent', border: 'none',
                  borderRadius: '4px', cursor: 'pointer', color: 'var(--text-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            <div
              className="px-3 py-3 uppercase font-semibold"
              style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 13 }}
            >
              {t('tabs.subagents')}
            </div>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />
            <SubAgentsSidebar collapsed={false} />
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
          {!collapsed && (
            <div className="relative">
              <SettingsPopover />
              <button
                className="flex items-center gap-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', padding: '4px 6px', borderRadius: '4px',
                  fontSize: 13, transition: 'color 150ms ease, background 150ms ease',
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
          )}
          <button
            style={{
              width: 28, height: 28, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
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
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            {collapsed
              ? <PanelLeft size={16} strokeWidth={1.5} />
              : <PanelLeftClose size={16} strokeWidth={1.5} />}
          </button>
        </div>

        {!collapsed && <SidebarResizer />}
      </aside>

      {/* Content area */}
      <div
        ref={contentRef}
        className="flex"
        style={{
          marginTop: 'var(--navbar-height)',
          marginLeft: effectiveWidth,
          transition: 'margin-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          height: 'calc(100vh - var(--navbar-height))',
          overflow: 'hidden',
          background: 'var(--bg-base)',
        }}
      >
        {/* Editor / empty middle (flex: 1) */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0 }}>
          {showEditor ? <SubAgentEditor /> : <SubAgentEmptyState />}
        </div>

        {/* Test column — always present, resizable */}
        <div
          className="relative flex-shrink-0 overflow-hidden"
          style={{
            width: testWidth,
            transition: testDragging ? 'none' : 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            borderLeft: '1px solid var(--border)',
          }}
        >
          <div className="flex flex-col h-full" style={{ width: testWidth }}>
            <SubAgentTestPanel onResize={onTestResizeDown} dragging={testDragging} />
          </div>
        </div>
      </div>
    </>
  )
}
