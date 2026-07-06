import { useState, useCallback } from 'react'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'

export default function PlanApprovalCard({ approval, onApprove }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(null)
  const [feedbackText, setFeedbackText] = useState('')
  const showCanvas = useUiStore((s) => s.showCanvas)
  const setActiveCanvasTab = useUiStore((s) => s.setActiveCanvasTab)

  const OPTIONS = [
    {
      value: 'newSessionAutoEdits',
      label: t('planApproval.newSessionAutoEdits'),
      description: t('planApproval.newSessionAutoEditsDesc'),
    },
    {
      value: 'sameSessionAutoEdits',
      label: t('planApproval.sameSessionAutoEdits'),
      description: t('planApproval.sameSessionAutoEditsDesc'),
    },
    {
      value: 'sameSessionManual',
      label: t('planApproval.sameSessionManual'),
      description: t('planApproval.sameSessionManualDesc'),
    },
    {
      value: 'feedback',
      label: t('planApproval.feedback'),
      description: t('planApproval.feedbackDesc'),
    },
  ]

  const handleViewPlan = useCallback(() => {
    showCanvas()
    setActiveCanvasTab('plan')
  }, [showCanvas, setActiveCanvasTab])

  const handleConfirm = useCallback(() => {
    if (!selected) return
    if (selected === 'feedback' && !feedbackText.trim()) return
    onApprove(selected, feedbackText.trim())
  }, [selected, feedbackText, onApprove])

  const canConfirm = selected && (selected !== 'feedback' || feedbackText.trim())

  return (
    <div
      style={{
        borderLeft: '2px solid var(--cyan)',
        border: '1px solid var(--border)',
        borderLeftWidth: 2,
        borderLeftColor: 'var(--cyan)',
        borderRadius: 4,
        background: 'var(--bg-surface)',
        padding: 16,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <ClipboardList size={16} strokeWidth={1.5} style={{ color: 'var(--cyan)' }} />
        <span
          className="text-xs uppercase font-semibold"
          style={{ color: 'var(--cyan)', letterSpacing: '0.06em' }}
        >
          {t('planApproval.title')}
        </span>
      </div>

      {/* Description */}
      <div style={{ marginBottom: 12 }}>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {t('planApproval.ready')}{' '}
        </span>
        <button
          onClick={handleViewPlan}
          className="text-xs"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--blue)',
            padding: 0,
            textDecoration: 'underline',
            transition: 'color 150ms ease',
          }}
        >
          {t('planApproval.viewPlan')}
        </button>
      </div>

      {/* Radio options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              className="flex items-start gap-3 w-full text-left"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: 2,
                transition: 'background 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Radio indicator */}
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 16,
                  height: 16,
                  marginTop: 1,
                  borderRadius: '50%',
                  border: isSelected
                    ? '2px solid var(--blue)'
                    : '2px solid var(--border-strong)',
                  transition: 'all 150ms ease',
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--blue)',
                    }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {opt.label}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                  {opt.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Feedback textarea (only when option 4 selected) */}
      {selected === 'feedback' && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t('planApproval.feedbackPlaceholder')}
            rows={3}
            style={{
              width: '100%',
              minHeight: 72,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: "'Noto Sans', sans-serif",
              padding: '8px 10px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 150ms ease',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--blue)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
        </div>
      )}

      {/* Confirm button */}
      <div className="flex justify-end">
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex items-center gap-1 px-3 py-1 text-xs font-semibold"
          style={{
            background: canConfirm ? 'var(--blue)' : 'var(--bg-elevated)',
            color: canConfirm ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          <ChevronRight size={14} strokeWidth={1.5} />
          {t('confirm.confirm')}
        </button>
      </div>
    </div>
  )
}
