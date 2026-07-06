import { useEffect, useState, useId, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Code2, Eye, Maximize2, RotateCcw, X, Minus, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import CopyButton from '../shared/CopyButton'

function normalizeMermaidSource(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n')
  text = text.replace(/^﻿/, '').trim()
  text = text.replace(/^```\s*mermaid\s*\n/i, '').replace(/\n```\s*$/i, '')
  const lines = text.split('\n')
  while (lines.length > 0) {
    const first = lines[0].trim()
    if (!first) {
      lines.shift()
      continue
    }
    if (/^@(mermaid|startuml|enduml|startmermaid|endmermaid)\b.*$/i.test(first)) {
      lines.shift()
      continue
    }
    break
  }
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim()
    if (!last || /^@(end|endmermaid|enduml)\b.*$/i.test(last)) {
      lines.pop()
      continue
    }
    break
  }
  return lines.join('\n').trim()
}

function adaptSvgMarkup(rawSvg) {
  if (!rawSvg) return ''
  return rawSvg.replace(/<svg([^>]*)>/, (_match, attrs) => {
    const stripped = attrs
      .replace(/\s+width="[^"]*"/g, '')
      .replace(/\s+height="[^"]*"/g, '')
      .replace(/\s+style="[^"]*"/g, '')
      .replace(/\s+class="[^"]*"/g, '')
    return `<svg${stripped} class="mermaid-svg" style="width:100%;height:auto;display:block">`
  })
}

function readThemeToken(name, fallback = 'currentColor') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function getMermaidThemeVariables() {
  const token = readThemeToken
  return {
    background: token('--bg-base', 'transparent'),
    primaryColor: token('--bg-elevated'),
    primaryTextColor: token('--text-primary'),
    primaryBorderColor: token('--border'),
    secondaryColor: token('--bg-surface'),
    secondaryTextColor: token('--text-primary'),
    secondaryBorderColor: token('--border'),
    tertiaryColor: token('--bg-surface'),
    tertiaryTextColor: token('--text-secondary'),
    tertiaryBorderColor: token('--border'),
    lineColor: token('--text-secondary'),
    textColor: token('--text-primary'),
    mainBkg: token('--bg-elevated'),
    nodeBorder: token('--border'),
    clusterBkg: token('--bg-surface'),
    clusterBorder: token('--border'),
    edgeLabelBackground: token('--bg-surface'),
    titleColor: token('--text-primary'),
    noteBkgColor: token('--bg-surface'),
    noteTextColor: token('--text-primary'),
    noteBorderColor: token('--border'),
    activationBkgColor: token('--bg-elevated'),
    activationBorderColor: token('--blue'),
    actorBkg: token('--bg-elevated'),
    actorBorder: token('--border'),
    actorTextColor: token('--text-primary'),
    actorLineColor: token('--text-secondary'),
    signalColor: token('--text-primary'),
    signalTextColor: token('--text-primary'),
    labelBoxBkgColor: token('--bg-elevated'),
    labelBoxBorderColor: token('--border'),
    labelTextColor: token('--text-primary'),
    loopTextColor: token('--text-primary'),
    sequenceNumberColor: token('--text-inverse'),
    cScale0: token('--blue'),
    cScale1: token('--purple'),
    cScale2: token('--green'),
    cScale3: token('--yellow'),
    cScale4: token('--red'),
    cScale5: token('--cyan'),
    cScale6: token('--orange'),
    pie1: token('--blue'),
    pie2: token('--purple'),
    pie3: token('--green'),
    pie4: token('--yellow'),
    pie5: token('--red'),
    pie6: token('--cyan'),
    pie7: token('--orange'),
  }
}

function initializeMermaid(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: "'Noto Sans', 'Source Han Sans SC', sans-serif",
    // The scoped `.mermaid-svg` CSS block owns the final appearance so
    // diagrams re-theme live. These values keep Mermaid's generated CSS
    // aligned with the app tokens before the overrides land.
    themeVariables: getMermaidThemeVariables(),
  })
}

function getThemeKey() {
  if (typeof document === 'undefined') return 'default'
  return document.documentElement.dataset.theme || 'default'
}

function useThemeKey() {
  const [themeKey, setThemeKey] = useState(getThemeKey)

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined

    const observer = new MutationObserver(() => setThemeKey(getThemeKey()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => observer.disconnect()
  }, [])

  return themeKey
}

function getSvgSize(svg) {
  const match = String(svg || '').match(/\sviewBox=(["'])(.*?)\1/i)
  if (!match) return null

  const values = match[2].trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4) return null

  const width = values[2]
  const height = values[3]
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return { width, height }
}

let mermaidPromise = null
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default || mod
      initializeMermaid(mermaid)
      return mermaid
    })
  }
  return mermaidPromise
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 5
const ZOOM_FACTOR = 0.08

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

// Mirrors LifecycleGraph's floating zoom control styling
const zoomBtnStyle = {
  width: 28, height: 28, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', borderRadius: 2,
  transition: 'color 150ms ease, background 150ms ease',
}

