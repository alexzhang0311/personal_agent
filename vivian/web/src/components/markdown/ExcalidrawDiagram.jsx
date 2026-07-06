import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Code2,
  Eye,
  Maximize2,
  X,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react'
import CopyButton from '../shared/CopyButton'

function normalizeExcalidrawSource(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').replace(/^﻿/, '').trim()
  text = text.replace(/^```\s*excalidraw\s*\n/i, '').replace(/\n```\s*$/i, '')
  return text.trim()
}

const LINEAR_TYPES = new Set(['line', 'arrow', 'freedraw'])

function isPointTuple(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
}

function normalizeLinearPoints(points, width, height) {
  if (Array.isArray(points) && points.every(isPointTuple)) {
    return points.map(([x, y]) => [Number(x), Number(y)])
  }

  if (Array.isArray(points) && points.every((value) => Number.isFinite(Number(value)))) {
    const tuples = []
    for (let i = 0; i + 1 < points.length; i += 2) {
      tuples.push([Number(points[i]), Number(points[i + 1])])
    }
    if (tuples.length >= 2) return tuples
  }

  return [[0, 0], [Number(width) || 0, Number(height) || 0]]
}

// Excalidraw's internal restore() assumes a handful of element fields exist
// and will throw outside its own try/catch if they're missing — most often
// `points` on a line/arrow/freedraw element. Backfill the minimal set so a
// hand-written or LLM-generated payload doesn't kill the whole component.
function sanitizeElement(el) {
  if (!el || typeof el !== 'object') return null
  const out = { ...el }
  if (LINEAR_TYPES.has(out.type)) {
    out.points = normalizeLinearPoints(out.points, out.width, out.height)
  }
  if (out.type === 'arrow') {
    if (out.startArrowhead == null && out.startArrowHead != null) {
      out.startArrowhead = out.startArrowHead
    }
    if (out.endArrowhead == null && out.endArrowHead != null) {
      out.endArrowhead = out.endArrowHead
    }
    delete out.startArrowHead
    delete out.endArrowHead
  }
  if (!Array.isArray(out.groupIds)) out.groupIds = []
  if (out.boundElements !== null && !Array.isArray(out.boundElements)) {
    out.boundElements = null
  }
  return out
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : null
}

function getElementAnimation(element) {
  if (!element || typeof element !== 'object') return null
  const custom = element.customData?.animate
  const customOrder = numberOrNull(custom?.order)
  const customDuration = numberOrNull(custom?.duration)
  const idOrder = numberOrNull(String(element.id || '').match(/animateOrder:(-?\d+)/)?.[1])
  const idDuration = numberOrNull(String(element.id || '').match(/animateDuration:(-?\d+)/)?.[1])
  if (customOrder === null && customDuration === null && idOrder === null && idDuration === null) {
    return null
  }
  return {
    order: customOrder ?? idOrder ?? 0,
    duration: customDuration ?? idDuration ?? null,
  }
}

function hasAnimationMetadata(elements) {
  return elements.some((element) => getElementAnimation(element))
}

function parseExcalidraw(text) {
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object') throw new Error('Not a JSON object')
  if (!Array.isArray(data.elements)) throw new Error('Missing "elements" array')
  const elements = data.elements.map(sanitizeElement).filter(Boolean)
  return {
    elements,
    appState: data.appState && typeof data.appState === 'object' ? data.appState : {},
    files: data.files && typeof data.files === 'object' ? data.files : {},
    raw: data,
    hasAnimation: hasAnimationMetadata(elements),
  }
}

let excalidrawPromise = null
function loadExcalidraw() {
  if (!excalidrawPromise) {
    excalidrawPromise = Promise.all([
      import('@excalidraw/excalidraw'),
      import('@excalidraw/excalidraw/index.css'),
    ]).then(([mod]) => mod.Excalidraw)
  }
  return excalidrawPromise
}

let animatedExcalidrawPromise = null
function loadAnimatedExcalidraw() {
  if (!animatedExcalidrawPromise) {
    animatedExcalidrawPromise = Promise.all([
      import('@excalidraw/excalidraw'),
      import('excalidraw-animate'),
    ]).then(([excalidrawMod, animateMod]) => ({
      exportToSvg: excalidrawMod.exportToSvg,
      getNonDeletedElements: excalidrawMod.getNonDeletedElements,
      animateSvg: animateMod.animateSvg,
    }))
  }
  return animatedExcalidrawPromise
}

