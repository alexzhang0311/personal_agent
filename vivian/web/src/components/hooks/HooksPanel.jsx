import { useRef, useState, useEffect, useCallback } from 'react'
import { PanelLeftClose, PanelLeft, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'
import useHooksStore from '../../stores/hooksStore'
import { useResizable } from '../../hooks/useResizable'
import SidebarResizer from '../layout/SidebarResizer'
import SettingsPopover from '../settings/SettingsPopover'
import HooksSidebar from './HooksSidebar'
import LifecycleGraph from './LifecycleGraph'
import HookDetailPanel from './HookDetailPanel'

const MIN_DETAIL_WIDTH = 280

export default function HooksPanel() {
  const { t } = useTranslation()
  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)
  const selectedHookId = useHooksStore((s) => s.selectedHookId)
  const detailWidth = useHooksStore((s) => s.detailWidth)
  const setDetailWidth = useHooksStore((s) => s.setDetailWidth)

  const contentRef = useRef(null)
  const [maxDetailWidth, setMaxDetailWidth] = useState(600)

  // Recalculate max detail width (60% of content area) on resize
  useEffect(() => {
    const update = () => {
      if (contentRef.current) {
        setMaxDetailWidth(Math.floor(contentRef.current.offsetWidth * 0.6))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [collapsed, width])

  // Clamp current detail width if it exceeds new max
  useEffect(() => {
    if (detailWidth > maxDetailWidth) {
      setDetailWidth(maxDetailWidth)
    }
  }, [maxDetailWidth])

  const { dragging: detailDragging, onMouseDown: onDetailResizeDown } = useResizable({
    initial: detailWidth,
    min: MIN_DETAIL_WIDTH,
    max: maxDetailWidth,
    direction: 'left',
    onResize: setDetailWidth,
  })

  const effectiveWidth = collapsed ? 48 : width

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
            <HooksSidebar collapsed />
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
            {/* Header */}
            <div
              className="px-3 py-3 uppercase font-semibold"
              style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 13 }}
            >
              {t('tabs.hooks')}
            </div>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />
            <HooksSidebar collapsed={false} />
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

      {/* Content area — horizontal: graph + detail drawer */}
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
        {/* Graph section (flex: 1) */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0 }}>
          {/* Title bar */}
          <div
            className="flex items-center gap-3 px-4 flex-shrink-0"
            style={{
              height: 48,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span
              className="uppercase font-semibold"
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                letterSpacing: '0.06em',
              }}
            >
              {t('hooks.graphTitle')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {t('hooks.graphSubtitle')}
            </span>
          </div>

          {/* Graph — fills remaining space, zoom/pan handled internally */}
          <div className="flex-1 overflow-hidden">
            <LifecycleGraph />
          </div>
        </div>

        {/* Detail drawer — slides in from right, resizable */}
        <div
          className="relative flex-shrink-0 overflow-hidden"
          style={{
            width: selectedHookId ? detailWidth : 0,
            transition: detailDragging ? 'none' : 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            borderLeft: selectedHookId ? '1px solid var(--border)' : 'none',
          }}
        >
          {/* Resize handle (left edge) */}
          {selectedHookId && (
            <div
              onMouseDown={onDetailResizeDown}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                cursor: 'col-resize',
                background: detailDragging ? 'var(--blue)' : 'transparent',
                transition: 'background 100ms ease',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                if (!detailDragging) e.currentTarget.style.background = 'var(--blue)'
              }}
              onMouseLeave={(e) => {
                if (!detailDragging) e.currentTarget.style.background = 'transparent'
              }}
            />
          )}
          <div
            className="flex flex-col h-full"
            style={{ width: detailWidth }}
          >
            <HookDetailPanel />
          </div>
        </div>
      </div>
    </>
  )
}
