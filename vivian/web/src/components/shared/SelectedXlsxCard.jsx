import { useId, useState } from 'react'
import { ChevronDown, FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatedChevron, AnimatedCollapse } from './Accordion'

export default function SelectedXlsxCard({
  filePath,
  sheetName,
  range,
  contentTsv,
  onDismiss,
  collapsed: initialCollapsed = true,
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const bodyId = useId()
  const fileName = filePath ? filePath.split('/').pop() : ''
  const summary = [sheetName, range].filter(Boolean).join(' · ')

  return (
    <div style={{
      borderLeft: '2px solid var(--blue)',
      background: 'var(--bg-surface)',
      borderRadius: '0 4px 4px 0',
      overflow: 'hidden',
    }}>
      <div
        className="flex items-start"
        style={{
          borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          className="flex items-start gap-2 px-3 py-2 min-w-0 flex-1"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 0,
            padding: '8px 12px',
            textAlign: 'left',
          }}
          onClick={() => setCollapsed((value) => !value)}
        >
          <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0 flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="uppercase"
                style={{
                  color: 'var(--blue)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {t('selectedXlsx.cardLabel')}
              </span>
              <span
                className="truncate"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  minWidth: 0,
                }}
              >
                {filePath || fileName}
              </span>
            </div>
            {summary && (
              <div
                className="truncate"
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                }}
              >
                {`${t('selectedXlsx.sheetLabel')}: ${sheetName} · ${t('selectedXlsx.rangeLabel')}: ${range}`}
              </div>
            )}
          </div>
          <AnimatedChevron open={!collapsed} style={{ color: 'var(--text-dim)', marginTop: 2 }}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
        </button>
        {onDismiss && (
          <button
            className="flex items-center justify-center flex-shrink-0"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
              marginTop: 9,
              marginRight: 12,
              transition: 'color 150ms ease',
            }}
            onClick={(event) => {
              event.stopPropagation()
              onDismiss()
            }}
            onMouseEnter={(event) => { event.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(event) => { event.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <AnimatedCollapse
        open={!collapsed}
        id={bodyId}
        innerClassName="px-3 py-2"
        innerStyle={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
          <div
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {t('selectedXlsx.contentLabel')}
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              padding: '10px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre',
            }}
          >
            {contentTsv || ' '}
          </pre>
      </AnimatedCollapse>
    </div>
  )
}
