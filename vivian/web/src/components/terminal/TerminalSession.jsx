import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

import useUiStore from '../../stores/uiStore'
import { connectTerminal } from '../../api/terminal'

function readVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function buildTheme() {
  return {
    background: readVar('--bg-base', '#0d1117'),
    foreground: readVar('--text-primary', '#e6edf3'),
    cursor: readVar('--blue', '#58a6ff'),
    cursorAccent: readVar('--bg-base', '#0d1117'),
    selectionBackground: 'rgba(88,166,255,0.25)',
    black: readVar('--bg-elevated', '#21262d'),
    red: readVar('--red', '#f85149'),
    green: readVar('--green', '#3fb950'),
    yellow: readVar('--yellow', '#d29922'),
    blue: readVar('--blue', '#58a6ff'),
    magenta: readVar('--purple', '#bc8cff'),
    cyan: readVar('--cyan', '#79c0ff'),
    white: readVar('--text-primary', '#e6edf3'),
    brightBlack: readVar('--text-dim', '#484f58'),
    brightRed: readVar('--red', '#f85149'),
    brightGreen: readVar('--green', '#3fb950'),
    brightYellow: readVar('--yellow', '#d29922'),
    brightBlue: readVar('--blue', '#58a6ff'),
    brightMagenta: readVar('--purple', '#bc8cff'),
    brightCyan: readVar('--cyan', '#79c0ff'),
    brightWhite: readVar('--text-primary', '#e6edf3'),
  }
}

function reasonToKey(reason) {
  switch (reason) {
    case 'idle_timeout': return 'terminal.idleTimeout'
    case 'absolute_timeout': return 'terminal.absoluteTimeout'
    case 'admin_disabled': return 'terminal.adminDisabled'
    case 'feature_disabled': return 'terminal.featureDisabled'
    case 'superseded': return 'terminal.superseded'
    case 'auth': return 'terminal.authFailed'
    default: return 'terminal.disconnected'
  }
}

/**
 * Owns one shell session: an xterm.js Terminal + a WebSocket connection.
 * Stays mounted while its tab exists so scrollback and process state survive
 * tab-switching. Visibility is toggled by the parent drawer.
 */
