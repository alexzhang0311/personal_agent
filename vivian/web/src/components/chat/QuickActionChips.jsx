import { useEffect } from 'react'
import useSettingsStore from '../../stores/settingsStore'
import useChatStore from '../../stores/chatStore'
import { getLucideIcon } from '../../utils/lucideIconMap'

export default function QuickActionChips() {
  const quickActions = useSettingsStore((s) => s.quickActions)
  const fetchQuickActions = useSettingsStore((s) => s.fetchQuickActions)
  const setInputText = useChatStore((s) => s.setInputText)
  const setQuickActionVariableMode = useChatStore((s) => s.setQuickActionVariableMode)

  useEffect(() => {
    fetchQuickActions()
  }, [fetchQuickActions])

  if (quickActions.length === 0) return null

  // Max 4 columns x 3 rows = 12 items
  const visibleActions = quickActions.slice(0, 12)

  return (
    <div
      className="grid gap-2 px-4"
      style={{
        maxWidth: 900,
        width: '80%',
        margin: '0 auto',
        // auto-fit lets columns collapse on narrow windows instead of
        // forcing a fixed track width that overflows horizontally.
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 240px))',
        justifyContent: 'center',
      }}
    >
      {visibleActions.map((action, i) => {
        const Icon = getLucideIcon(action.icon)
        const preview = action.prompt && action.prompt.length > 30
          ? action.prompt.slice(0, 28) + '...'
          : action.prompt
        return (
          <button
            key={`${action.name}-${i}`}
            className="flex items-center gap-2 px-3 py-2 text-xs min-w-0"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 12,
              fontWeight: 400,
              transition: 'border-color 150ms ease, background 150ms ease',
              textAlign: 'left',
            }}
            onClick={() => {
              setInputText(action.prompt)
              setQuickActionVariableMode(true)
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.background = 'var(--bg-surface)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
          >
            <Icon size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <div className="flex flex-col justify-center gap-0 min-w-0">
              <span className="truncate" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{action.name}</span>
              {preview && (
                <span
                  className="truncate"
                  style={{
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    fontWeight: 300,
                  }}
                >
                  {preview}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
