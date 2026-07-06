import { BarChart3, ScrollText, FileText, FolderOpen, Users, PanelLeftClose, PanelLeft, Settings, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUserDataStore from '../../stores/userDataStore'
import useSidebarStore from '../../stores/sidebarStore'
import useUiStore from '../../stores/uiStore'
import useAuthStore from '../../stores/authStore'
import SidebarResizer from '../layout/SidebarResizer'
import SettingsPopover from '../settings/SettingsPopover'
import UserUsage from './UserUsage'
import UserAuditLog from './UserAuditLog'
import AuditLog from '../admin/AuditLog'
import UserAnalytics from './UserAnalytics'
import UserFiles from './UserFiles'
import UserManagement from '../admin/UserManagement'
import FileManagerTab from '../settings/FileManagerTab'
import UserEditDrawer from '../admin/UserEditDrawer'
import useAdminStore from '../../stores/adminStore'

export default function UserDataPanel() {
  const { t } = useTranslation()
  const activeSection = useUserDataStore((s) => s.activeSection)
  const setActiveSection = useUserDataStore((s) => s.setActiveSection)
  const authUser = useAuthStore((s) => s.user)
  const isAdmin = authUser?.role === 'admin'
  const drawerOpen = useAdminStore((s) => s.drawerOpen)

  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)

  const effectiveWidth = collapsed ? 48 : width

  const sectionGroups = [
    {
      title: t('userData.statisticsGroup'),
      items: [
        { id: 'usage', icon: BarChart3, labelKey: 'userData.usage' },
        { id: 'analytics', icon: TrendingUp, labelKey: 'userData.analytics' },
        { id: 'audit', icon: ScrollText, labelKey: 'userData.auditLog' },
      ],
    },
    {
      title: t('userData.filesGroup'),
      items: [
        { id: 'files', icon: FileText, labelKey: 'userData.uploadedFiles' },
        { id: 'fileexplorer', icon: FolderOpen, labelKey: 'userData.fileExplorer' },
      ],
    },
    ...(isAdmin
      ? [{
          title: t('userData.adminGroup'),
          items: [
            { id: 'users', icon: Users, labelKey: 'admin.users' },
          ],
        }]
      : []),
  ]

  const allItems = sectionGroups.flatMap((g) => g.items)

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
          transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 p-2 flex-1">
            {allItems.map((item) => {
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  style={{
                    width: 32,
                    height: 32,
                    background: 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 150ms ease',
                  }}
                  onClick={() => setActiveSection(item.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--text-dim)'
                  }}
                  title={t(item.labelKey)}
                >
                  <item.icon size={13} strokeWidth={1.5} />
                </button>
              )
            })}
            <div className="flex-1" />
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
            {/* Header */}
            <div
              className="px-3 py-3 uppercase font-semibold"
              style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 13 }}
            >
              {t('tabs.userData')}
            </div>

            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />

            {/* Section groups */}
            <div className="flex-1 overflow-y-auto py-1">
              {sectionGroups.map((group, gi) => (
                <div key={gi}>
                  {/* Group title */}
                  <div
                    className="px-3 py-2 uppercase font-semibold"
                    style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 11 }}
                  >
                    {group.title}
                  </div>

                  {/* Group items */}
                  {group.items.map((item) => {
                    const isActive = activeSection === item.id
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 px-3 py-2"
                        style={{
                          background: isActive ? 'var(--bg-elevated)' : 'transparent',
                          borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: 13,
                          transition: 'background 150ms ease',
                        }}
                        onClick={() => setActiveSection(item.id)}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <item.icon size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
                        <span className="flex-1 truncate">{t(item.labelKey)}</span>
                      </div>
                    )
                  })}

                  {/* Divider between groups */}
                  {gi < sectionGroups.length - 1 && (
                    <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 12px' }} />
                  )}
                </div>
              ))}
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
          {!collapsed && (
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
          )}
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
        className="flex flex-1"
        style={{
          marginTop: 'var(--navbar-height)',
          marginLeft: effectiveWidth,
          transition: 'margin-left 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          height: 'calc(100vh - var(--navbar-height))',
          overflow: 'hidden',
        }}
      >
        <div className="flex-1 flex flex-col" style={{ background: 'var(--bg-base)', fontSize: 16, minHeight: 0, overflow: 'hidden' }}>
          {activeSection === 'usage' && <UserUsage />}
          {activeSection === 'analytics' && <UserAnalytics />}
          {activeSection === 'audit' && (isAdmin ? <AuditLog /> : <UserAuditLog />)}
          {activeSection === 'files' && <UserFiles />}
          {activeSection === 'fileexplorer' && <FileManagerTab />}
          {activeSection === 'users' && isAdmin && <UserManagement />}
        </div>
      </div>

      {/* User edit drawer (admin only) */}
      {drawerOpen && isAdmin && <UserEditDrawer />}
    </>
  )
}