function TerminalSessionInner({
  visible,
  onMetaChange,    // (id, { ready, cwd }) => void
  onClosed,        // (id, info) => void  — called when WS closes (drawer can update tab badge)
  panelHeight,     // when this changes, refit
  panelMinimized,  // refit only when expanded
}) {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)

  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsClientRef = useRef(null)
  const pingTimerRef = useRef(null)
  // Bumped on every teardown so an in-flight async connect() can detect
  // it was cancelled (e.g. by React 18 StrictMode's double-mount) and bail
  // before creating a duplicate xterm instance attached to the same host.
  const connectVersionRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [closedInfo, setClosedInfo] = useState(null)

  const teardown = useCallback(() => {
    // Invalidate any in-flight connect() so it bails before mounting xterm.
    connectVersionRef.current += 1
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
    if (wsClientRef.current) {
      try { wsClientRef.current.disconnect() } catch { /* noop */ }
      wsClientRef.current = null
    }
    if (termRef.current) {
      try { termRef.current.dispose() } catch { /* noop */ }
      termRef.current = null
    }
    fitRef.current = null
    // Belt-and-suspenders: clear any DOM nodes xterm might have left behind
    // so a fresh xterm.open() doesn't render on top of leftovers.
    if (hostRef.current) {
      hostRef.current.innerHTML = ''
    }
  }, [])

  const connect = useCallback(async () => {
    if (wsClientRef.current || !hostRef.current) return
    setConnecting(true)
    setReady(false)
    setClosedInfo(null)

    connectVersionRef.current += 1
    const myVersion = connectVersionRef.current

    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ])

    // If teardown ran while we were awaiting imports (e.g. StrictMode
    // double-mount), bail — a newer connect call owns the host now.
    if (myVersion !== connectVersionRef.current || !hostRef.current) {
      return
    }

    const term = new Terminal({
      fontFamily: "'JetBrainsMono Nerd Font Mono', 'Source Han Mono SC', monospace",
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      theme: buildTheme(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    try { fit.fit() } catch { /* noop */ }
    termRef.current = term
    fitRef.current = fit

    const cols = term.cols
    const rows = term.rows

    const client = connectTerminal({
      cols,
      rows,
      onReady: (msg) => {
        setReady(true)
        setConnecting(false)
        if (msg?.cols && msg?.rows) {
          try { term.resize(msg.cols, msg.rows) } catch { /* noop */ }
        }
        onMetaChange?.({ ready: true, cwd: msg?.cwd || '' })
        term.focus()
      },
      onOutput: (data) => {
        term.write(data)
      },
      onClosed: (info) => {
        setReady(false)
        setConnecting(false)
        const safeInfo = info || { reason: 'client_close' }
        setClosedInfo(safeInfo)
        onClosed?.(safeInfo)
        onMetaChange?.({ ready: false })
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current)
          pingTimerRef.current = null
        }
      },
      onError: (info) => {
        setConnecting(false)
        setClosedInfo({ reason: info?.code || info?.message || 'error' })
        onMetaChange?.({ ready: false })
      },
    })
    wsClientRef.current = client

    term.onData((data) => client.sendInput(data))
    term.onResize(({ cols, rows }) => client.sendResize(cols, rows))

    pingTimerRef.current = setInterval(() => {
      try { client.sendPing() } catch { /* noop */ }
    }, 30_000)
  }, [onMetaChange, onClosed])

  // Connect on mount, tear down on unmount.
  useEffect(() => {
    connect()
    return () => { teardown() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Visibility transitions need the full treatment: fit + refresh + focus,
  // gated on a double rAF so layout has settled after display:none → block.
  useEffect(() => {
    if (panelMinimized || !visible) return
    let cancelled = false
    const ids = []
    ids.push(requestAnimationFrame(() => {
      if (cancelled) return
      ids.push(requestAnimationFrame(() => {
        if (cancelled) return
        try { fitRef.current?.fit() } catch { /* noop */ }
        const term = termRef.current
        if (term) {
          try { term.refresh(0, term.rows - 1) } catch { /* noop */ }
          if (ready) {
            try { term.focus() } catch { /* noop */ }
          }
        }
      }))
    }))
    return () => {
      cancelled = true
      ids.forEach(cancelAnimationFrame)
    }
    // NOTE: panelHeight intentionally NOT in deps — height changes are
    // handled by the lightweight fit-only effect below.
  }, [visible, panelMinimized, ready])

  // Height drag: only call fit(). Skip refresh/focus to keep the drag smooth.
  // Coalesce to one rAF per frame regardless of how many mousemoves fire.
  useEffect(() => {
    if (panelMinimized || !visible || !fitRef.current) return
    const id = requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch { /* noop */ }
    })
    return () => cancelAnimationFrame(id)
  }, [panelHeight, panelMinimized, visible])

  // Refit on ANY size change of the host (window resize, sidebar drag,
  // canvas panel toggle, drawer height drag). One fit per frame, coalesced.
  // We follow with refresh() because xterm's renderer doesn't always repaint
  // glyphs that fell outside the previous viewport — without this, prompt
  // characters like the conda env / Powerline icons disappear after a drag
  // and only come back on the next keystroke.
  // Also restore focus if it landed on document.body during the drag (the
  // sidebar resize handle eats focus, so otherwise Ctrl+C wouldn't reach
  // the shell after a sidebar adjustment).
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let rafId = null
    const ro = new ResizeObserver(() => {
      if (panelMinimized || !visible) return
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
        try { fitRef.current?.fit() } catch { /* noop */ }
        const term = termRef.current
        if (!term) return
        try { term.refresh(0, term.rows - 1) } catch { /* noop */ }
        if (
          ready
          && (document.activeElement === document.body || document.activeElement == null)
        ) {
          try { term.focus() } catch { /* noop */ }
        }
      })
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [panelMinimized, visible, ready])

  // Theme-react: rebuild xterm theme when light/dark toggles.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    try { term.options.theme = buildTheme() } catch { /* noop */ }
    try { term.refresh(0, term.rows - 1) } catch { /* noop */ }
  }, [theme])

  // Click-to-focus — explicit guarantee that pointing at this tab body
  // routes keystrokes here. Belt-and-suspenders alongside the visibility effect.
  const handleBodyMouseDown = useCallback(() => {
    if (!ready) return
    try { termRef.current?.focus() } catch { /* noop */ }
  }, [ready])

  const handleReconnect = useCallback(() => {
    teardown()
    setClosedInfo(null)
    connect()
  }, [teardown, connect])

  return (
    <div
      className="relative"
      onMouseDown={handleBodyMouseDown}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-base)',
        display: visible ? 'block' : 'none',
        overflow: 'hidden',
      }}
    >
      {connecting && (
        <div className="flex flex-col gap-2" style={{ padding: 12 }}>
          <div className="skeleton" style={{ height: 12, width: '40%' }} />
          <div className="skeleton" style={{ height: 12, width: '85%' }} />
          <div className="skeleton" style={{ height: 12, width: '70%' }} />
          <div className="skeleton" style={{ height: 12, width: '90%' }} />
        </div>
      )}
      <div
        ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          padding: '8px 12px',
          visibility: ready ? 'visible' : 'hidden',
          boxSizing: 'border-box',
        }}
      />
      {closedInfo && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--bg-surface)',
            borderTop: '2px solid var(--red)',
          }}
        >
          <span
            className="chip"
            style={{ color: 'var(--red)', background: 'rgba(248,81,73,0.15)', border: '1px solid var(--red)' }}
          >
            {t('terminal.disconnectedChip')}
          </span>
          <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
            {t(reasonToKey(closedInfo.reason))}
          </span>
          <button
            onClick={handleReconnect}
            className="flex items-center gap-1 px-2 py-1 text-xs"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--blue)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <RotateCw size={12} strokeWidth={1.5} />
            {t('terminal.reconnect')}
          </button>
        </div>
      )}
    </div>
  )
}

// Memo with a custom comparator: the `onMetaChange` and `onClosed` callbacks
// are recreated by the parent on every render, but they're only consumed once
// during initial connect (captured by useEffect with empty deps). Comparing
// only the data props lets us skip re-renders during a drawer height drag.
const TerminalSession = memo(TerminalSessionInner, (prev, next) => (
  prev.visible === next.visible
  && prev.panelHeight === next.panelHeight
  && prev.panelMinimized === next.panelMinimized
))

export default TerminalSession
