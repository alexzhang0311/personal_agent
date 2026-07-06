import { useRef, useState, useEffect } from 'react'
import { Search, Plus, PanelLeftClose, PanelLeft, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useMcpStore from '../../stores/mcpStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import SettingsPopover from '../settings/SettingsPopover'

export default function MCPListSidebar() {
  const { t } = useTranslation()
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const authUser = useAuthStore((s) => s.user)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)

  const servers = useMcpStore((s) => s.servers)
  const serversLoading = useMcpStore((s) => s.serversLoading)
  const searchQuery = useMcpStore((s) => s.searchQuery)
  const setSearchQuery = useMcpStore((s) => s.setSearchQuery)
  const levelFilter = useMcpStore((s) => s.levelFilter)
  const setLevelFilter = useMcpStore((s) => s.setLevelFilter)
  const selectedServer = useMcpStore((s) => s.selectedServer)
  const selectServer = useMcpStore((s) => s.selectServer)
  const openAddDialog = useMcpStore((s) => s.openAddDialog)

  const addBtnRef = useRef(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  const isAdmin = authUser?.role === 'admin'

  useEffect(() => {
    if (!showAddMenu) return
    const handler = (e) => {
      if (addBtnRef.current && !addBtnRef.current.contains(e.target)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAddMenu])

  const handleAddClick = () => {
    if (isAdmin) {
      setShowAddMenu((v) => !v)
    } else {
      openAddDialog('project')
    }
  }

  const filteredServers = servers.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLevel = levelFilter === 'all' || s.level === levelFilter
    return matchesSearch && matchesLevel
  })

  const projectServers = filteredServers.filter((s) => s.level === 'project')
  const globalServers = filteredServers.filter((s) => s.level === 'global')

  if (collapsed) {
    return (
      <div className="flex flex-col items-center flex-1 p-2">
        <button
          style={{
            width: 32, height: 32, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
            transition: 'color 150ms ease',
          }}
          onClick={() => openAddDialog('project')}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('mcp.addServer')}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
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
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <button
            style={{
              width: 28, height: 28, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onClick={toggleCollapsed}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            title={t('sidebar.expand')}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <div
        className="px-3 py-2 uppercase font-semibold flex-shrink-0"
        style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 14, borderBottom: '1px solid var(--border-subtle)' }}
      >
        {t('tabs.mcp')}
      </div>

      {/* Search + Add */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className="flex items-center gap-1 flex-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            className="flex-1"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', minWidth: 0, fontSize: 13,
            }}
            placeholder={t('mcp.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div ref={addBtnRef} className="relative">
          <button
            className="flex items-center justify-center"
            style={{
              width: 28, height: 28, background: 'transparent',
              border: '1px solid var(--border)', borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-dim)', transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleAddClick}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            title={t('mcp.addServer')}
          >
            <Plus size={12} strokeWidth={1.5} />
          </button>
          {showAddMenu && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
                borderRadius: 4, padding: '4px 0', zIndex: 50, minWidth: 160,
              }}
            >
              <button
                className="flex items-center gap-2 w-full px-3 py-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => { setShowAddMenu(false); openAddDialog('project') }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t('mcp.addProjectServer')}
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--green)', fontSize: 13, textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => { setShowAddMenu(false); openAddDialog('global') }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t('mcp.addGlobalServer')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Level filter chips */}
      <div className="flex items-center gap-1 px-3 py-1">
        {['all', 'project', 'global'].map((level) => {
          const isActive = levelFilter === level
          const label = level === 'all' ? t('sidebar.all') : level === 'project' ? t('mcp.project') : t('mcp.global')
          return (
            <button
              key={level}
              className="px-2 py-1 uppercase"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                border: isActive ? '1px solid var(--border-strong)' : '1px solid transparent',
                borderRadius: 4, cursor: 'pointer',
                color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
              }}
              onClick={() => setLevelFilter(level)}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' } }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto py-1">
        {serversLoading ? (
          <div className="flex flex-col gap-1 px-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
            ))}
          </div>
        ) : (
          <>
            {projectServers.length > 0 && (
              <>
                <div className="px-3 py-1 uppercase font-semibold" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 12 }}>
                  {t('mcp.project')}
                </div>
                {projectServers.map((srv) => (
                  <ServerItem
                    key={`project-${srv.name}`}
                    server={srv}
                    isActive={selectedServer?.level === 'project' && selectedServer?.name === srv.name}
                    onClick={() => selectServer('project', srv.name)}
                  />
                ))}
              </>
            )}
            {globalServers.length > 0 && (
              <>
                <div
                  className="px-3 py-1 uppercase text-xs font-semibold"
                  style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', marginTop: projectServers.length > 0 ? 8 : 0 }}
                >
                  {t('mcp.global')}
                </div>
                {globalServers.map((srv) => (
                  <ServerItem
                    key={`global-${srv.name}`}
                    server={srv}
                    isActive={selectedServer?.level === 'global' && selectedServer?.name === srv.name}
                    onClick={() => selectServer('global', srv.name)}
                  />
                ))}
              </>
            )}
            {filteredServers.length === 0 && (
              <div className="px-3 py-4" style={{ color: 'var(--text-dim)', textAlign: 'center', fontSize: 13 }}>
                {t('mcp.noServers')}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom: Settings + Toggle */}
      <div
        className="p-2 flex items-center"
        style={{ borderTop: '1px solid var(--border-subtle)', justifyContent: 'space-between' }}
      >
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
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            title={t('sidebar.settings')}
          >
            <Settings size={14} strokeWidth={1.5} />
            <span>{t('sidebar.settings')}</span>
          </button>
        </div>
        <button
          style={{
            width: 28, height: 28, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
            transition: 'color 150ms ease, background 150ms ease',
          }}
          onClick={toggleCollapsed}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
          title={t('sidebar.collapse')}
        >
          <PanelLeftClose size={16} strokeWidth={1.5} />
        </button>
      </div>
    </>
  )
}

function ServerItem({ server, isActive, onClick }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'background 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <span
        className="truncate flex-1"
        style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 14 }}
      >
        {server.name}
      </span>
      <span
        className="uppercase flex-shrink-0 px-1"
        style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
          color: server.type === 'http' ? 'var(--cyan)' : 'var(--purple)',
          border: `1px solid ${server.type === 'http' ? 'var(--cyan)' : 'var(--purple)'}`,
          borderRadius: 2, lineHeight: '16px',
        }}
      >
        {server.type}
      </span>
    </div>
  )
}