function getThemeKey() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme || 'dark'
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

function applyAnimateToken(id, key, value) {
  const nextValue = numberOrNull(value)
  if (nextValue === null) return id
  const text = String(id || '')
  const pattern = new RegExp(`${key}:-?\\d+`)
  if (pattern.test(text)) return text.replace(pattern, `${key}:${nextValue}`)
  return `${text}-${key}:${nextValue}`
}

function prepareAnimatedElements(elements) {
  const idMap = new Map()
  const firstPass = elements.map((element) => {
    const animation = getElementAnimation(element)
    if (!animation) return element
    let id = applyAnimateToken(element.id, 'animateOrder', animation.order)
    if (animation.duration !== null) {
      id = applyAnimateToken(id, 'animateDuration', animation.duration)
    }
    if (id !== element.id) idMap.set(element.id, id)
    return { ...element, id }
  })

  if (idMap.size === 0) return firstPass

  const mapId = (id) => idMap.get(id) || id
  return firstPass.map((element) => {
    const next = { ...element }
    if (next.containerId) next.containerId = mapId(next.containerId)
    if (next.frameId) next.frameId = mapId(next.frameId)
    if (Array.isArray(next.boundElements)) {
      next.boundElements = next.boundElements.map((bound) => (
        bound && typeof bound === 'object' ? { ...bound, id: mapId(bound.id) } : bound
      ))
    }
    if (next.startBinding?.elementId) {
      next.startBinding = { ...next.startBinding, elementId: mapId(next.startBinding.elementId) }
    }
    if (next.endBinding?.elementId) {
      next.endBinding = { ...next.endBinding, elementId: mapId(next.endBinding.elementId) }
    }
    return next
  })
}

function safeAppStateFromScene(scene) {
  const src = scene.appState || {}
  const safeAppState = {
    viewBackgroundColor: typeof src.viewBackgroundColor === 'string'
      ? src.viewBackgroundColor : 'transparent',
  }
  if (typeof src.gridSize === 'number') safeAppState.gridSize = src.gridSize
  if (typeof src.zoom === 'object' && src.zoom) safeAppState.zoom = src.zoom
  return safeAppState
}

function ToolbarButton({ children, onClick, disabled, title, ariaLabel, ariaExpanded, active }) {
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
        color: disabled ? 'var(--text-dim)' : active ? 'var(--text-primary)' : 'var(--text-secondary)',
        opacity: disabled ? 0.5 : 1,
        transition: 'color 150ms ease',
        borderRadius: '2px',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

function ToolbarTextButton({ children, onClick, disabled, title, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center justify-center whitespace-nowrap"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: '1px solid var(--border-subtle)',
        borderRadius: '3px',
        color: disabled ? 'var(--text-dim)' : active ? 'var(--text-primary)' : 'var(--text-dim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        height: 22,
        letterSpacing: 'var(--tracking-wide)',
        opacity: disabled ? 0.5 : 1,
        padding: '0 6px',
        textTransform: 'uppercase',
        transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.color = 'var(--text-primary)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-dim)'
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
      }}
    >
      {children}
    </button>
  )
}

