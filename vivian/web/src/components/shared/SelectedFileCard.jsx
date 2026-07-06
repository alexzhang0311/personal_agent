import { useId, useState } from 'react'
import { ChevronDown, FileCode, FileText, MousePointerClick, Presentation, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatedChevron, AnimatedCollapse } from './Accordion'

function basename(filePath) {
  if (!filePath) return ''
  const parts = filePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function kindLabel(kind) {
  if (kind === 'pptx') return 'PPTX'
  if (kind === 'plain-text') return 'TEXT'
  if (kind === 'dom-element') return 'ELEMENT'
  return String(kind || 'FILE').toUpperCase()
}

function KindIcon({ kind }) {
  if (kind === 'pptx') {
    return <Presentation size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 2 }} />
  }
  if (kind === 'plain-text') {
    return <FileCode size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 2 }} />
  }
  if (kind === 'dom-element') {
    return <MousePointerClick size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 2 }} />
  }
  return <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 2 }} />
}

export default function SelectedFileCard({
  kind,
  filePath,
  fileName,
  locator,
  content,
  onDismiss,
  collapsed: initialCollapsed = true,
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const bodyId = useId()
  const displayName = fileName || basename(filePath)
  const showPath = filePath && filePath !== displayName

  return (
    <div
      className="min-w-0"
      style={{
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        borderLeft: '2px solid var(--cyan)',
        background: 'var(--bg-surface)',
        borderRadius: '0 4px 4px 0',
        overflow: 'hidden',
      }}
    >
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
          <KindIcon kind={kind} />
          <div className="min-w-0 flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="uppercase"
                style={{
                  color: 'var(--cyan)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {kindLabel(kind)}
              </span>
              <span
                className="truncate"
                title={filePath}
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {displayName || filePath}
              </span>
            </div>
            {locator && (
              <div
                className="truncate"
                title={locator}
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  minWidth: 0,
                }}
              >
                {locator}
              </div>
            )}
            {showPath && (
              <div
                className="truncate"
                title={filePath}
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                }}
              >
                {filePath}
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
            {t('selectedFile.contentLabel')}
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
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {content || ' '}
          </pre>
      </AnimatedCollapse>
    </div>
  )
}
