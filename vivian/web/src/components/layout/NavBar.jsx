import { Moon, Sun, Globe, Bot, Puzzle, Cable, Clock, Brain, Box, LogOut, Webhook, UsersRound, Lightbulb, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Chip from '../shared/Chip'
import Tabs from '../shared/Tabs'
import useUiStore from '../../stores/uiStore'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'

export default function NavBar() {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const language = useUiStore((s) => s.language)
  const toggleLanguage = useUiStore((s) => s.toggleLanguage)
  const activeNavTab = useUiStore((s) => s.activeNavTab)
  const setActiveNavTab = useUiStore((s) => s.setActiveNavTab)
  const sessionId = useChatStore((s) => s.sessionId)
  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const openIntro = useUiStore((s) => s.openIntro)
  const terminalOpen = useUiStore((s) => s.terminalOpen)
  const toggleTerminal = useUiStore((s) => s.toggleTerminal)
  const terminalFeatureEnabled = useUiStore((s) => s.terminalFeatureEnabled)
  const terminalSessionActive = useUiStore((s) => s.terminalSessionActive)
  const terminalActiveCount = useUiStore((s) => s.terminalActiveCount) || (terminalSessionActive ? 1 : 0)
  const tabs = [
    { id: 'vivian', label: t('tabs.vivian'), icon: Bot },
    { id: 'skills', label: t('tabs.skills'), icon: Puzzle, disabled: false },
    { id: 'mcp', label: t('tabs.mcp'), icon: Cable },
    { id: 'scheduler', label: t('tabs.scheduler'), icon: Clock },
    { id: 'hooks', label: t('tabs.hooks'), icon: Webhook },
    { id: 'subagents', label: t('tabs.subagents'), icon: UsersRound },
    { id: 'memory', label: t('tabs.memory'), icon: Brain, disabled: true },
    { id: 'userdata', label: t('tabs.userData'), icon: Box },
  ]

  return (
    <nav
      className="fixed top-0 left-0 right-0 flex items-center justify-between px-4"
      style={{
        height: 'var(--navbar-height)',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        zIndex: 100,
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Bot size={30} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
        <span className="font-bold text-xl" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em', fontSize: 22 }}>
          {t('brand.title')}
        </span>
      </div>

      {/* Center Tabs */}
      <Tabs
        tabs={tabs.filter((tab) => !tab.hidden)}
        activeKey={activeNavTab}
        onChange={(_, tab) => setActiveNavTab(tab.id)}
        variant="frame"
        className="flex items-center gap-1"
        buttonClassName="text-md rounded"
        buttonStyle={{
          border: '1px solid transparent',
          borderRadius: '4px',
          padding: '8px 12px',
        }}
        getButtonStyle={({ active, hovered, disabled }) => ({
          background: hovered && !active && !disabled ? 'var(--bg-elevated)' : 'transparent',
          color: active
            ? 'var(--text-primary)'
            : disabled
              ? 'var(--text-dim)'
              : hovered
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
        })}
        renderLabel={(tab) => (
          <span className="flex items-center gap-2">
            <tab.icon size={16} strokeWidth={1.5} />
            <span className="hidden" style={{ display: 'inline' }}>{tab.label}</span>
          </span>
        )}
      />

      {/* Right: stats + controls */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {terminalFeatureEnabled && (
          <button
            onClick={toggleTerminal}
            title={terminalActiveCount > 0
              ? t('terminal.openWithCount', { count: terminalActiveCount })
              : t('terminal.open')}
            style={{
              position: 'relative',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: terminalOpen || terminalActiveCount > 0 ? 'var(--red)' : 'var(--text-dim)',
              transition: 'color 150ms ease',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = terminalOpen || terminalActiveCount > 0
                ? 'var(--red)'
                : 'var(--text-dim)'
            }}
          >
            <SquareTerminal size={16} strokeWidth={1.5} />
            {terminalActiveCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  minWidth: 14,
                  height: 14,
                  padding: '0 3px',
                  borderRadius: 4,
                  background: 'var(--red)',
                  color: 'var(--text-inverse)',
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: '14px',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              >
                {terminalActiveCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={openIntro}
          title="Intro"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-dim)', transition: 'color 150ms ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--yellow)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <Lightbulb size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={toggleTheme}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-dim)', transition: 'color 150ms ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          {theme === 'dark'
            ? <Sun size={16} strokeWidth={1.5} />
            : <Moon size={16} strokeWidth={1.5} />}
        </button>
        <button
          className="flex items-center gap-1 text-xs"
          onClick={toggleLanguage}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-dim)', transition: 'color 150ms ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <Globe size={14} strokeWidth={1.5} />
          <span>{language.toUpperCase()}</span>
        </button>
        {authUser && (
          <span className="text-md" style={{ color: 'var(--text-secondary)' }}>{authUser.username}</span>
        )}
        {authUser && authUser.role === 'admin' && (
          <Chip color="var(--green)">ADMIN</Chip>
        )}
        <button
          onClick={logout}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-dim)', transition: 'color 150ms ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title="Sign out"
        >
          <LogOut size={14} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  )
}
