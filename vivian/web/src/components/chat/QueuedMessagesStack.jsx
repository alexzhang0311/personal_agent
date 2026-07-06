import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'

function QueuedMessageRow({ entry }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage)
  const queueSender = useChatStore((s) => s.queueSender)

  const handleCancel = () => {
    removeQueuedMessage(entry.id)
    if (queueSender?.sendQueueCancel) queueSender.sendQueueCancel(entry.id)
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 overflow-hidden chat-message-in"
      style={{
        borderLeft: '2px solid var(--status-pending)',
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        marginTop: 4,
        borderRadius: 2,
        minWidth: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="uppercase flex-shrink-0"
        style={{
          color: 'var(--yellow)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
        }}
      >
        {t('chat.queuedLabel')}
      </span>
      <span className="flex-shrink-0" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
        {'\u203A'}
      </span>
      <span
        className="truncate flex-1"
        style={{ fontSize: 13, minWidth: 0, color: 'var(--text-secondary)' }}
      >
        {entry.text}
      </span>
      <button
        className="flex items-center justify-center flex-shrink-0"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 150ms ease, color 150ms ease',
          padding: 2,
        }}
        onClick={handleCancel}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        title={t('chat.cancelQueued')}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

export default function QueuedMessagesStack({ entries, style }) {
  if (!entries?.length) return null

  return (
    <div className="overflow-hidden" style={style}>
      {entries.map((entry) => (
        <QueuedMessageRow key={entry.id} entry={entry} />
      ))}
      <div
        className="px-3 py-1"
        style={{
          color: 'var(--text-dim)',
          fontSize: 11,
          fontWeight: 300,
          marginTop: 2,
        }}
      >
        {'\u2192 will send after next tool returns'}
      </div>
    </div>
  )
}
