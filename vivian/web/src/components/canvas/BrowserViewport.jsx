import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useBrowserDebugStore from '../../stores/browserDebugStore'
import SelectedFilePopup from '../shared/SelectedFilePopup'
import { buildSrcdoc, summarizeSelected } from '../../utils/inspectorBridge'

function deriveLabel(source) {
  if (!source) return 'agent-output.html'
  return source.label || source.fileName || 'pasted.html'
}

export default function BrowserViewport({ wide = false }) {
  const { t } = useTranslation()
  const htmlSource = useBrowserDebugStore((s) => s.htmlSource)
  const mode = useBrowserDebugStore((s) => s.mode)
  const setSelected = useBrowserDebugStore((s) => s.setSelected)
  const setHover = useBrowserDebugStore((s) => s.setHover)
  const hover = useBrowserDebugStore((s) => s.hover)
  const appendEvent = useBrowserDebugStore((s) => s.appendEvent)
  const reloadKey = useBrowserDebugStore((s) => s.reloadKey)

  const iframeRef = useRef(null)
  const wrapperRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  const [selectedFileData, setSelectedFileData] = useState(null)

  const srcdoc = useMemo(() => {
    if (!htmlSource?.html) return ''
    return buildSrcdoc(htmlSource.html, mode)
  }, [htmlSource?.html, mode, reloadKey])

  const buildReference = useCallback((snap) => {
    if (!snap) return null
    const label = deriveLabel(htmlSource)
    const content = summarizeSelected(snap, label, useBrowserDebugStore.getState().eventLog)
    return {
      kind: 'dom-element',
      filePath: label,
      fileName: label,
      locator: snap.selector,
      language: 'html',
      contentFormat: 'html',
      content,
    }
  }, [htmlSource])

  // Post mode changes (and initial mode after iframe is ready).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    try { win.postMessage({ type: 'set-mode', mode }, '*') } catch (e) { /* ignore */ }
  }, [mode, srcdoc])

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data || {}
      if (data.type === 'hover') {
        setHover(data.rect ? { rect: data.rect, tag: data.tag, selector: data.selector } : null)
      } else if (data.type === 'select') {
        const snap = data.snapshot
        if (!snap) return
        setSelected(snap)
        const wrapperRect = wrapperRef.current?.getBoundingClientRect()
        const ax = (wrapperRect?.left || 0) + (snap.anchorX || 0)
        const ay = (wrapperRect?.top || 0) + (snap.anchorY || 0)
        setTooltip({ x: ax + 8, y: ay + 8, snapshot: snap })
      } else if (data.type === 'event') {
        appendEvent({ kind: data.kind, selector: data.selector, tag: data.tag, ts: data.ts || Date.now() })
      } else if (data.type === 'ready') {
        try { iframeRef.current?.contentWindow?.postMessage({ type: 'set-mode', mode }, '*') } catch (e) { /* ignore */ }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appendEvent, setHover, setSelected, mode])

  const handleAskClick = useCallback(() => {
    if (!tooltip) return
    const ref = buildReference(tooltip.snapshot)
    if (!ref) return
    setSelectedFileData({
      ...ref,
      anchorX: tooltip.x,
      anchorY: tooltip.y,
    })
    setTooltip(null)
  }, [tooltip, buildReference])

  if (!htmlSource?.html) {
    return (
      <div
        ref={wrapperRef}
        className="flex flex-col items-center justify-center flex-1"
        style={{
          background: 'var(--bg-base)',
          color: 'var(--text-dim)',
          minHeight: 0,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <span className="text-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('canvas.browser.emptyTitle', 'No HTML loaded')}
        </span>
        <span className="text-xs" style={{ maxWidth: 320 }}>
          {t('canvas.browser.emptyHint', 'Paste HTML, drop a file, or pick a recent agent output to start inspecting.')}
        </span>
      </div>
    )
  }

  const overlayRect = hover?.rect
  return (
    <div
      ref={wrapperRef}
      className="flex-1 relative"
      style={{
        minHeight: 0,
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <iframe
        ref={iframeRef}
        title="browser-debug"
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          // Hardcoded white is intentional: user-content legibility — CSS
          // variables don't cross the sandboxed iframe boundary.
          background: '#ffffff',
          display: 'block',
        }}
      />
      {overlayRect && (
        <div
          style={{
            position: 'absolute',
            left: overlayRect.x,
            top: overlayRect.y,
            width: overlayRect.width,
            height: overlayRect.height,
            border: '2px dashed var(--blue)',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}

      {tooltip && createPortal(
        <button
          type="button"
          className="flex items-center gap-1"
          onClick={handleAskClick}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 9999,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
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
        </button>,
        document.body,
      )}

      {selectedFileData && createPortal(
        <SelectedFilePopup
          data={selectedFileData}
          onClose={() => setSelectedFileData(null)}
        />,
        document.body,
      )}
      {/* wide prop reserved for future-modal-specific tweaks */}
      {wide ? null : null}
    </div>
  )
}
