import { useState, useCallback } from 'react'
import { HelpCircle, Check, ChevronRight, ChevronDown, Plus, X, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Tabs from '../shared/Tabs'

function QuestionSection({
  question,
  questionIndex,
  selections,
  customInputs,
  onToggleOption,
  onToggleCustom,
  onCustomTextChange,
  disabled,
  t,
}) {
  const selected = selections[questionIndex] || new Set()
  const customInput = customInputs[questionIndex] || { enabled: false, text: '' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header chip + question */}
      <div className="flex items-center gap-2">
        {question.header && (
          <span
            className="px-2 py-0 text-xs uppercase"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
              letterSpacing: '0.06em',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            {question.header}
          </span>
        )}
        <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {question.question}
        </span>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 4 }}>
        {question.options.map((option, optIdx) => {
          const isSelected = selected.has(optIdx)
          const isMulti = question.multiSelect || false
          return (
            <button
              key={optIdx}
              onClick={() => onToggleOption(questionIndex, optIdx, isMulti)}
              disabled={disabled}
              className="flex items-start gap-3 w-full text-left"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '6px 8px',
                borderRadius: 2,
                opacity: disabled ? 0.5 : 1,
                transition: 'background 150ms ease',
              }}
              onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Radio / Checkbox indicator */}
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 1,
                  borderRadius: isMulti ? 2 : '50%',
                  border: isSelected
                    ? '2px solid var(--blue)'
                    : '2px solid var(--border-strong)',
                  background: isSelected ? 'var(--blue)' : 'transparent',
                  transition: 'all 150ms ease',
                }}
              >
                {isSelected && <Check size={12} strokeWidth={1.5} style={{ color: 'var(--text-inverse)' }} />}
              </div>
              <div className="min-w-0">
                <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {option.label}
                </div>
                {option.description && (
                  <div className="text-xs" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                    {option.description}
                  </div>
                )}
              </div>
            </button>
          )
        })}

        {/* Custom answer toggle */}
        {!customInput.enabled ? (
          <button
            onClick={() => onToggleCustom(questionIndex)}
            disabled={disabled}
            className="flex items-center gap-1 text-xs"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: 'var(--blue)',
              padding: '4px 8px',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Plus size={12} strokeWidth={1.5} />
            {t('askUser.typeCustom')}
          </button>
        ) : (
          <div style={{ marginTop: 4, padding: '0 8px' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('askUser.customAnswer')}</span>
              <button
                onClick={() => onToggleCustom(questionIndex)}
                disabled={disabled}
                className="flex items-center gap-1 text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: 0,
                }}
              >
                <X size={12} strokeWidth={1.5} />
                {t('askUser.customCancel')}
              </button>
            </div>
            <textarea
              value={customInput.text}
              onChange={(e) => onCustomTextChange(questionIndex, e.target.value)}
              disabled={disabled}
              placeholder={t('askUser.customPlaceholder')}
              rows={2}
              style={{
                width: '100%',
                minHeight: 60,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                color: 'var(--text-primary)',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                padding: '8px 10px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--blue)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function AskUserQuestionCard({ block, onAnswer, onSkip }) {
  const { t } = useTranslation()
  const [selections, setSelections] = useState({})
  const [customInputs, setCustomInputs] = useState({})
  const [activeTab, setActiveTab] = useState(0)
  const [answeredExpanded, setAnsweredExpanded] = useState(false)

  // Normalize once: a server question may arrive without `options` — every
  // consumer below assumes an array, so guarantee it here.
  const rawQuestions = Array.isArray(block.questions) ? block.questions : []
  const questions = rawQuestions.map((q) => ({
    ...q,
    options: Array.isArray(q?.options) ? q.options : [],
  }))
  const isAnswered = block.status === 'answered'
  const isDeclined = block.status === 'declined'
  const disabled = isAnswered || isDeclined

  const handleToggleOption = useCallback((qIdx, optIdx, multiSelect) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || [])
      if (multiSelect) {
        if (current.has(optIdx)) current.delete(optIdx)
        else current.add(optIdx)
      } else {
        current.clear()
        current.add(optIdx)
        setCustomInputs((p) => ({ ...p, [qIdx]: { enabled: false, text: '' } }))
      }
      return { ...prev, [qIdx]: current }
    })
  }, [])

  const handleToggleCustom = useCallback((qIdx) => {
    setCustomInputs((prev) => {
      const current = prev[qIdx] || { enabled: false, text: '' }
      const isMulti = questions[qIdx]?.multiSelect || false
      if (!current.enabled && !isMulti) {
        setSelections((p) => {
          const next = { ...p }
          delete next[qIdx]
          return next
        })
      }
      return {
        ...prev,
        [qIdx]: { enabled: !current.enabled, text: current.enabled ? '' : current.text },
      }
    })
  }, [questions])

  const handleCustomTextChange = useCallback((qIdx, text) => {
    setCustomInputs((prev) => ({ ...prev, [qIdx]: { ...prev[qIdx], text } }))
  }, [])

  const hasAnswer = useCallback(() => {
    for (let i = 0; i < questions.length; i++) {
      const selected = selections[i]
      const custom = customInputs[i]
      const hasSelection = selected && selected.size > 0
      const hasCustom = custom?.enabled && custom.text.trim()
      if (!hasSelection && !hasCustom) return false
    }
    return questions.length > 0
  }, [questions, selections, customInputs])

  const buildAnswerText = useCallback(() => {
    const parts = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const selected = selections[i]
      const custom = customInputs[i]
      const answerParts = []
      if (selected && selected.size > 0) {
        for (const idx of Array.from(selected).sort((a, b) => a - b)) {
          const opt = q.options[idx]
          answerParts.push(opt.description ? `${opt.label} - ${opt.description}` : opt.label)
        }
      }
      if (custom?.enabled && custom.text.trim()) {
        answerParts.push(`${t('askUser.customPrefix')} ${custom.text.trim()}`)
      }
      if (answerParts.length > 0) {
        parts.push(`- ${q.header || q.question} -> ${answerParts.join('; ')}`)
      }
    }
    return parts.join('\n')
  }, [questions, selections, customInputs, t])

  const handleSubmit = useCallback(() => {
    const text = buildAnswerText()
    if (text && onAnswer) {
      // Build serializable snapshots to persist on the block
      const selSnap = {}
      for (const [k, v] of Object.entries(selections)) {
        selSnap[Number(k)] = Array.from(v)
      }
      const customSnap = { ...customInputs }
      onAnswer(text, block.toolUseId, { selections: selSnap, customInputs: customSnap })
    }
  }, [buildAnswerText, onAnswer, selections, customInputs, block.toolUseId])

  // Answered state
  if (isAnswered) {
    // Read persisted selection data from the block
    const savedSelections = block.answeredSelections || {}
    const savedCustomInputs = block.answeredCustomInputs || {}
    const answeredText = block.answeredText || ''
    const hasSnapshots = Object.keys(savedSelections).length > 0

    return (
      <div
        style={{
          border: '1px solid var(--green)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 12,
          opacity: 0.9,
        }}
      >
        <button
          onClick={() => setAnsweredExpanded((p) => !p)}
          className="flex items-center gap-2 w-full text-left"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <Check size={16} strokeWidth={1.5} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span className="flex-1 font-semibold" style={{ color: 'var(--green)', fontSize: 13 }}>
            {t('askUser.answered')}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            style={{
              color: 'var(--text-dim)',
              transform: answeredExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 150ms ease',
            }}
          />
        </button>
        {answeredExpanded && (
          <div style={{ marginTop: 10, marginLeft: 24 }}>
            {hasSnapshots ? (
              questions.map((q, qIdx) => {
                const chosenArr = savedSelections[qIdx] || []
                const chosenSet = new Set(chosenArr)
                const customSnap = savedCustomInputs[qIdx] || { enabled: false, text: '' }
                return (
                  <div key={qIdx} style={{ marginBottom: 8 }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                      {q.header && (
                        <span
                          className="px-2 py-0 text-xs uppercase"
                          style={{
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            borderRadius: 2,
                            letterSpacing: '0.06em',
                            fontWeight: 600,
                            fontSize: 10,
                          }}
                        >
                          {q.header}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {q.question}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {q.options.map((option, optIdx) => {
                        const wasChosen = chosenSet.has(optIdx)
                        return (
                          <div
                            key={optIdx}
                            className="flex items-start gap-2 text-xs"
                            style={{
                              padding: '4px 6px',
                              borderRadius: 2,
                              borderLeft: wasChosen ? '2px solid var(--green)' : '2px solid transparent',
                              background: wasChosen ? 'rgba(63, 185, 80, 0.08)' : 'transparent',
                              color: wasChosen ? 'var(--green)' : 'var(--text-dim)',
                            }}
                          >
                            <div
                              className="flex items-center justify-center flex-shrink-0"
                              style={{
                                width: 12,
                                height: 12,
                                marginTop: 1,
                                borderRadius: q.multiSelect ? 2 : '50%',
                                border: wasChosen
                                  ? '1.5px solid var(--green)'
                                  : '1.5px solid var(--border)',
                                background: wasChosen ? 'var(--green)' : 'transparent',
                              }}
                            >
                              {wasChosen && <Check size={8} strokeWidth={1.5} style={{ color: 'var(--text-inverse)' }} />}
                            </div>
                            <span>
                              {option.label}
                              {option.description && (
                                <span style={{ opacity: 0.6 }}> - {option.description}</span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                      {customSnap.enabled && customSnap.text.trim() && (
                        <div
                          className="flex items-start gap-2 text-xs"
                          style={{
                            padding: '4px 6px',
                            borderRadius: 2,
                            borderLeft: '2px solid var(--green)',
                            background: 'rgba(63, 185, 80, 0.08)',
                            color: 'var(--green)',
                          }}
                        >
                          <div
                            className="flex items-center justify-center flex-shrink-0"
                            style={{
                              width: 12,
                              height: 12,
                              marginTop: 1,
                              borderRadius: 2,
                              border: '1.5px solid var(--green)',
                              background: 'var(--green)',
                            }}
                          >
                            <Check size={8} strokeWidth={1.5} style={{ color: 'var(--text-inverse)' }} />
                          </div>
                          <span>{t('askUser.customPrefix')} {customSnap.text.trim()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            ) : (
              /* Fallback: show raw answered text when no selection snapshots available */
              <pre
                className="text-xs"
                style={{
                  color: 'var(--text-secondary)',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-code)',
                  fontSize: 11,
                }}
              >
                {answeredText}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  // Declined state
  if (isDeclined) {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 12,
          opacity: 0.7,
        }}
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={16} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
          <span className="font-semibold" style={{ color: 'var(--yellow)', fontSize: 13 }}>
            {t('askUser.skipped')}
          </span>
        </div>
      </div>
    )
  }

  // Active state
  const hasMultipleQuestions = questions.length > 1

  return (
    <div
      data-tool-card
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--bg-surface)',
        padding: 16,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <HelpCircle size={16} strokeWidth={1.5} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {t('askUser.needsFeedback')}
        </span>
      </div>

      {/* Tabs (when multiple questions) */}
      {hasMultipleQuestions && (
        <Tabs
          tabs={questions.map((q, i) => ({
            id: String(i),
            label: q.header || t('askUser.question', { num: i + 1 }),
            multiSelect: q.multiSelect,
          }))}
          activeIndex={activeTab}
          onChange={(index) => setActiveTab(index)}
          className="flex gap-0"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 12,
          }}
          buttonClassName="px-3 py-1 text-xs"
          getButtonStyle={({ active }) => ({
            color: active ? 'var(--text-primary)' : 'var(--text-dim)',
            fontWeight: active ? 600 : 400,
          })}
          renderLabel={(tab) => (
            <>
              {tab.label}
              {tab.multiSelect && (
                <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontWeight: 400, marginLeft: 4 }}>
                  {t('askUser.multiSelect')}
                </span>
              )}
            </>
          )}
        />
      )}

      {/* Question content */}
      {hasMultipleQuestions ? (
        <QuestionSection
          question={questions[activeTab]}
          questionIndex={activeTab}
          selections={selections}
          customInputs={customInputs}
          onToggleOption={handleToggleOption}
          onToggleCustom={handleToggleCustom}
          onCustomTextChange={handleCustomTextChange}
          disabled={disabled}
          t={t}
        />
      ) : (
        questions.map((q, i) => (
          <QuestionSection
            key={i}
            question={q}
            questionIndex={i}
            selections={selections}
            customInputs={customInputs}
            onToggleOption={handleToggleOption}
            onToggleCustom={handleToggleCustom}
            onCustomTextChange={handleCustomTextChange}
            disabled={disabled}
            t={t}
          />
        ))
      )}

      {/* Submit button */}
      <div className="flex justify-end" style={{ marginTop: 16 }}>
        <button
          onClick={handleSubmit}
          disabled={!hasAnswer()}
          className="flex items-center gap-1 px-3 py-1 text-xs font-semibold"
          style={{
            background: hasAnswer() ? 'var(--blue)' : 'var(--bg-elevated)',
            color: hasAnswer() ? 'var(--text-inverse)' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 4,
            cursor: hasAnswer() ? 'pointer' : 'not-allowed',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          <ChevronRight size={14} strokeWidth={1.5} />
          {t('askUser.sendAnswer')}
        </button>
      </div>

      {/* Skip button (only when onSkip is provided, i.e. in ChatInput) */}
      {onSkip && (
        <div
          className="flex items-center"
          style={{
            marginTop: 16,
            marginLeft: -16,
            marginRight: -16,
            marginBottom: -16,
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            className="flex items-center gap-1 text-xs"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: '2px 0',
              transition: 'color 150ms ease',
            }}
            onClick={onSkip}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('askUser.skipMessage')}
          >
            <MessageSquare size={14} strokeWidth={1.5} />
            <span>{t('askUser.skipMessage')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
