import { Minus, X, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import { RollingInteger } from '../shared/Odometer'
import Tabs from '../shared/Tabs'

function CountedTabLabel({ label, count }) {
  if (!count) return label
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, lineHeight: '12px' }}>
      <span>{label}</span>
      <span>(</span>
      <RollingInteger value={count} height={11} color="currentColor" fontSize={11} fontWeight={600} verticalAlign="middle" />
      <span>)</span>
    </span>
  )
}

export default function CanvasHeader() {
  const { t } = useTranslation()
  const canvasWidth = useUiStore((s) => s.canvasWidth)
  const compact = canvasWidth < 380
  const toggleCanvasMinimized = useUiStore((s) => s.toggleCanvasMinimized)
  const hideCanvas = useUiStore((s) => s.hideCanvas)
  const activeCanvasTab = useUiStore((s) => s.activeCanvasTab)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)
  const fileBrowserCount = useFileBrowserStore((s) => s.tabs.length)
  const changeOpsCount = useFileOpsStore((s) => s.fileOps.filter((op) => op.type === 'write' || op.type === 'edit').length)
  const hasPlan = useUiStore((s) => !!s.planContent)
  const tabItems = [
    { id: 'tasks', label: t('canvas.inspector', 'INSPECTOR') },
    { id: 'file-browser', label: <CountedTabLabel label={t('canvas.fileBrowser', 'File Browser')} count={fileBrowserCount} /> },
    { id: 'changes', label: <CountedTabLabel label={t('canvas.changeReview', 'Change Review')} count={changeOpsCount} /> },
    ...(hasPlan ? [{ id: 'plan', label: t('canvas.plan') }] : []),
    { id: 'browser', label: t('canvas.browserTab', 'BROWSER') },
  ]
  const activeTabKey = activeCanvasTab === 'files' ? 'changes' : activeCanvasTab

  return (
    <div
      className={`flex items-center justify-between flex-shrink-0 ${compact ? 'px-2' : 'px-3'}`}
      style={{
        height: 40,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}
    >
      <div className={`flex items-center min-w-0 flex-1 overflow-x-auto scrollbar-hidden ${compact ? 'gap-2' : 'gap-4'}`}>
        <GripVertical size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <Tabs
          tabs={tabItems}
          activeKey={activeTabKey}
          onChange={(_, tab) => setActiveCanvasTab(tab.id)}
          className={`flex items-center ${compact ? 'gap-2' : 'gap-4'}`}
          style={{ height: '100%' }}
          buttonStyle={{
            height: 40,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '16px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          getButtonStyle={({ active }) => ({
            color: active ? 'var(--text-primary)' : 'var(--text-dim)',
          })}
        />
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
            transition: 'color 150ms ease',
          }}
          onClick={toggleCanvasMinimized}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('canvas.minimize')}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
            transition: 'color 150ms ease',
          }}
          onClick={hideCanvas}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('canvas.close')}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
