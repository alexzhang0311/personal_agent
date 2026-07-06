/**
import safeStorage from '../utils/safeStorage'
 * WebSocket-based PTY terminal client.
 *
 * One connection = one shell session (the server caps users at 1 concurrent).
 * No auto-reconnect — if the WS drops or the server kills the session,
 * the user must manually reopen.
 */
export function connectTerminal({ cols, rows, onReady, onOutput, onClosed, onError, onPong }) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/api/pty/ws`
  const ws = new WebSocket(wsUrl)
  let closed = false

  ws.onopen = () => {
    const token = safeStorage.getItem('vivian-token')
    const init = {
      type: 'init',
      cols: Math.max(20, Math.floor(cols || 80)),
      rows: Math.max(5, Math.floor(rows || 24)),
    }
    if (token) init.token = token
    ws.send(JSON.stringify(init))
  }

  ws.onmessage = (evt) => {
    let msg
    try {
      msg = JSON.parse(evt.data)
    } catch {
      return
    }
    const t = msg?.type
    if (t === 'ready') {
      onReady?.(msg)
    } else if (t === 'output') {
      onOutput?.(msg.data || '')
    } else if (t === 'closed') {
      onClosed?.(msg)
    } else if (t === 'error') {
      onError?.(msg)
    } else if (t === 'pong') {
      onPong?.()
    }
  }

  ws.onclose = (evt) => {
    if (closed) return
    closed = true
    if (evt.code === 4001) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    onClosed?.({ reason: codeToReason(evt.code), code: evt.code })
  }

  ws.onerror = () => {
    if (closed) return
    onError?.({ message: 'WebSocket connection error' })
  }

  const sendInput = (data) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'input', data }))
  }

  const sendResize = (cols, rows) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'resize',
      cols: Math.max(20, Math.floor(cols)),
      rows: Math.max(5, Math.floor(rows)),
    }))
  }

  const sendPing = () => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'ping' }))
  }

  const disconnect = () => {
    closed = true
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  return { sendInput, sendResize, sendPing, disconnect }
}

function codeToReason(code) {
  switch (code) {
    case 4001: return 'auth'
    case 4002: return 'feature_disabled'
    case 4003: return 'already_connected'
    case 4010: return 'idle_timeout'
    case 4011: return 'absolute_timeout'
    case 4012: return 'admin_disabled'
    default: return 'client_close'
  }
}