function ZoomButton({ children, onClick, title, wide }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={wide
        ? { ...zoomBtnStyle, width: 'auto', minWidth: 44, padding: '0 6px', fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }
        : zoomBtnStyle}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
    >
      {children}
    </button>
  )
}

function ToolbarButton({ children, onClick, disabled, title, ariaLabel, ariaExpanded }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || title}
      aria-expanded={ariaExpanded}
      title={title}
      className="inline-flex items-center justify-center"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '4px',
        color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
        opacity: disabled ? 0.5 : 1,
        transition: 'color 150ms ease',
        borderRadius: '2px',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.color = 'var(--text-secondary)' }}
    >
      {children}
    </button>
  )
}

// Self-contained pan/zoom canvas — mirrors the Hooks-tab LifecycleGraph
// interaction model: wheel zooms toward the cursor, drag pans, double-click
// (or the floating overlay's reset / fit) returns to the initial view.
function DiagramViewport({ svg, height, padding = 16, fill = false }) {
  const containerRef = useRef(null)
  const svgSize = useMemo(() => getSvgSize(svg), [svg])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: padding, y: padding })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const didPanRef = useRef(false)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: padding, y: padding })
  }, [padding])

  const fitToView = useCallback(() => {
    const el = containerRef.current
    if (!el || !svgSize) {
      reset()
      return
    }

    const availableWidth = Math.max(1, el.clientWidth - padding * 2)
    const availableHeight = Math.max(1, el.clientHeight - padding * 2)
    const next = clampZoom(Math.min(
      availableWidth / svgSize.width,
      availableHeight / svgSize.height,
      1
    ))

    setZoom(next)
    setPan({
      x: (el.clientWidth - svgSize.width * next) / 2,
      y: (el.clientHeight - svgSize.height * next) / 2,
    })
  }, [padding, reset, svgSize])

  useEffect(() => {
    reset()
  }, [reset, svg])

  useEffect(() => {
    if (!svgSize) return undefined
    const frame = window.requestAnimationFrame(fitToView)
    return () => window.cancelAnimationFrame(frame)
  }, [fitToView, svgSize])

  useEffect(() => {
    if (!fill || !svgSize || typeof ResizeObserver === 'undefined') return undefined

    const el = containerRef.current
    if (!el) return undefined

    let frame = null
    const scheduleFit = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(fitToView)
    }

    const observer = new ResizeObserver(scheduleFit)
    observer.observe(el)
    scheduleFit()

    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [fill, fitToView, svgSize])

  // Wheel zoom anchored to the cursor (transform-origin 0 0):
  // p' = m - (z'/z) · (m - p)
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setZoom((prev) => {
      const dir = e.deltaY > 0 ? -1 : 1
      const next = clampZoom(prev * (1 + dir * ZOOM_FACTOR))
      if (next === prev) return prev
      const ratio = next / prev
      setPan((p) => ({ x: mx - ratio * (mx - p.x), y: my - ratio * (my - p.y) }))
      return next
    })
  }, [])

  // wheel must be non-passive to preventDefault page scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    setIsPanning(true)
    didPanRef.current = false
    panStartRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  useEffect(() => {
    if (!isPanning) return undefined
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    const restoreBody = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    const onMove = (e) => {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) didPanRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
    }
    const onUp = () => {
      setIsPanning(false)
      restoreBody()
    }
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      restoreBody()
    }
  }, [isPanning])

  // Button zoom — anchored to the container centre
  const stepZoom = useCallback((factor) => {
    setZoom((prev) => {
      const next = clampZoom(prev * factor)
      if (next === prev) return prev
      const el = containerRef.current
      const cx = el ? el.clientWidth / 2 : 0
      const cy = el ? el.clientHeight / 2 : 0
      const ratio = next / prev
      setPan((p) => ({ x: cx - ratio * (cx - p.x), y: cy - ratio * (cy - p.y) }))
      return next
    })
  }, [])

  const onDoubleClick = useCallback(() => {
    if (didPanRef.current) return
    reset()
  }, [reset])

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        ...(fill ? { flex: 1, minHeight: 0 } : { height: height || 420, maxHeight: height || '70vh' }),
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
        cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: svgSize ? `${svgSize.width}px` : '100%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div
        className="absolute flex items-center gap-1"
        style={{
          bottom: 12,
          right: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: 2,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ZoomButton onClick={() => stepZoom(1 - ZOOM_FACTOR * 2)} title="Zoom out">
          <Minus size={14} strokeWidth={1.5} />
        </ZoomButton>
        <ZoomButton onClick={reset} title="Reset zoom" wide>
          {Math.round(zoom * 100)}%
        </ZoomButton>
        <ZoomButton onClick={() => stepZoom(1 + ZOOM_FACTOR * 2)} title="Zoom in">
          <Plus size={14} strokeWidth={1.5} />
        </ZoomButton>
        <ZoomButton onClick={fitToView} title="Reset view">
          <RotateCcw size={14} strokeWidth={1.5} />
        </ZoomButton>
      </div>
    </div>
  )
}

