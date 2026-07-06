import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useUiStore from '../../stores/uiStore'

export default function ConfirmDialog() {
  const { t } = useTranslation()
  const dialog = useUiStore((s) => s.confirmDialog)
  const hideConfirmDialog = useUiStore((s) => s.hideConfirmDialog)
  const [confirmText, setConfirmText] = useState('')
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const confirmRef = useRef(null)

  const requireText = dialog?.requireText
  const canConfirm = requireText ? confirmText === requireText : true

  // Reset typed text whenever the dialog opens or closes.
  useEffect(() => {
    setConfirmText('')
  }, [dialog])

  // Autofocus: the type-to-confirm input when present, else the confirm button.
  useEffect(() => {
    if (!dialog) return
    const target = requireText ? inputRef.current : confirmRef.current
    target?.focus()
  }, [dialog, requireText])

  // Keyboard: Esc cancels (capture phase + preventDefault so global Esc
  // consumers like the chat stop-stream handler never see it), Enter confirms
  // when enabled, Tab is trapped inside the panel.
  useEffect(() => {
    if (!dialog) return
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        hideConfirmDialog()
        return
      }
      if (e.key === 'Enter') {
        if (e.isComposing) return
        const ae = document.activeElement
        // Focused buttons handle Enter natively as a click.
        if (ae && panelRef.current?.contains(ae) && ae.tagName === 'BUTTON') return
        if (!canConfirm) return
        e.preventDefault()
        dialog.onConfirm?.()
        hideConfirmDialog()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusables = panel.querySelectorAll('button:not([disabled]), input')
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        } else if (!panel.contains(document.activeElement)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [dialog, hideConfirmDialog, canConfirm])

  if (!dialog) return null

  const { title, message, confirmLabel = t('confirm.confirm'), onConfirm, danger } = dialog

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
      }}
      onClick={hideConfirmDialog}
    >
      <div
        ref={panelRef}
        className="flex flex-col gap-4 p-6"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '4px',
          maxWidth: 420,
          width: '90%',
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-md" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </div>
        {requireText && (
          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
              {t('confirm.typeToConfirm', { text: requireText })}
            </span>
            <input
              ref={inputRef}
              className="px-2 py-1 text-sm"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1 text-sm"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
            }}
            onClick={hideConfirmDialog}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            {t('confirm.cancel')}
          </button>
          <button
            ref={confirmRef}
            className="px-3 py-1 text-sm"
            style={{
              background: danger ? 'var(--red)' : 'var(--blue)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-inverse)',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              opacity: canConfirm ? 1 : 0.4,
              transition: 'opacity 150ms ease',
            }}
            disabled={!canConfirm}
            onClick={() => {
              onConfirm?.()
              hideConfirmDialog()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
