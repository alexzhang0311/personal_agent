import { useEffect } from 'react'
import useSidebarStore from '../../stores/sidebarStore'
import useMcpStore from '../../stores/mcpStore'
import { useResizable } from '../../hooks/useResizable'
import SidebarResizer from '../layout/SidebarResizer'
import MCPListSidebar from './MCPListSidebar'
import MCPServerMeta from './MCPServerMeta'
import MCPServerDetail from './MCPServerDetail'
import MCPToolDrawer from './MCPToolDrawer'
import MCPAddDialog from './MCPAddDialog'
import { useTranslation } from 'react-i18next'

export default function MCPPanel() {
  const { t } = useTranslation()
  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const fetchServers = useMcpStore((s) => s.fetchServers)
  const selectedServer = useMcpStore((s) => s.selectedServer)
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const addDialogOpen = useMcpStore((s) => s.addDialogOpen)
  const toolDrawerWidth = useMcpStore((s) => s.toolDrawerWidth)
  const setToolDrawerWidth = useMcpStore((s) => s.setToolDrawerWidth)

  const effectiveWidth = collapsed ? 48 : width
  const toolDrawerOpen = !!selectedTool

  const { dragging: toolDragging, onMouseDown: onToolResizeDown } = useResizable({
    initial: toolDrawerWidth,
    min: 280,
    max: 600,
    direction: 'left',
    onResize: setToolDrawerWidth,
  })

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  return (
    <>
      {/* Sidebar — server list */}
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
        <MCPListSidebar />
        {!collapsed && <SidebarResizer />}
      </aside>

      {/* Content area */}
      <div
        className="flex"
        style={{
          position: 'fixed',
          top: 'var(--navbar-height)',
          left: effectiveWidth,
          right: 0,
          bottom: 0,
          transition: 'left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        }}
      >
        {selectedServer ? (
          <>
            <MCPServerMeta />

            {/* Server detail — shrinks when tool drawer is open */}
            <div
              className="flex-1 flex overflow-hidden"
              style={{ minWidth: 0 }}
            >
              <div
                className="flex-1 overflow-hidden"
                style={{ minWidth: 0 }}
              >
                <MCPServerDetail />
              </div>

              {/* Tool drawer — slides in from right, resizable */}
              <div
                className="relative flex-shrink-0 overflow-hidden"
                style={{
                  width: toolDrawerOpen ? toolDrawerWidth : 0,
                  maxWidth: '100vw',
                  borderLeft: toolDrawerOpen ? '1px solid var(--border)' : 'none',
                  transition: toolDragging ? 'none' : 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {toolDrawerOpen && (
                  <>
                    {/* Resize handle on left edge */}
                    <div
                      onMouseDown={onToolResizeDown}
                      style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                        cursor: 'col-resize',
                        background: toolDragging ? 'var(--blue)' : 'transparent',
                        transition: 'background 100ms ease', zIndex: 10,
                      }}
                      onMouseEnter={(e) => { if (!toolDragging) e.currentTarget.style.background = 'var(--blue)' }}
                      onMouseLeave={(e) => { if (!toolDragging) e.currentTarget.style.background = 'transparent' }}
                    />
                    <div style={{ width: toolDrawerWidth, height: '100%' }}>
                      <MCPToolDrawer />
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ background: 'var(--bg-base)', color: 'var(--text-dim)', fontSize: 13 }}
          >
            {t('mcp.selectServer')}
          </div>
        )}
      </div>

      {/* Add/Edit dialog */}
      {addDialogOpen && <MCPAddDialog />}
    </>
  )
}
