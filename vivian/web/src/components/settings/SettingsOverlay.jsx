import { lazy, Suspense, useEffect, useCallback, useMemo } from 'react'
import { Key, Cpu, Zap, Settings2, ScrollText, Radio, Puzzle, User, X, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'
import useSidebarStore from '../../stores/sidebarStore'
import useAuthStore from '../../stores/authStore'
import Tabs from '../shared/Tabs'

const SettingsPanel = lazy(() => import('./SettingsPanel'))

const BASE_TABS = [
  { id: 'account', labelKey: 'settings.account', icon: User },
  { id: 'api', labelKey: 'settings.apiKey', icon: Key },
  { id: 'models', labelKey: 'settings.llmProvider', icon: Cpu },
  { id: 'quickactions', labelKey: 'settings.quickActions', icon: Zap },
  { id: 'channels', labelKey: 'settings.channels', icon: Radio },
  { id: 'advanced', labelKey: 'settings.advanced', icon: Settings2 },
]

export default function SettingsOverlay() {
  const { t } = useTranslation()
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const activeTab = useUiStore((s) => s.settingsActiveTab)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const setSettingsActiveTab = useUiStore((s) => s.setSettingsActiveTab)
  const sidebarWidth = useSidebarStore((s) => s.width)
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed)
  const user = useAuthStore((s) => s.user)

  const tabs = useMemo(() => {
    const result = [...BASE_TABS]
    if (user?.role === 'admin') {
      result.push({ id: 'systemprompt', labelKey: 'settings.runtime', icon: ScrollText })
      result.push({ id: 'plugins', labelKey: 'settings.plugins', icon: Puzzle })
      result.push({ id: 'webterminal', labelKey: 'settings.webTerminal.title', icon: Terminal })
    }
    return result
  }, [user?.role])

  const effectiveSidebarWidth = sidebarCollapsed ? 48 : sidebarWidth

  const handleEscape = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSettings() }
  }, [closeSettings])

  useEffect(() => {
    if (!settingsOpen) return
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [settingsOpen, handleEscape])

  if (!settingsOpen) return null

  return (
    <div
      className="fixed inset-0"
      style={{
        zIndex: 200,
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={closeSettings}
    >
      {/* Content area — to the right of sidebar */}
      <div
        className="flex"
        style={{
          position: 'absolute',
          top: 'var(--navbar-height)',
          left: effectiveSidebarWidth,
          right: 0,
          bottom: 0,
          background: 'var(--bg-base)',
          transition: 'left 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <div
          className="flex flex-col flex-shrink-0"
          style={{
            width: 280,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          {/* Title */}
          <h3
            className="font-bold px-6"
            style={{
              color: 'var(--text-primary)',
              fontSize: 16,
              margin: 0,
              paddingTop: 24,
              paddingBottom: 16,
            }}
          >
            {t('sidebar.settings')}
          </h3>
          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', marginLeft: 24, marginRight: 24, marginBottom: 12 }} />

          <Tabs
            tabs={tabs}
            activeKey={activeTab}
            onChange={(_, tab) => setSettingsActiveTab(tab.id)}
            variant="left-border"
            className="flex flex-col"
            buttonClassName="flex items-center gap-3 px-6 py-3"
            buttonStyle={{
              width: '100%',
              borderLeft: '2px solid transparent',
              fontSize: 14,
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
            getButtonStyle={({ active, hovered }) => ({
              background: active || hovered ? 'var(--bg-elevated)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: active ? 600 : 400,
            })}
            renderLabel={(tab, _, active) => (
              <span className="flex items-center gap-3">
                <tab.icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                {t(tab.labelKey)}
              </span>
            )}
          />
        </div>

        {/* Right content */}
        <div
          className="flex-1 flex flex-col relative"
          style={{ background: 'var(--bg-base)' }}
        >
          {/* Close button */}
          <button
            className="absolute"
            style={{
              top: 24,
              right: 24,
              zIndex: 3,
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
            onClick={closeSettings}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>

          {/* Fixed header: page title */}
          <div style={{ padding: '52px 24px 0', flexShrink: 0 }}>
            <div style={{ width: '100%', maxWidth: 800, margin: '0 auto' }}>
              <h2
                className="font-bold"
                style={{ color: 'var(--text-primary)', fontSize: 20, margin: '0 0 24px', lineHeight: 1.2 }}
              >
                {t(tabs.find((tab) => tab.id === activeTab)?.labelKey)}
              </h2>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '0 24px 40px' }}>
            <div style={{ width: '100%', maxWidth: 800, margin: '0 auto' }}>
              <Suspense fallback={<div className="skeleton" style={{ height: 120, width: '100%' }} />}>
                <SettingsPanel activeTabOverride={activeTab} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