function ExcalidrawCanvas({ scene, themeKey, fill }) {
  const [Excalidraw, setExcalidraw] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // Defer mounting <Excalidraw/> past React StrictMode's dev-only
  // double-mount/unmount cycle. Excalidraw v0.18 leaks state across that
  // cycle and never clears its internal `isLoading` flag, leaving the
  // "Loading scene…" overlay stuck. The setTimeout's clearTimeout cancels
  // the first scheduled mount during the StrictMode unmount, so Excalidraw
  // mounts exactly once.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadExcalidraw()
      .then((Component) => { if (!cancelled) setExcalidraw(() => Component) })
      .catch((err) => { if (!cancelled) setLoadError(err?.message || String(err)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setReady(true), 0)
    return () => clearTimeout(id)
  }, [])

  const theme = themeKey === 'light' ? 'light' : 'dark'

  // Only pull a small whitelist of fields off the file's appState — spreading
  // the whole thing crashes Excalidraw's restore() on stale/renamed keys
  // (e.g. removed `collaborators`, legacy `gridSize`), and that crash happens
  // outside its try/catch so the "Loading scene…" overlay never clears.
  const initialData = useMemo(() => {
    return {
      elements: scene.elements,
      appState: safeAppStateFromScene(scene),
      files: scene.files,
      scrollToContent: scene.elements.length > 0,
    }
  }, [scene])

  if (loadError) {
    return (
      <div
        style={{
          padding: 16,
          color: 'var(--red)',
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          fontSize: 'var(--text-sm)',
        }}
      >
        Failed to load Excalidraw: {loadError}
      </div>
    )
  }

  if (!Excalidraw || !ready) {
    return (
      <div style={{ padding: 16, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
        <div className="skeleton" style={{ width: '100%', height: fill ? '100%' : 120, minHeight: 120 }} />
      </div>
    )
  }

  return (
    <div
      style={{
        ...(fill ? { flex: 1, minHeight: 0 } : { height: 420 }),
        width: '100%',
        minWidth: 0,
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {createElement(Excalidraw, {
        initialData,
        viewModeEnabled: true,
        zenModeEnabled: false,
        gridModeEnabled: false,
        theme,
        UIOptions: {
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        },
      })}
    </div>
  )
}

function AnimatedExcalidrawCanvas({ scene, fill, paused, resetNonce }) {
  const hostRef = useRef(null)
  const [svgState, setSvgState] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    let svgForCleanup = null
    setSvgState(null)
    setLoadError(null)

    loadAnimatedExcalidraw()
      .then(async ({ exportToSvg, getNonDeletedElements, animateSvg }) => {
        const files = scene.files || {}
        const animatedElements = prepareAnimatedElements(scene.elements)
        const elements = getNonDeletedElements(animatedElements).filter((element) => {
          if (element.type !== 'image') return true
          return element.fileId && files[element.fileId]
        })
        const svg = await exportToSvg({
          elements,
          files,
          appState: safeAppStateFromScene(scene),
          exportPadding: 30,
        })
        svg.setAttribute('width', '100%')
        svg.setAttribute('height', '100%')
        svg.style.display = 'block'
        svg.style.maxWidth = '100%'
        svg.style.maxHeight = '100%'
        svg.style.width = '100%'
        svg.style.height = '100%'
        const result = animateSvg(svg, elements)
        svgForCleanup = svg
        if (!cancelled) setSvgState({ svg, finishedMs: result.finishedMs })
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || String(err))
      })

    return () => {
      cancelled = true
      if (svgForCleanup) svgForCleanup.remove()
    }
  }, [scene])

  useEffect(() => {
    const host = hostRef.current
    const svg = svgState?.svg
    if (!host || !svg) return undefined
    host.replaceChildren(svg)
    if (paused) svg.pauseAnimations()
    return () => {
      svg.remove()
    }
  }, [svgState])

  useEffect(() => {
    const svg = svgState?.svg
    if (!svg) return
    if (paused) {
      svg.pauseAnimations()
    } else {
      svg.unpauseAnimations()
    }
  }, [paused, svgState])

  useEffect(() => {
    const svg = svgState?.svg
    if (!svg || resetNonce === 0) return
    svg.setCurrentTime(0)
    if (paused) svg.pauseAnimations()
  }, [paused, resetNonce, svgState])

  if (loadError) {
    return (
      <div
        style={{
          ...(fill ? { flex: 1, minHeight: 0 } : { height: 420 }),
          padding: 16,
          color: 'var(--red)',
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          fontSize: 'var(--text-sm)',
        }}
      >
        Failed to render Excalidraw animation: {loadError}
      </div>
    )
  }

  if (!svgState) {
    return (
      <div style={{ padding: 16, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
        <div className="skeleton" style={{ width: '100%', height: fill ? '100%' : 120, minHeight: 120 }} />
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      style={{
        ...(fill ? { flex: 1, minHeight: 0 } : { height: 420 }),
        width: '100%',
        minWidth: 0,
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
        position: 'relative',
      }}
    />
  )
}

function ExcalidrawSceneView({ scene, themeKey, fill, animated, paused, resetNonce }) {
  if (animated && scene.hasAnimation) {
    return <AnimatedExcalidrawCanvas scene={scene} fill={fill} paused={paused} resetNonce={resetNonce} />
  }
  return <ExcalidrawCanvas scene={scene} themeKey={themeKey} fill={fill} />
}

export default function ExcalidrawDiagram({ code, fill = false, collapsible = false, defaultCollapsed = false }) {
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [showAnimated, setShowAnimated] = useState(false)
  const [animationPaused, setAnimationPaused] = useState(false)
  const [animationResetNonce, setAnimationResetNonce] = useState(0)
  const themeKey = useThemeKey()
  const rawSource = String(code || '').trim()
  const source = useMemo(() => normalizeExcalidrawSource(code), [code])
  const isCollapsed = collapsible && collapsed

  const parseResult = useMemo(() => {
    if (!source) return { error: 'Empty diagram', scene: null, pretty: '' }
    try {
      const scene = parseExcalidraw(source)
      const pretty = JSON.stringify(scene.raw, null, 2)
      return { error: null, scene, pretty }
    } catch (err) {
      return { error: err?.message || String(err), scene: null, pretty: '' }
    }
  }, [source])

  const hasAnimation = Boolean(parseResult.scene?.hasAnimation)

  useEffect(() => {
    setShowAnimated(hasAnimation)
    setAnimationPaused(false)
    setAnimationResetNonce(0)
  }, [hasAnimation, source])

  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setExpanded(false) }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

  if (parseResult.error) {
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
          Excalidraw parse error
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
          {parseResult.error}
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
            ariaLabel={isCollapsed ? 'Expand Excalidraw diagram' : 'Collapse Excalidraw diagram'}
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
          {hasAnimation ? 'Excalidraw Animate' : 'Excalidraw'}
        </span>
      </div>
      <div className="flex items-center" style={{ gap: 2 }}>
        {hasAnimation && !isCollapsed && !showSource && (
          <>
            <ToolbarTextButton
              onClick={() => {
                setShowAnimated((value) => !value)
                setAnimationPaused(false)
                setAnimationResetNonce((value) => value + 1)
              }}
              title={showAnimated ? 'Show static preview' : 'Show animated preview'}
            >
              {showAnimated ? 'Static' : 'Animate'}
            </ToolbarTextButton>
            {showAnimated && (
              <>
                <ToolbarButton
                  onClick={() => setAnimationPaused((value) => !value)}
                  title={animationPaused ? 'Play animation' : 'Pause animation'}
                  active={!animationPaused}
                >
                  {animationPaused
                    ? <Play size={14} strokeWidth={1.5} />
                    : <Pause size={14} strokeWidth={1.5} />}
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => setAnimationResetNonce((value) => value + 1)}
                  title="Restart animation"
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                </ToolbarButton>
              </>
            )}
          </>
        )}
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
            {parseResult.pretty}
          </pre>
        ) : (
          <ExcalidrawSceneView
            scene={parseResult.scene}
            themeKey={themeKey}
            fill={fill}
            animated={showAnimated}
            paused={animationPaused}
            resetNonce={animationResetNonce}
          />
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
                {hasAnimation && showAnimated ? 'Excalidraw Animate · Expanded' : 'Excalidraw · Expanded'}
              </span>
              <div className="flex items-center" style={{ gap: 2 }}>
                {hasAnimation && showAnimated && (
                  <>
                    <ToolbarButton
                      onClick={() => setAnimationPaused((value) => !value)}
                      title={animationPaused ? 'Play animation' : 'Pause animation'}
                      active={!animationPaused}
                    >
                      {animationPaused
                        ? <Play size={14} strokeWidth={1.5} />
                        : <Pause size={14} strokeWidth={1.5} />}
                    </ToolbarButton>
                    <ToolbarButton
                      onClick={() => setAnimationResetNonce((value) => value + 1)}
                      title="Restart animation"
                    >
                      <RotateCcw size={14} strokeWidth={1.5} />
                    </ToolbarButton>
                  </>
                )}
                <ToolbarButton onClick={() => setExpanded(false)} title="Close (Esc)" ariaLabel="Close">
                  <X size={14} strokeWidth={1.5} />
                </ToolbarButton>
              </div>
            </div>
            <ExcalidrawSceneView
              scene={parseResult.scene}
              themeKey={themeKey}
              fill
              animated={showAnimated}
              paused={animationPaused}
              resetNonce={animationResetNonce}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
