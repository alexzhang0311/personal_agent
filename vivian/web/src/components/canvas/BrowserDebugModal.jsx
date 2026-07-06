import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useBrowserDebugStore from '../../stores/browserDebugStore'
import BrowserViewport from './BrowserViewport'
import InspectorDetail from './InspectorDetail'

export default function BrowserDebugModal() {
  const { t } = useTranslation()
  const closeModal = useBrowserDebugStore((s) => s.closeModal)
  const htmlSource = useBrowserDebugStore((s) => s.htmlSource)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 1050,
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        animation: 'prompt-expand-backdrop-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        className="flex flex-col"
        style={{
          width: '92vw',
          height: '92vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          overflow: 'hidden',
          animation: 'prompt-expand-modal-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="uppercase"
              style={{
                color: 'var(--text-primary)',
                fontSize: 11,
                letterSpacing: '0.06em',
                fontWeight: 700,
              }}
            >
              {t('canvas.browser.modalTitle', 'Browser Debug')}
            </span>
            {htmlSource?.label && (
              <span
                className="truncate"
                title={htmlSource.label}
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  minWidth: 0,
                }}
              >
                {htmlSource.label}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeModal}
            title={t('canvas.close', 'Close')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 4,
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <BrowserViewport wide />
        <InspectorDetail />
      </div>
    </div>
  )
}
