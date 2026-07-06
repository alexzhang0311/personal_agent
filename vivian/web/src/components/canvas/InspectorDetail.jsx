import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MousePointerClick, CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useBrowserDebugStore from '../../stores/browserDebugStore'
import SelectedFilePopup from '../shared/SelectedFilePopup'
import CopyButton from '../shared/CopyButton'
import { summarizeSelected } from '../../utils/inspectorBridge'

const SECTION_TITLE_STYLE = {
  color: 'var(--text-dim)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

const CODE_BLOCK_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 2,
  padding: '6px 8px',
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
  fontSize: 11,
  color: 'var(--text-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  maxHeight: 120,
  overflow: 'auto',
  position: 'relative',
}

function Section({ title, content, copyable }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={SECTION_TITLE_STYLE}>{title}</div>
      <div className="copyable" style={CODE_BLOCK_STYLE}>
        {content}
        {copyable && <CopyButton content={typeof content === 'string' ? content : ''} />}
      </div>
    </div>
  )
}

function formatAttrs(attrs) {
  if (!attrs || Object.keys(attrs).length === 0) return '(none)'
  return Object.keys(attrs).map((k) => `${k}="${attrs[k]}"`).join('\n')
}

function formatComputed(computed) {
  if (!computed) return '(none)'
  const lines = []
  for (const k of Object.keys(computed)) {
    const v = (computed[k] || '').trim()
    if (v) lines.push(`${k}: ${v}`)
  }
  return lines.length ? lines.join('\n') : '(none)'
}

function formatHandlers(handlers) {
  if (!handlers || Object.keys(handlers).length === 0) {
    return '(none — addEventListener handlers not introspectable from sandbox)'
  }
  return Object.keys(handlers).map((k) => `${k}="${handlers[k]}"`).join('\n')
}

export default function InspectorDetail({ height = 220, topBorder = true }) {
  const { t } = useTranslation()
  const selected = useBrowserDebugStore((s) => s.selected)
  const eventLog = useBrowserDebugStore((s) => s.eventLog)
  const htmlSource = useBrowserDebugStore((s) => s.htmlSource)
  const [popupData, setPopupData] = useState(null)

  const handleAsk = useCallback(() => {
    if (!selected) return
    const label = htmlSource?.label || 'agent-output.html'
    const content = summarizeSelected(selected, label, eventLog)
    setPopupData({
      kind: 'dom-element',
      filePath: label,
      fileName: label,
      locator: selected.selector,
      language: 'html',
      contentFormat: 'html',
      content,
      anchorX: window.innerWidth / 2 - 230,
      anchorY: 120,
    })
  }, [selected, eventLog, htmlSource])

  const attrsText = useMemo(() => formatAttrs(selected?.attrs), [selected])
  const computedText = useMemo(() => formatComputed(selected?.computed), [selected])
  const handlersText = useMemo(() => formatHandlers(selected?.handlers), [selected])

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        height,
        borderTop: topBorder ? '1px solid var(--border)' : 'none',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <MousePointerClick size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          <span
            className="uppercase"
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              letterSpacing: '0.06em',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {t('canvas.browser.detailTitle', 'Inspector')}
          </span>
          {selected && (
            <span
              className="truncate"
              title={selected.selector}
              style={{
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                minWidth: 0,
              }}
            >
              {selected.selector}
            </span>
          )}
        </div>
        {selected && (
          <button
            type="button"
            onClick={handleAsk}
            className="flex items-center gap-1 flex-shrink-0"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 12,
              transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            <CornerDownLeft size={14} strokeWidth={1.5} />
            {t('canvas.browser.askAboutElement', 'Ask about this element')}
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto" style={{ padding: '8px 12px' }}>
          {!selected && (
            <div
              className="flex items-center justify-center"
              style={{ height: '100%', color: 'var(--text-dim)', fontSize: 12 }}
            >
              {t('canvas.browser.detailEmpty', 'Click an element in the page to inspect it')}
            </div>
          )}
          {selected && (
            <>
              <Section title={t('canvas.browser.sectionOuter', 'Outer HTML')} content={selected.outerHtml || ''} copyable />
              <Section title={t('canvas.browser.sectionAttrs', 'Attributes')} content={attrsText} copyable />
              <Section title={t('canvas.browser.sectionComputed', 'Computed (key)')} content={computedText} copyable />
              <Section title={t('canvas.browser.sectionHandlers', 'Handlers (inline only)')} content={handlersText} copyable />
            </>
          )}
        </div>
        <div
          className="flex flex-col flex-shrink-0"
          style={{
            width: 240,
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)', ...SECTION_TITLE_STYLE, marginBottom: 0 }}
          >
            <span>{t('canvas.browser.eventLog', 'Event log')}</span>
            <span style={{ color: 'var(--text-dim)' }}>{eventLog.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ padding: '6px 10px' }}>
            {eventLog.length === 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                {t('canvas.browser.eventEmpty', 'No events yet')}
              </div>
            )}
            {eventLog.slice().reverse().map((e, idx) => (
              <div
                key={`${e.ts}-${idx}`}
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  padding: '2px 0',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={`${e.kind}  ${e.selector || ''}`}
              >
                {new Date(e.ts).toISOString().slice(11, 19)} {e.kind} {e.selector}
              </div>
            ))}
          </div>
        </div>
      </div>

      {popupData && createPortal(
        <SelectedFilePopup data={popupData} onClose={() => setPopupData(null)} />,
        document.body,
      )}
    </div>
  )
}
