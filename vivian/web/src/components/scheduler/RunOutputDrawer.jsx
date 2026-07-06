import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRunOutput } from '../../api/scheduler'
import RunEventRenderer from './RunEventRenderer'

export default function RunOutputDrawer({ runId, onClose }) {
  const { t } = useTranslation()
  const [events, setEvents] = useState([])
  const [offset, setOffset] = useState(0)
  const [polling, setPolling] = useState(true)
  const containerRef = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!runId) return

    const poll = async () => {
      try {
        const data = await getRunOutput(runId, offset)
        if (data.events && data.events.length > 0) {
          setEvents((prev) => [...prev, ...data.events])
          setOffset(data.offset)
        }
        // Stop polling if we see a result event
        if (data.events?.some((e) => e.event === 'result')) {
          setPolling(false)
        }
      } catch {
        setPolling(false)
      }
    }

    poll()
    if (polling) {
      intervalRef.current = setInterval(poll, 2000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [runId, offset, polling])

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events])

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0"
        style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)', zIndex: 200 }}
        onClick={onClose}
      />

      {/* Drawer from right */}
      <div
        className="fixed flex flex-col"
        style={{
          top: 'var(--navbar-height)',
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: '100vw',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 201,
          animation: 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {t('scheduler.runOutput')}
          </span>
          <div className="flex items-center gap-2">
            {polling && (
              <span className="text-xs uppercase font-semibold" style={{ color: 'var(--purple)', letterSpacing: '0.06em' }}>
                {t('scheduler.live')}
              </span>
            )}
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Events */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-3"
          style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 12 }}
        >
          {events.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span style={{ color: 'var(--text-dim)' }}>{t('scheduler.noOutput')}</span>
            </div>
          ) : (
            <RunEventRenderer events={events} />
          )}
        </div>
      </div>
    </>
  )
}
