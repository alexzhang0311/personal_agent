import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import CopyButton from '../shared/CopyButton'

export default function PlanReviewPanel() {
  const { t } = useTranslation()
  const planContent = useUiStore((s) => s.planContent)
  const planFilePath = useUiStore((s) => s.planFilePath)

  if (!planContent) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ color: 'var(--text-dim)', fontSize: 13 }}
      >
        {t('planReview.noPlan')}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header: file path */}
      {planFilePath && (
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
          }}
        >
          <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <span
            className="flex-1 text-xs truncate"
            style={{
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              color: 'var(--text-secondary)',
            }}
          >
            {planFilePath}
          </span>
          <CopyButton content={planContent} />
        </div>
      )}

      {/* Plan content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <MarkdownRenderer content={planContent} />
      </div>
    </div>
  )
}
