import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, X, Plus,
  SquareTerminal as TerminalIcon,
  ExternalLink, Maximize2, Minimize2, PanelBottom,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import useUiStore from '../../stores/uiStore'
import useAuthStore from '../../stores/authStore'
import { useResizable } from '../../hooks/useResizable'
import { useDraggable } from '../../hooks/useDraggable'
import { useEdgeResizable } from '../../hooks/useEdgeResizable'
import TerminalSession from './TerminalSession'

const HEADER_HEIGHT = 36
const TAB_LABEL_FALLBACK = 'shell'
const EDGE_THICKNESS = 4
const CORNER_SIZE = 12
const EXPAND_MARGIN = 24
const MIN_FLOAT_WIDTH = 320
const MIN_FLOAT_HEIGHT = 200

function shortCwd(cwd) {
  if (!cwd) return TAB_LABEL_FALLBACK
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] || TAB_LABEL_FALLBACK
}

function newTabId() {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export default function WebTerminalDrawer() {
  const { t } = useTranslation()
  const open = useUiStore((s) => s.terminalOpen)
  const minimized = useUiStore((s) => s.terminalMinimized)
  const setMinimized = useUiStore((s) => s.setTerminalMinimized)
  const height = useUiStore((s) => s.terminalHeight)
  const setHeight = useUiStore((s) => s.setTerminalHeight)
  const setOpen = useUiStore((s) => s.setTerminalOpen)
  const acked = useUiStore((s) => s.terminalConfirmAcked)
  const setAcked = useUiStore((s) => s.setTerminalConfirmAcked)
  const showConfirm = useUiStore((s) => s.showConfirmDialog)
  const setSessionActive = useUiStore((s) => s.setTerminalSessionActive)
  const setActiveCount = useUiStore((s) => s.setTerminalActiveCount)
  const mode = useUiStore((s) => s.terminalMode)
  const setMode = useUiStore((s) => s.setTerminalMode)
  const bounds = useUiStore((s) => s.terminalBounds)
  const setBounds = useUiStore((s) => s.setTerminalBounds)
  const user = useAuthStore((s) => s.user)

  // Each tab: { id, ready, cwd, customLabel? }
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Dock-mode top-edge resize (only used when mode === 'dock')
  const dockResize = useResizable({
    initial: height,
    min: 160,
    max: typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600,
    direction: 'up',
    onResize: setHeight,
  })

  // Float-mode drag / resize bounds — floating window can overlap sidebar
  // and navbar, so we only clamp against the viewport itself.
  const dragBounds = useCallback(() => ({
    minX: 0,
    minY: 0,
    maxX: (typeof window !== 'undefined' ? window.innerWidth : 9999) - 80,
    maxY: (typeof window !== 'undefined' ? window.innerHeight : 9999) - 40,
  }), [])

  const resizeBounds = useCallback(() => ({
    minX: 0,
    minY: 0,
    maxX: typeof window !== 'undefined' ? window.innerWidth : 9999,
    maxY: typeof window !== 'undefined' ? window.innerHeight : 9999,
  }), [])

  const resizeMin = useMemo(() => ({ width: MIN_FLOAT_WIDTH, height: MIN_FLOAT_HEIGHT }), [])

  const handleDrag = useCallback(({ x, y }) => setBounds({ x, y }), [setBounds])
  const handleResize = useCallback((rect) => setBounds(rect), [setBounds])

  const dragHandle = useDraggable({
    initial: { x: bounds.x, y: bounds.y },
    onDrag: handleDrag,
    bounds: dragBounds,
  })

  const edgeN  = useEdgeResizable({ initial: bounds, edge: 'n',  min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeS  = useEdgeResizable({ initial: bounds, edge: 's',  min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeE  = useEdgeResizable({ initial: bounds, edge: 'e',  min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeW  = useEdgeResizable({ initial: bounds, edge: 'w',  min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeNE = useEdgeResizable({ initial: bounds, edge: 'ne', min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeNW = useEdgeResizable({ initial: bounds, edge: 'nw', min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeSE = useEdgeResizable({ initial: bounds, edge: 'se', min: resizeMin, onResize: handleResize, bounds: resizeBounds })
  const edgeSW = useEdgeResizable({ initial: bounds, edge: 'sw', min: resizeMin, onResize: handleResize, bounds: resizeBounds })

  // Reflect "any active session" state + count to the navbar indicator.
  useEffect(() => {
    const ready = tabs.filter((tab) => tab.ready).length
    setSessionActive(ready > 0)
    setActiveCount(ready)
  }, [tabs, setSessionActive, setActiveCount])

  // First-open confirm dialog (once per page session).
  const requestOpenIfNeeded = useCallback(() => {
    if (acked) return
    showConfirm({
      title: t('terminal.confirmTitle'),
      message: t('terminal.confirmBody'),
      confirmLabel: t('terminal.confirmContinue'),
      danger: true,
      onConfirm: () => setAcked(true),
    })
  }, [acked, setAcked, showConfirm, t])

  useEffect(() => {
    if (open && !acked) requestOpenIfNeeded()
  }, [open, acked, requestOpenIfNeeded])

  // When the drawer opens (and is acked), ensure at least one tab exists.
  useEffect(() => {
    if (!open || !acked) return
    setTabs((prev) => {
      if (prev.length > 0) return prev
      const id = newTabId()
      setActiveId(id)
      return [{ id, ready: false, cwd: '' }]
    })
  }, [open, acked])

  // When the drawer fully closes, drop all tabs (force-disconnects sessions via unmount).
  useEffect(() => {
    if (!open) {
      setTabs([])
      setActiveId(null)
    }
  }, [open])

  // Remember the last non-expanded mode so double-click can toggle back.
  const lastNonExpandedRef = useRef(mode === 'expanded' ? 'float' : mode)
  useEffect(() => {
    if (mode !== 'expanded') lastNonExpandedRef.current = mode
  }, [mode])

  const toggleExpanded = useCallback(() => {
    if (mode === 'expanded') setMode(lastNonExpandedRef.current || 'float')
    else setMode('expanded')
  }, [mode, setMode])

  // Esc closes expanded → previous mode
  useEffect(() => {
    if (mode !== 'expanded') return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setMode(lastNonExpandedRef.current || 'float') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, setMode])

  // Keep float window inside the viewport when it shrinks.
  useEffect(() => {
    if (mode !== 'float') return
    const onResize = () => setBounds({})
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mode, setBounds])

  const updateTabMeta = useCallback((id, meta) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...meta } : tab)))
  }, [])

  const startRename = useCallback((tab) => {
    setRenamingId(tab.id)
    setRenameDraft(tab.customLabel ?? '')
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameDraft('')
  }, [])

  const commitRename = useCallback(() => {
    if (renamingId == null) return
    const trimmed = renameDraft.trim().slice(0, 40)
    setTabs((prev) => prev.map((tab) => (
      tab.id === renamingId
        ? { ...tab, customLabel: trimmed.length > 0 ? trimmed : undefined }
        : tab
    )))
    setRenamingId(null)
    setRenameDraft('')
  }, [renamingId, renameDraft])

  const addTab = useCallback(() => {
    const id = newTabId()
    setTabs((prev) => [...prev, { id, ready: false, cwd: '' }])
    setActiveId(id)
    setMinimized(false)
  }, [setMinimized])

  const closeTab = useCallback((id) => {
    setTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== id)
      if (remaining.length === 0) {
        setOpen(false)
        setActiveId(null)
        return []
      }
      setActiveId((current) => {
        if (current !== id) return current
        const idx = prev.findIndex((tab) => tab.id === id)
        const next = remaining[Math.max(0, idx - 1)] ?? remaining[0]
        return next?.id ?? null
      })
      return remaining
    })
  }, [setOpen])

  const handleClose = useCallback(() => setOpen(false), [setOpen])
  const handleMinimize = useCallback(() => setMinimized(true), [setMinimized])
  const handleRestore = useCallback(() => setMinimized(false), [setMinimized])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) || null,
    [tabs, activeId],
  )

  if (!open) return null

  const isDock = mode === 'dock'
  const isFloat = mode === 'float'
  const isExpanded = mode === 'expanded'
  const showAsMinimized = isDock && minimized

  // ---- Shared tab strip (parameterized for drag in float mode) ----
  const renderTabStrip = (allowDrag) => (
    <div
      className="flex items-center flex-shrink-0"
      style={{
        height: HEADER_HEIGHT,
        background: 'var(--bg-surface)',
        borderBottom: showAsMinimized ? 'none' : '1px solid var(--border-subtle)',
        minWidth: 0,
        paddingLeft: 4,
        paddingRight: 4,
        gap: 2,
        cursor: showAsMinimized
          ? 'pointer'
          : (allowDrag ? (dragHandle.dragging ? 'grabbing' : 'grab') : 'default'),
      }}
      onMouseDown={(e) => {
        if (!allowDrag) return
        if (e.target.closest('[data-tab-control]')) return
        dragHandle.onMouseDown(e)
      }}
      onDoubleClick={(e) => {
        if (e.target.closest('[data-tab-control]')) return
        toggleExpanded()
      }}
      onClick={(e) => {
        if (!showAsMinimized) return
        if (e.target.closest('[data-tab-control]')) return
        handleRestore()
      }}
    >
      <TerminalIcon
        size={14}
        strokeWidth={1.5}
        style={{ color: 'var(--red)', flexShrink: 0, marginLeft: 6, marginRight: 6 }}
      />

      {/* Tabs (shrinkable; overflow-x-auto for many tabs) */}
      <div
        className="flex items-center gap-1 overflow-x-auto"
        style={{ flexShrink: 1, minWidth: 0 }}
      >
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              data-tab-control
              onClick={(e) => {
                if (renamingId === tab.id) return
                e.stopPropagation()
                setActiveId(tab.id)
                if (minimized) setMinimized(false)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                startRename(tab)
              }}
              title={renamingId === tab.id ? '' : `${tab.cwd || `${user?.username || ''} · ${shortCwd(tab.cwd)}`}\n${t('terminal.renameHint')}`}
              className="flex items-center gap-2 text-xs flex-shrink-0"
              style={{
                height: 24,
                padding: '0 8px',
                borderRadius: 3,
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                // Ready status via left border (design rule: no dots)
                borderLeft: `2px solid ${tab.ready ? 'var(--green)' : 'var(--border)'}`,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: renamingId === tab.id ? 'text' : 'pointer',
                transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
                maxWidth: 220,
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              {renamingId === tab.id ? (
                <input
                  data-tab-control
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={commitRename}
                  onFocus={(e) => e.target.select()}
                  placeholder={shortCwd(tab.cwd) || `${t('terminal.adminShell')} ${idx + 1}`}
                  maxLength={40}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    outline: 'none',
                    padding: '0 4px',
                    minWidth: 60,
                    maxWidth: 160,
                    height: 18,
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <span className="truncate" style={{ minWidth: 0 }}>
                  {tab.customLabel || shortCwd(tab.cwd) || `${t('terminal.adminShell')} ${idx + 1}`}
                </span>
              )}
              <button
                data-tab-control
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                title={t('terminal.closeTab')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: 'var(--text-dim)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </div>
          )
        })}

        {/* New tab button */}
        <button
          data-tab-control
          onClick={(e) => {
            e.stopPropagation()
            addTab()
          }}
          title={t('terminal.newTab')}
          style={{
            flexShrink: 0,
            height: 24,
            width: 24,
            padding: 0,
            borderRadius: 3,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 150ms ease, background 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)'
            e.currentTarget.style.background = 'var(--bg-elevated)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-dim)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Filler — pushes the right-side controls flush right. Drag is handled
          at the tab-strip root (covering the icon + any whitespace). */}
      <div style={{ flex: 1, alignSelf: 'stretch', minWidth: 8 }} />

      {/* Mode-toggle controls */}
      {isDock && (
        <button
          data-tab-control
          onClick={(e) => { e.stopPropagation(); setMode('float') }}
          title={t('terminal.popOut')}
          style={modeBtnStyle}
          onMouseEnter={modeBtnHoverIn}
          onMouseLeave={modeBtnHoverOut}
        >
          <ExternalLink size={14} strokeWidth={1.5} />
        </button>
      )}
      {isFloat && (
        <>
          <button
            data-tab-control
            onClick={(e) => { e.stopPropagation(); setMode('dock') }}
            title={t('terminal.dockBack')}
            style={modeBtnStyle}
            onMouseEnter={modeBtnHoverIn}
            onMouseLeave={modeBtnHoverOut}
          >
            <PanelBottom size={14} strokeWidth={1.5} />
          </button>
          <button
            data-tab-control
            onClick={(e) => { e.stopPropagation(); setMode('expanded') }}
            title={t('terminal.expand')}
            style={modeBtnStyle}
            onMouseEnter={modeBtnHoverIn}
            onMouseLeave={modeBtnHoverOut}
          >
            <Maximize2 size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
      {isExpanded && (
        <button
          data-tab-control
          onClick={(e) => { e.stopPropagation(); setMode('float') }}
          title={t('terminal.restoreFloat')}
          style={modeBtnStyle}
          onMouseEnter={modeBtnHoverIn}
          onMouseLeave={modeBtnHoverOut}
        >
          <Minimize2 size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Minimize only meaningful in dock */}
      {isDock && (
        <button
          data-tab-control
          onClick={(e) => {
            e.stopPropagation()
            if (minimized) handleRestore()
            else handleMinimize()
          }}
          title={minimized ? t('terminal.restore') : t('terminal.minimize')}
          style={modeBtnStyle}
          onMouseEnter={modeBtnHoverIn}
          onMouseLeave={modeBtnHoverOut}
        >
          {minimized
            ? <ChevronUp size={14} strokeWidth={1.5} />
            : <ChevronDown size={14} strokeWidth={1.5} />}
        </button>
      )}

      <button
        data-tab-control
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        title={t('terminal.close')}
        style={modeBtnStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )

  // ---- Shared sessions body ----
  // panelHeight passed through to TerminalSession purely as a refit trigger.
  const sessionsPanelHeight = isDock ? height : bounds.height
  const renderSessions = () => (
    <div
      className="flex-1 relative"
      style={{
        background: 'var(--bg-base)',
        minWidth: 0,
        overflow: 'hidden',
        display: showAsMinimized ? 'none' : 'block',
      }}
    >
      {tabs.map((tab) => (
        <TerminalSession
          key={tab.id}
          visible={tab.id === activeId}
          panelHeight={sessionsPanelHeight}
          panelMinimized={showAsMinimized}
          onMetaChange={(meta) => updateTabMeta(tab.id, meta)}
          onClosed={() => { /* tab dot updates via onMetaChange(ready:false) */ }}
        />
      ))}
      {activeTab ? null : null}
    </div>
  )

  // Stable React tree across all modes so TerminalSession (and its websocket)
  // is not unmounted when switching modes. Only the wrapper's CSS varies.
  const frameStyle = (() => {
    if (isDock) {
      const drawerHeight = minimized ? HEADER_HEIGHT : height
      return {
        position: 'relative',
        height: drawerHeight,
        flexShrink: 0,
        background: 'var(--bg-base)',
        borderTop: '2px solid var(--red)',
        boxSizing: 'border-box',
        minWidth: 0,
        overflow: 'hidden',
        transition: 'height 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }
    }
    if (isFloat) {
      return {
        position: 'fixed',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 150,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-strong)',
        borderLeft: '2px solid var(--red)',
        borderRight: '1px solid var(--border-strong)',
        boxSizing: 'border-box',
        minWidth: 0,
        overflow: 'hidden',
        animation: 'terminal-window-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }
    }
    // expanded — covers everything except a 24px margin (overlaps sidebar/navbar)
    return {
      position: 'fixed',
      top: EXPAND_MARGIN,
      left: EXPAND_MARGIN,
      right: EXPAND_MARGIN,
      bottom: EXPAND_MARGIN,
      zIndex: 201,
      background: 'var(--bg-base)',
      border: '1px solid var(--border-strong)',
      borderLeft: '2px solid var(--red)',
      borderRight: '1px solid var(--border-strong)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      animation: 'terminal-window-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    }
  })()

  const showDockHandle = isDock && !minimized

  return (
    <>
      {isExpanded && (
        <div
          key="terminal-backdrop"
          className="fixed inset-0"
          style={{
            zIndex: 200,
            background: 'var(--bg-overlay)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setMode(lastNonExpandedRef.current || 'float')}
        />
      )}
      <div key="terminal-frame" className="flex flex-col" style={frameStyle}>
        {/* Dock-mode top edge resize handle */}
        <div
          key="dock-handle"
          onMouseDown={showDockHandle ? dockResize.onMouseDown : undefined}
          style={{
            position: 'absolute',
            top: -2,
            left: 0,
            right: 0,
            height: 4,
            cursor: 'row-resize',
            background: dockResize.dragging ? 'var(--blue)' : 'transparent',
            transition: 'background 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            zIndex: 10,
            display: showDockHandle ? 'block' : 'none',
          }}
          onMouseEnter={(e) => {
            if (!dockResize.dragging) e.currentTarget.style.background = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            if (!dockResize.dragging) e.currentTarget.style.background = 'transparent'
          }}
        />
        {/* Float-mode edge / corner handles. Always rendered for stable order;
            display:none when not floating so their hit area is gone. */}
        {renderEdgeHandles({
          edges: { edgeN, edgeS, edgeE, edgeW, edgeNE, edgeNW, edgeSE, edgeSW },
          active: isFloat,
        })}
        {renderTabStrip(isFloat)}
        {renderSessions()}
        <style>{`
          @keyframes terminal-window-in {
            from { opacity: 0; transform: scale(0.98); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </>
  )
}

const modeBtnStyle = {
  flexShrink: 0,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--text-dim)',
  transition: 'color 150ms ease',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const modeBtnHoverIn = (e) => { e.currentTarget.style.color = 'var(--text-primary)' }
const modeBtnHoverOut = (e) => { e.currentTarget.style.color = 'var(--text-dim)' }

function renderEdgeHandles({ edges, active }) {
  const { edgeN, edgeS, edgeE, edgeW, edgeNE, edgeNW, edgeSE, edgeSW } = edges
  const z = 20
  const display = active ? 'block' : 'none'
  const md = (h) => (active ? h.onMouseDown : undefined)
  return (
    <>
      <div key="edge-n" onMouseDown={md(edgeN)} style={{
        position: 'absolute', top: 0, left: CORNER_SIZE, right: CORNER_SIZE,
        height: EDGE_THICKNESS, cursor: 'ns-resize', zIndex: z, display,
      }} />
      <div key="edge-s" onMouseDown={md(edgeS)} style={{
        position: 'absolute', bottom: 0, left: CORNER_SIZE, right: CORNER_SIZE,
        height: EDGE_THICKNESS, cursor: 'ns-resize', zIndex: z, display,
      }} />
      <div key="edge-e" onMouseDown={md(edgeE)} style={{
        position: 'absolute', right: 0, top: CORNER_SIZE, bottom: CORNER_SIZE,
        width: EDGE_THICKNESS, cursor: 'ew-resize', zIndex: z, display,
      }} />
      <div key="edge-w" onMouseDown={md(edgeW)} style={{
        position: 'absolute', left: 0, top: CORNER_SIZE, bottom: CORNER_SIZE,
        width: EDGE_THICKNESS, cursor: 'ew-resize', zIndex: z, display,
      }} />
      <div key="edge-nw" onMouseDown={md(edgeNW)} style={{
        position: 'absolute', top: 0, left: 0,
        width: CORNER_SIZE, height: CORNER_SIZE,
        cursor: 'nwse-resize', zIndex: z + 1, display,
      }} />
      <div key="edge-ne" onMouseDown={md(edgeNE)} style={{
        position: 'absolute', top: 0, right: 0,
        width: CORNER_SIZE, height: CORNER_SIZE,
        cursor: 'nesw-resize', zIndex: z + 1, display,
      }} />
      <div key="edge-sw" onMouseDown={md(edgeSW)} style={{
        position: 'absolute', bottom: 0, left: 0,
        width: CORNER_SIZE, height: CORNER_SIZE,
        cursor: 'nesw-resize', zIndex: z + 1, display,
      }} />
      <div key="edge-se" onMouseDown={md(edgeSE)} style={{
        position: 'absolute', bottom: 0, right: 0,
        width: CORNER_SIZE, height: CORNER_SIZE,
        cursor: 'nwse-resize', zIndex: z + 1, display,
      }} />
    </>
  )
}
