import { useCallback, useEffect, useRef, useState } from 'react'
import { GripHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useUiStore from '../../stores/uiStore'

const POPUP_WIDTH = 460
const MIN_WIDTH = 360
const MIN_HEIGHT = 300

function buildPromptText(t, question) {
  return t('selectedFile.template', { question: question.trim() })
}

function basename(filePath) {
  if (!filePath) return ''
  const parts = filePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

export default function SelectedFilePopup({ data, onClose }) {
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
      // Keep the header reachable: same 80px margin rule as the terminal
      // bounds clamp in uiStore.
      const maxX = Math.max(0, window.innerWidth - 80)
      const maxY = Math.max(0, window.innerHeight - 80)
      setPos({
        x: Math.max(0, Math.min(maxX, moveEvent.clientX - startX)),
        y: Math.max(0, Math.min(maxY, moveEvent.clientY - startY)),
      })
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
      setWidth(Math.max(MIN_WIDTH, Math.min(window.innerWidth - 16, startWidth + (moveEvent.clientX - startX))))
      setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 16, startHeight + (moveEvent.clientY - startY))))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height, width])

  const handleConfirm = () => {
    useChatStore.getState().setSelectedFileReference({
      kind: data.kind,
      filePath: data.filePath,
      fileName: data.fileName || basename(data.filePath),
      locator: data.locator,
      startLine: data.startLine,
      endLine: data.endLine,
      language: data.language,
      slideNumber: data.slideNumber,
      boxIndex: data.boxIndex,
      boxLabel: data.boxLabel,
      boxBounds: data.boxBounds,
      contentFormat: data.contentFormat || 'text',
      content: data.content,
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
            {t('selectedFile.popupTitle')}
          </span>
          <span
            className="truncate"
            style={{
              color: 'var(--text-dim)',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              maxWidth: width - 96,
            }}
            title={data.filePath}
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
          <div>{`${t('selectedFile.fileLabel')}: ${data.fileName || basename(data.filePath)}`}</div>
          {data.locator && <div>{`${t('selectedFile.locationLabel')}: ${data.locator}`}</div>}
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
            {t('selectedFile.contentLabel')}
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
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {data.content || ' '}
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
        <div className="flex items-center gap-2 min-w-0" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          <GripHorizontal size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span className="truncate">{data.locator || data.fileName || basename(data.filePath)}</span>
        </div>
        <button
          type="button"
          className="px-3 py-1 text-sm"
          onClick={handleConfirm}
          style={{
            background: 'var(--blue)',
            color: 'var(--text-inverse)',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {t('optimize.send')}
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
          color: 'var(--text-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <GripHorizontal size={12} strokeWidth={1.5} style={{ transform: 'rotate(-45deg)' }} />
      </div>
    </div>
  )
}
