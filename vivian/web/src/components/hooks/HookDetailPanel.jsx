import { Webhook, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useHooksStore from '../../stores/hooksStore'
import { HOOK_DEFINITIONS, PHASE_COLORS } from '../../data/hookDefinitions'
import Chip from '../shared/Chip'
import HookConfigTab from './HookConfigTab'
import HookTestTab from './HookTestTab'
import HookLogsTab from './HookLogsTab'
import Tabs from '../shared/Tabs'

const TABS = ['config', 'test', 'logs']

const hookMap = Object.fromEntries(HOOK_DEFINITIONS.map(h => [h.id, h]))

export default function HookDetailPanel() {
  const { t } = useTranslation()
  const selectedHookId = useHooksStore((s) => s.selectedHookId)
  const activeDetailTab = useHooksStore((s) => s.activeDetailTab)
  const setDetailTab = useHooksStore((s) => s.setDetailTab)
  const clearSelection = useHooksStore((s) => s.clearSelection)
  const configuredHooks = useHooksStore((s) => s.configuredHooks)

  const hook = selectedHookId ? hookMap[selectedHookId] : null

  if (!hook) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ color: 'var(--text-dim)' }}
      >
        <div className="flex flex-col items-center gap-2" style={{ textAlign: 'center' }}>
          <Webhook size={32} strokeWidth={1.5} />
          <div style={{ fontSize: 13 }}>{t('hooks.selectHook')}</div>
          <div style={{ fontSize: 12 }}>{t('hooks.selectHookHint')}</div>
        </div>
      </div>
    )
  }

  const entries = configuredHooks[hook.id] || []
  const handlerCount = entries.reduce((sum, e) => sum + (e.hooks?.length || 0), 0)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <span className="flex-1" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
            {hook.id}
          </span>
          <Chip color={PHASE_COLORS[hook.phase]}>
            {hook.phase.toUpperCase()}
          </Chip>
          {hook.canBlock && <Chip color="var(--red)">{t('hooks.block')}</Chip>}
          <button
            style={{
              width: 24, height: 24, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              transition: 'color 150ms ease',
              flexShrink: 0,
            }}
            onClick={clearSelection}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {t(hook.descriptionKey)}
        </div>
        {hook.matcherTarget && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
            {t('hooks.matcherTarget')}: <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{hook.matcherTarget}</span>
          </div>
        )}
        {handlerCount > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
            {t('hooks.handlersCount', { count: handlerCount })}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div
        className="flex px-4 gap-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Tabs
          tabs={TABS.map((tab) => ({ id: tab, label: t(`hooks.${tab}Tab`) }))}
          activeKey={activeDetailTab}
          onChange={(_, tab) => setDetailTab(tab.id)}
          className="flex gap-4"
          buttonClassName="uppercase font-semibold"
          buttonStyle={{
            padding: '8px 0',
            fontSize: 11,
            letterSpacing: '0.06em',
          }}
          getButtonStyle={({ active, hovered }) => ({
            color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-dim)',
          })}
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeDetailTab === 'config' && <HookConfigTab hookId={selectedHookId} />}
        {activeDetailTab === 'test' && <HookTestTab hookId={selectedHookId} />}
        {activeDetailTab === 'logs' && <HookLogsTab hookId={selectedHookId} />}
      </div>
    </div>
  )
}
