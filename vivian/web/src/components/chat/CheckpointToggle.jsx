import { useState } from 'react'
import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'

export default function CheckpointToggle() {
  const { t } = useTranslation()
  const enabled = useChatStore((s) => s.enableFileCheckpointing)
  const setEnabled = useChatStore((s) => s.setCheckpointingEnabled)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const [hovered, setHovered] = useState(false)

  const disabled = isStreaming
  const color = enabled ? 'var(--blue)' : (hovered ? 'var(--text-secondary)' : 'var(--text-dim)')

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEnabled(!enabled)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={t('checkpoint.tooltip')}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase"
      style={{
        background: enabled ? 'var(--bg-elevated)' : 'transparent',
        border: '1px solid var(--border-subtle)',
        borderLeft: enabled ? '2px solid var(--blue)' : '2px solid transparent',
        borderRadius: 2,
        color,
        cursor: disabled ? 'default' : 'pointer',
        letterSpacing: '0.06em',
        fontWeight: 600,
        transition: 'color 150ms ease, background 150ms ease',
      }}
    >
      <Zap size={14} strokeWidth={1.5} />
      <span>{enabled ? t('checkpoint.labelOn') : t('checkpoint.label')}</span>
    </button>
  )
}
