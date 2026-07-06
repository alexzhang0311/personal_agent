import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Minimize2 } from 'lucide-react'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

export default function CompactBoundary({ message }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const { status, compactMetadata, summary } = message

  if (status === 'compacting') {
    return (
      <div
        className="flex items-start gap-3 px-4 py-3 my-3 rounded"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: '2px solid var(--status-running)',
          borderRadius: '4px',
        }}
      >
        <Minimize2 size={14} strokeWidth={1.5} style={{ color: 'var(--purple)', marginTop: 2, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <span
            className="thinking-shimmer text-sm font-semibold"
            style={{ color: 'var(--purple)' }}
          >
            {t('compact.compacting')}
          </span>
          <div className="flex flex-col gap-2 mt-2">
            <div className="skeleton" style={{ height: 10, width: '80%', borderRadius: 2 }} />
            <div className="skeleton" style={{ height: 10, width: '60%', borderRadius: 2 }} />
            <div className="skeleton" style={{ height: 10, width: '70%', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    )
  }

  // status === 'complete'
  const trigger = compactMetadata?.trigger || 'manual'
  const preTokens = compactMetadata?.preTokens || 0

  return (
    <div className="my-4">
      {/* Dashed rule + label + toggle */}
      <div className="flex items-center gap-3">
        <div className="flex-1" style={{ borderTop: '1px dashed var(--border-strong)' }} />
        <span
          className="text-xs font-bold uppercase"
          style={{ color: 'var(--purple)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}
        >
          {t('compact.title')}
        </span>
        {summary && (
          <button
            className="flex items-center gap-1 text-xs"
            style={{
              color: 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'color 150ms ease',
            }}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            <AnimatedChevron open={expanded}>
              <ChevronDown size={12} strokeWidth={1.5} />
            </AnimatedChevron>
          </button>
        )}
        <div className="flex-1" style={{ borderTop: '1px dashed var(--border-strong)' }} />
      </div>

      {/* Metadata line */}
      {preTokens > 0 && (
        <div
          className="flex items-center justify-center gap-3 mt-1 text-xs font-light"
          style={{ color: 'var(--text-dim)' }}
        >
          <span>{preTokens.toLocaleString()} {t('compact.tokensCompressed')}</span>
          <span style={{ color: 'var(--border-strong)' }}>|</span>
          <span>{t('compact.trigger')}: {trigger}</span>
        </div>
      )}

      {/* Collapsible summary */}
      <AnimatedCollapse
        open={Boolean(summary && expanded)}
        id={bodyId}
        className="mt-2"
        style={{
          background: 'var(--bg-elevated)',
          borderLeft: '2px solid var(--purple)',
          borderRadius: '4px',
        }}
        innerClassName="px-3 py-2"
      >
          <MarkdownRenderer content={summary} mermaidCollapsible />
      </AnimatedCollapse>
    </div>
  )
}
