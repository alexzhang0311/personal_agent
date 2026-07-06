import { useState, useRef, useCallback, useEffect } from 'react'
import { GripHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useUiStore from '../../stores/uiStore'

const POPUP_WIDTH = 460
const MIN_WIDTH = 360
const MIN_HEIGHT = 300

function buildPromptText(t, question) {
  return t('selectedXlsx.template', { question: question.trim() })
}

export default function SelectedXlsxPopup({ data, onClose }) {
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  const textareaRef = useRef(null)
  const popupRef = useRef(null)

  const initX = Math.min(data.anchorX || 220, window.innerWidth - POPUP_WIDTH - 16)
  const initY = Math.min((data.anchorY || 180) + 8, window.innerHeight - 360)
  const [pos, setPos] = useState({ x: Math.max(0, initX), y: Math.max(0, initY) })
  const [width, setWidth] = useState(POPUP_WIDTH)
  const [height, setHeight] = useState(380)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const onDragStart = useCallback((event) => {
    event.preventDefault()
    const startX = event.clientX - pos.x
    const startY = event.clientY - pos.y

    const onMove = (moveEvent) => {
      setPos({ x: moveEvent.clientX - startX, y: moveEvent.clientY - startY })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pos])

  const onResizeStart = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = width
    const startHeight = height ?? (popupRef.current?.offsetHeight || 380)

    const onMove = (moveEvent) => {
      setWidth(Math.max(MIN_WIDTH, startWidth + (moveEvent.clientX - startX)))
      setHeight(Math.max(MIN_HEIGHT, startHeight + (moveEvent.clientY - startY)))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height, width])

  const handleConfirm = () => {
    useChatStore.getState().setSelectedXlsxReference({
      filePath: data.filePath,
      sheetIndex: data.sheetIndex,
      sheetName: data.sheetName,
      range: data.range,
      contentTsv: data.contentTsv,
    })
    useChatStore.getState().setInputText(buildPromptText(t, comment))
    useUiStore.getState().setActiveNavTab('vivian')
    onClose()
    setTimeout(() => {
      document.querySelector('.chat-textarea')?.focus()
    }, 0)
  }

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        height,
        maxHeight: '80vh',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'grab',
          userSelect: 'none',
        }}
        onMouseDown={onDragStart}
      >
        <div className="min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('selectedXlsx.cardLabel')}
          </span>
          <span
            className="truncate"
            style={{
              color: 'var(--text-dim)',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              maxWidth: width - 96,
            }}
          >
            {data.filePath}
          </span>
        </div>
        <button
          className="flex items-center justify-center"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 2,
            transition: 'color 150ms ease',
          }}
          onClick={onClose}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseEnter={(event) => { event.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(event) => { event.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3 overflow-hidden" style={{ minHeight: 0 }}>
        <div
          className="flex flex-wrap gap-x-4 gap-y-2"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <div>{`${t('selectedXlsx.sheetLabel')}: ${data.sheetName}`}</div>
          <div>{`${t('selectedXlsx.rangeLabel')}: ${data.range}`}</div>
        </div>

        <div className="flex flex-col gap-2" style={{ flex: 1, minHeight: 0 }}>
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
              flex: 1,
              minHeight: 0,
              padding: '10px 12px',
              overflow: 'auto',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre',
            }}
          >
            {data.contentTsv || ' '}
          </pre>
        </div>

        <div className="flex flex-col gap-2" style={{ flexShrink: 0 }}>
          <label style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {t('optimize.yourComments')}
          </label>
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('optimize.fileCommentPlaceholder')}
            style={{
              width: '100%',
              height: 88,
              flexShrink: 0,
              resize: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              fontSize: 13,
              padding: '10px 12px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-3 px-3 py-2 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          <GripHorizontal size={12} strokeWidth={1.5} />
          <span>{`${data.sheetName} · ${data.range}`}</span>
        </div>
        <button
          type="button"
          className="px-3 py-1 text-sm"
          onClick={handleConfirm}
          style={{
            background: 'var(--blue)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-inverse)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {t('confirm.confirm')}
        </button>
      </div>

      <div
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
        }}
      />
    </div>
  )
}