export default function MermaidDiagram({ code, fill = false, collapsible = false, defaultCollapsed = false }) {
  const reactId = useId()
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [svg, setSvg] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const themeKey = useThemeKey()
  const rawSource = String(code || '').trim()
  const source = useMemo(() => normalizeMermaidSource(code), [code])
  const isCollapsed = collapsible && collapsed

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)
    setSvg('')

    if (!source) {
      setStatus('error')
      setErrorMessage('Empty diagram')
      return () => { cancelled = true }
    }

    loadMermaid()
      .then(async (mermaid) => {
        try {
          initializeMermaid(mermaid)
          await mermaid.parse(source)
          const result = await mermaid.render(renderId, source)
          if (cancelled) return
          setSvg(adaptSvgMarkup(result?.svg || ''))
          setStatus('ready')
        } catch (err) {
          if (cancelled) return
          const message = err?.str || err?.message || String(err)
          setErrorMessage(message)
          setStatus('error')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err?.message || String(err))
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [source, renderId, themeKey])

  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

  if (status === 'error') {
    return (
      <div
        className="copyable-block"
        style={{
          position: 'relative',
          width: '100%',
          minWidth: 0,
          ...(fill ? { height: '100%', minHeight: 0 } : {}),
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderLeft: '2px solid var(--status-error)',
          borderRadius: '4px',
          margin: fill ? 0 : '0 0 4px',
          padding: '12px 16px',
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{
            color: 'var(--red)',
            fontSize: 'var(--text-xs)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          <AlertTriangle size={12} strokeWidth={1.5} />
          Mermaid parse error
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 8,
          }}
        >
          {errorMessage}
        </div>
        <pre
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '3px',
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            fontSize: 'var(--text-sm)',
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}
        >
          {rawSource}
        </pre>
        <CopyButton content={rawSource} />
      </div>
    )
  }

  const toolbar = (
    <div
      className="flex items-center justify-between px-3"
      style={{
        height: 32,
        borderBottom: isCollapsed ? 'none' : '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}
    >
      <div className="flex items-center min-w-0" style={{ gap: 4 }}>
        {collapsible && (
          <ToolbarButton
            onClick={() => setCollapsed((v) => !v)}
            title={isCollapsed ? 'Expand diagram' : 'Collapse diagram'}
            ariaLabel={isCollapsed ? 'Expand Mermaid diagram' : 'Collapse Mermaid diagram'}
            ariaExpanded={!isCollapsed}
          >
            {isCollapsed
              ? <ChevronRight size={14} strokeWidth={1.5} />
              : <ChevronDown size={14} strokeWidth={1.5} />}
          </ToolbarButton>
        )}
        <span
          className="truncate"
          style={{
            color: 'var(--text-dim)',
            fontSize: 'var(--text-xs)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Mermaid
        </span>
      </div>
      <div className="flex items-center" style={{ gap: 2 }}>
        {!isCollapsed && !showSource && (
          <ToolbarButton onClick={() => setExpanded(true)} title="Expand">
            <Maximize2 size={14} strokeWidth={1.5} />
          </ToolbarButton>
        )}
        {!isCollapsed && (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="inline-flex items-center gap-1"
            title={showSource ? 'Show diagram' : 'Show source'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
              color: 'var(--text-dim)',
              fontSize: 'var(--text-xs)',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            {showSource
              ? <><Eye size={12} strokeWidth={1.5} /> Diagram</>
              : <><Code2 size={12} strokeWidth={1.5} /> Source</>}
          </button>
        )}
        <CopyButton content={rawSource} inline />
      </div>
    </div>
  )

  return (
    <>
      <div
        className="copyable-block"
        style={{
          position: 'relative',
          width: '100%',
          minWidth: 0,
          ...(fill ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          margin: fill ? 0 : '0 0 4px',
          overflow: 'hidden',
        }}
      >
        {toolbar}

        {isCollapsed ? null : showSource ? (
          <pre
            style={{
              ...(fill ? { flex: 1, minHeight: 0 } : {}),
              margin: 0,
              padding: '12px 16px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 'var(--text-sm)',
              lineHeight: '20px',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {rawSource}
          </pre>
        ) : status !== 'ready' ? (
          <div style={{ padding: 16, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
            <div className="skeleton" style={{ width: '100%', height: fill ? '100%' : 120, minHeight: 120 }} />
          </div>
        ) : (
          <DiagramViewport svg={svg} fill={fill} />
        )}
      </div>

      {expanded && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'var(--bg-overlay)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4vh 4vw',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false) }}
        >
          <div
            className="flex flex-col"
            style={{
              width: '100%',
              height: '100%',
              maxWidth: 1600,
              maxHeight: '92vh',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              className="flex items-center justify-between px-3"
              style={{
                height: 36,
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                Mermaid · Expanded
              </span>
              <div className="flex items-center" style={{ gap: 2 }}>
                <ToolbarButton onClick={() => setExpanded(false)} title="Close (Esc)" ariaLabel="Close">
                  <X size={14} strokeWidth={1.5} />
                </ToolbarButton>
              </div>
            </div>
            <DiagramViewport svg={svg} padding={24} fill />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
