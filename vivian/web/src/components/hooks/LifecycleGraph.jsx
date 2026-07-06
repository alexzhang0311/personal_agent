import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Minus, Maximize2, X, Info } from 'lucide-react'
import useHooksStore from '../../stores/hooksStore'
import {
  HOOK_DEFINITIONS,
  PHASE_COLORS,
  GRAPH_LAYOUT,
  GRAPH_EDGES,
  DECORATOR_NODES,
} from '../../data/hookDefinitions'

// Build lookup for all nodes (hooks + decorators)
const allNodes = {
  ...GRAPH_LAYOUT,
  ...Object.fromEntries(DECORATOR_NODES.map(d => [d.id, { x: d.x, y: d.y, w: d.w, h: d.h }])),
}

const hookMap = Object.fromEntries(HOOK_DEFINITIONS.map(h => [h.id, h]))

const BASE_W = 960
const BASE_H = 520
const MIN_ZOOM = 0.4
const MAX_ZOOM = 3
const ZOOM_FACTOR = 0.08

// Approximate character width for JetBrains Mono at 12px
const MONO_CHAR_W = 7.2

function getEdgePath(fromId, toId) {
  const from = allNodes[fromId]
  const to = allNodes[toId]
  if (!from || !to) return ''

  const fromCx = from.x + from.w / 2
  const fromCy = from.y + from.h / 2
  const toCx = to.x + to.w / 2
  const toCy = to.y + to.h / 2
  const dy = toCy - fromCy

  if (Math.abs(dy) < 10) {
    return `M ${from.x + from.w} ${fromCy} L ${to.x} ${toCy}`
  }

  const startX = fromCx
  const startY = from.y + from.h
  const endX = toCx
  const endY = to.y
  const midY = Math.round((startY + endY) / 2)

  return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`
}

const zoomBtnStyle = {
  width: 28, height: 28, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', borderRadius: 2,
  transition: 'color 150ms ease, background 150ms ease',
}

export default function LifecycleGraph() {
  const { t } = useTranslation()
  const selectedHookId = useHooksStore((s) => s.selectedHookId)
  const selectHook = useHooksStore((s) => s.selectHook)
  const clearSelection = useHooksStore((s) => s.clearSelection)
  const configuredHooks = useHooksStore((s) => s.configuredHooks)
  const [hoveredNode, setHoveredNode] = useState(null)

  // Popup bubble — stores hookId only; position computed from SVG coords each render
  const [popupHookId, setPopupHookId] = useState(null)
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  // Zoom & pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const didPanRef = useRef(false)
  const svgRef = useRef(null)

  // Track container size for popup positioning
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Derived viewBox
  const vw = BASE_W / zoom
  const vh = BASE_H / zoom
  const viewBox = `${pan.x} ${pan.y} ${vw} ${vh}`

  // Compute popup screen position from SVG coords (anchored to node, moves with pan/zoom)
  const popupAnchor = popupHookId ? GRAPH_LAYOUT[popupHookId] : null
  const popupHook = popupHookId ? hookMap[popupHookId] : null
  let popupLeft = 0, popupTop = 0
  if (popupAnchor && containerSize.w > 0) {
    const displayScale = Math.min(containerSize.w / vw, containerSize.h / vh)
    popupLeft = (popupAnchor.x + popupAnchor.w / 2 - pan.x) * displayScale
    popupTop = (popupAnchor.y - pan.y) * displayScale
  }

  // Wheel zoom (attached via ref for passive: false)
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()

    const mx = (e.clientX - rect.left) / rect.width
    const my = (e.clientY - rect.top) / rect.height

    setZoom(prevZoom => {
      const direction = e.deltaY > 0 ? -1 : 1
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * (1 + direction * ZOOM_FACTOR)))
      const oldVw = BASE_W / prevZoom
      const oldVh = BASE_H / prevZoom
      const newVw = BASE_W / newZoom
      const newVh = BASE_H / newZoom

      setPan(prev => ({
        x: prev.x + (oldVw - newVw) * mx,
        y: prev.y + (oldVh - newVh) * my,
      }))

      return newZoom
    })
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Pan via mouse drag on background
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target.tagName === 'svg' || e.target.classList.contains('graph-bg')) {
      setIsPanning(true)
      panStartRef.current = { x: e.clientX, y: e.clientY }
      didPanRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isPanning) return

    const handleMouseMove = (e) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const dx = (e.clientX - panStartRef.current.x) * (vw / rect.width)
      const dy = (e.clientY - panStartRef.current.y) * (vh / rect.height)

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        didPanRef.current = true
      }

      setPan(prev => ({ x: prev.x - dx, y: prev.y - dy }))
      panStartRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseUp = () => {
      setIsPanning(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isPanning, vw, vh])

  // Click on background — clear selection + close popup
  const handleSvgClick = useCallback((e) => {
    if (didPanRef.current) return
    if (e.target.tagName === 'svg' || e.target.classList.contains('graph-bg')) {
      clearSelection()
      setPopupHookId(null)
    }
  }, [clearSelection])

  // Double-click background — reset zoom/pan
  const handleDoubleClick = useCallback((e) => {
    if (e.target.tagName === 'svg' || e.target.classList.contains('graph-bg')) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [])

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoom(prev => {
      const newZoom = Math.min(MAX_ZOOM, prev * (1 + ZOOM_FACTOR * 2))
      const oldVw = BASE_W / prev
      const oldVh = BASE_H / prev
      const newVw = BASE_W / newZoom
      const newVh = BASE_H / newZoom
      setPan(p => ({ x: p.x + (oldVw - newVw) / 2, y: p.y + (oldVh - newVh) / 2 }))
      return newZoom
    })
  }, [])

  const zoomOut = useCallback(() => {
    setZoom(prev => {
      const newZoom = Math.max(MIN_ZOOM, prev * (1 - ZOOM_FACTOR * 2))
      const oldVw = BASE_W / prev
      const oldVh = BASE_H / prev
      const newVw = BASE_W / newZoom
      const newVh = BASE_H / newZoom
      setPan(p => ({ x: p.x + (oldVw - newVw) / 2, y: p.y + (oldVh - newVh) / 2 }))
      return newZoom
    })
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  return (
    <div ref={containerRef} className="relative" style={{ width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMinYMin meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onClick={handleSvgClick}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              style={{ fill: 'var(--text-dim)' }}
            />
          </marker>
          <marker
            id="arrowhead-dim"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              style={{ fill: 'var(--text-dim)', opacity: 0.3 }}
            />
          </marker>
        </defs>

        {/* Transparent background for click/pan/double-click */}
        <rect className="graph-bg" x="-2000" y="-2000" width="5000" height="5000" fill="transparent" />

        {/* Pipeline section labels */}
        <text
          x="218" y="148"
          textAnchor="end"
          style={{
            fill: 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            fontFamily: "'Noto Sans', sans-serif",
          }}
        >
          TOOL PIPELINE
        </text>
        <text
          x="673" y="148"
          textAnchor="end"
          style={{
            fill: 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            fontFamily: "'Noto Sans', sans-serif",
          }}
        >
          AGENT PIPELINE
        </text>

        {/* Edges */}
        {GRAPH_EDGES.map((edge, i) => {
          const path = getEdgePath(edge.from, edge.to)
          const isDimmed = selectedHookId &&
            edge.from !== selectedHookId &&
            edge.to !== selectedHookId
          return (
            <path
              key={i}
              d={path}
              fill="none"
              style={{
                stroke: 'var(--text-dim)',
                strokeWidth: 1.5,
                opacity: isDimmed ? 0.15 : 0.6,
                transition: 'opacity 200ms ease',
              }}
              strokeDasharray={edge.dashed ? '6 3' : undefined}
              markerEnd={isDimmed ? 'url(#arrowhead-dim)' : 'url(#arrowhead)'}
            />
          )
        })}

        {/* Decorator nodes */}
        {DECORATOR_NODES.map((node) => {
          const isDimmed = selectedHookId != null
          return (
            <g key={node.id} style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 200ms ease' }}>
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx="4"
                style={{
                  fill: 'var(--bg-base)',
                  stroke: 'var(--border-strong)',
                  strokeWidth: 1.5,
                  strokeDasharray: '4 2',
                }}
              />
              <text
                x={node.x + node.w / 2}
                y={node.y + node.h / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fill: 'var(--text-dim)',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontStyle: 'italic',
                }}
              >
                {node.label}
              </text>
            </g>
          )
        })}

        {/* Hook nodes */}
        {HOOK_DEFINITIONS.map((hook) => {
          const pos = GRAPH_LAYOUT[hook.id]
          if (!pos) return null
          const isSelected = selectedHookId === hook.id
          const isDimmed = selectedHookId != null && !isSelected
          const isHovered = hoveredNode === hook.id
          const handlerCount = configuredHooks[hook.id]?.handlers?.length || 0
          const phaseColor = PHASE_COLORS[hook.phase]
          const textCx = pos.x + pos.w / 2
          const textCy = pos.y + pos.h / 2
          // Red dot position: right after the hook name text
          const textHalfW = (hook.id.length * MONO_CHAR_W) / 2
          const dotCx = textCx + textHalfW + 7

          return (
            <g
              key={hook.id}
              style={{
                cursor: 'pointer',
                opacity: isDimmed ? 0.3 : 1,
                transition: 'opacity 200ms ease',
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isSelected) {
                  clearSelection()
                  setPopupHookId(null)
                } else {
                  selectHook(hook.id)
                  setPopupHookId(hook.id)
                }
              }}
              onMouseEnter={() => setHoveredNode(hook.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.w}
                height={pos.h}
                rx="4"
                style={{
                  fill: isSelected || isHovered ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  stroke: phaseColor,
                  strokeWidth: isSelected ? 2.5 : 1.5,
                  transition: 'fill 150ms ease, stroke-width 200ms ease',
                }}
              />
              <text
                x={textCx}
                y={handlerCount > 0 ? textCy - 4 : textCy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fill: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                }}
              >
                {hook.id}
              </text>
              {handlerCount > 0 && (
                <text
                  x={textCx}
                  y={textCy + 8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fill: 'var(--text-dim)',
                    fontSize: 10,
                    fontFamily: "'Noto Sans', sans-serif",
                  }}
                >
                  configured: {handlerCount}
                </text>
              )}
              {/* Can-block red dot — right after hook name */}
              {hook.canBlock && (
                <circle
                  cx={dotCx}
                  cy={handlerCount > 0 ? textCy - 4 : textCy + 1}
                  r={3.5}
                  style={{ fill: 'var(--red)' }}
                />
              )}
            </g>
          )
        })}

        {/* Legend */}
        <g transform="translate(830, 90)">
          {[
            { key: 'session', color: 'var(--green)', labelKey: 'hooks.legendSession' },
            { key: 'tool', color: 'var(--blue)', labelKey: 'hooks.legendTool' },
            { key: 'agent', color: 'var(--purple)', labelKey: 'hooks.legendAgent' },
            { key: 'misc', color: 'var(--yellow)', labelKey: 'hooks.legendMisc' },
          ].map((item, i) => (
            <g key={item.key} transform={`translate(0, ${i * 18})`}>
              <rect x="0" y="0" width="8" height="8" rx="1" style={{ fill: item.color }} />
              <text
                x="14"
                y="8"
                style={{
                  fill: 'var(--text-dim)',
                  fontSize: 10,
                  fontFamily: "'Noto Sans', sans-serif",
                }}
              >
                {t(item.labelKey)}
              </text>
            </g>
          ))}
          <g transform={`translate(0, ${4 * 18})`}>
            <circle cx="4" cy="4" r="4" style={{ fill: 'var(--red)' }} />
            <text
              x="14"
              y="8"
              style={{
                fill: 'var(--text-dim)',
                fontSize: 10,
                fontFamily: "'Noto Sans', sans-serif",
              }}
            >
              {t('hooks.legendCanBlock')}
            </text>
          </g>
        </g>
      </svg>

      {/* Popup info bubble — anchored to node, moves with pan/zoom, fixed size */}
      {popupHook && containerSize.w > 0 && (
        <div
          className="absolute"
          style={{
            left: Math.max(8, Math.min(popupLeft - 160, containerSize.w - 328)),
            top: Math.max(8, popupTop - 8),
            width: 320,
            maxHeight: 280,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            zIndex: 20,
            overflowY: 'auto',
            transform: 'translateY(-100%)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <Info size={14} strokeWidth={1.5} style={{ color: PHASE_COLORS[popupHook.phase], flexShrink: 0 }} />
            <span
              className="flex-1 font-semibold truncate"
              style={{ fontSize: 13, color: 'var(--text-primary)' }}
            >
              {popupHook.id}
            </span>
            {popupHook.canBlock && (
              <span
                className="flex-shrink-0"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--red)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {t('hooks.block')}
              </span>
            )}
            <button
              style={{
                width: 22, height: 22, background: 'transparent', border: 'none',
                cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', borderRadius: 2,
                transition: 'color 150ms ease',
                flexShrink: 0,
              }}
              onClick={() => setPopupHookId(null)}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
          {/* Description */}
          <div className="px-3 py-2" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t(popupHook.descriptionKey)}
          </div>
          {/* Usage details */}
          <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            {t(popupHook.usageKey).split('\n').map((line, i) => {
              const colonIdx = line.indexOf(':')
              if (colonIdx === -1) return (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: i > 0 ? 6 : 0 }}>{line}</div>
              )
              const label = line.slice(0, colonIdx)
              const content = line.slice(colonIdx + 1).trim()
              return (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.5, marginTop: i > 0 ? 6 : 0 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{label}:</span>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{content}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Zoom controls overlay */}
      <div
        className="absolute flex items-center gap-1"
        style={{
          bottom: 12,
          right: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '2px',
        }}
      >
        <button
          style={zoomBtnStyle}
          onClick={zoomOut}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
          title="Zoom out"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          style={{
            ...zoomBtnStyle,
            width: 'auto',
            padding: '0 6px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
          onClick={resetView}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          style={zoomBtnStyle}
          onClick={zoomIn}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
          title="Zoom in"
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
        <button
          style={zoomBtnStyle}
          onClick={resetView}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
          title="Fit to view"
        >
          <Maximize2 size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
