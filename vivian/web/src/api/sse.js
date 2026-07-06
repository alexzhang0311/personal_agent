import { getAuthHeaders } from './client'
import useConnectionStore from '../stores/connectionStore'
import safeStorage from '../utils/safeStorage'
import i18n from '../i18n'

const BASE_URL = '/api'

const RECONNECT_BACKOFF = [1, 2, 4, 8, 16] // seconds — max 5 attempts
const PROTOCOL_AUTH_CLOSE_CODES = new Set([1000, 1001, 4000, 4001])

/**
 * WebSocket-based streaming client.
 * Returns { abort, sendPermission, sendQueue, sendQueueCancel } — call abort() to cancel the stream.
 *
 * On unexpected close (non-clean, non-auth), auto-reconnects with backoff
 * [1, 2, 4, 8, 16] seconds for up to 5 attempts. Reconnects re-init with
 * the same session_id so the backend can pick up where it left off.
 */
export function streamAgentRunWS(message, sessionId, onEvent, permissionMode, onComplete, model, attachments, mcpServers, images, trace, enableFileCheckpointing = false) {
  let ws = null
  let userAborted = false
  let completed = false
  let reconnectAttempt = 0
  let reconnectTimer = null
  let activeSessionId = sessionId

  const sendInit = () => {
    const token = safeStorage.getItem('vivian-token')
    const init = { type: 'init', message }
    if (trace?.tabId) init.client_tab_id = trace.tabId
    if (token) init.token = token
    if (activeSessionId) init.session_id = activeSessionId
    if (permissionMode) init.permission_mode = permissionMode
    if (model) init.model = model
    if (attachments && attachments.length > 0) init.attachments = attachments
    if (images && images.length > 0) init.images = images
    if (mcpServers !== undefined) init.mcp_servers = mcpServers
    if (enableFileCheckpointing) init.enable_file_checkpointing = true
    // WebUI can resolve prompts (permission card / AskUserQuestion), so opt in
    // to synchronous feedback. The API default is false (non-interactive safe).
    init.enable_permission_feedback = true
    ws.send(JSON.stringify(init))
  }

  const finalize = () => {
    if (completed) return
    completed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (onComplete) onComplete()
  }

  const scheduleReconnect = (closeCode) => {
    if (reconnectAttempt >= RECONNECT_BACKOFF.length) {
      useConnectionStore.getState().markDisconnected({ code: closeCode })
      onEvent('error', { message: 'Connection lost — please refresh the page.' })
      finalize()
      return
    }
    reconnectAttempt += 1
    const delay = RECONNECT_BACKOFF[reconnectAttempt - 1]
    useConnectionStore.getState().markReconnecting({
      attempt: reconnectAttempt,
      maxAttempts: RECONNECT_BACKOFF.length,
      delaySeconds: delay,
      code: closeCode,
    })
    reconnectTimer = setTimeout(connect, delay * 1000)
  }

  const connect = () => {
    reconnectTimer = null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/agent/ws/run`
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      // Mark connected on every successful (re)open. The first open transitions
      // out of `disconnected`/`reconnecting` cleanly.
      useConnectionStore.getState().markConnected()
      reconnectAttempt = 0
      sendInit()
    }

    ws.onmessage = (evt) => {
      try {
        const { event, data } = JSON.parse(evt.data)
        if (event === 'keepalive') return
        // Track the latest session_id so a reconnect resumes the same conversation.
        if (event === 'result' && data?.session_id) activeSessionId = data.session_id
        if (event === 'stream_init' && data?.stream_id) activeSessionId = data.stream_id
        onEvent(event, data)
      } catch {
        // skip malformed JSON
      }
    }

    ws.onclose = (evt) => {
      if (userAborted || completed) {
        finalize()
        return
      }
      if (evt.code === 4001) {
        window.dispatchEvent(new Event('auth:unauthorized'))
        finalize()
        return
      }
      // Clean / protocol / auth closes — terminate.
      if (PROTOCOL_AUTH_CLOSE_CODES.has(evt.code)) {
        useConnectionStore.getState().markConnected()
        finalize()
        return
      }
      // Server-error close (4500): surface as fatal and don't reconnect.
      if (evt.code === 4500) {
        useConnectionStore.getState().markDisconnected({ code: evt.code })
        onEvent('stream_error', {
          code: 'ServerError',
          message: 'Server error — please try again.',
          fatal: true,
        })
        finalize()
        return
      }
      // 1009 (message too big): reconnecting would just resend the same
      // oversized payload — fail fast with a clear, actionable error.
      if (evt.code === 1009) {
        onEvent('stream_error', {
          code: 'MessageTooLarge',
          message: i18n.t('connection.messageTooLarge'),
          fatal: true,
        })
        finalize()
        return
      }
      // 1006 (abnormal), 1008 (policy), 4xxx custom — try to reconnect.
      scheduleReconnect(evt.code)
    }

    ws.onerror = () => {
      // Errors precede onclose; let onclose drive the reconnect/finalize flow.
    }
  }

  const sendPermission = (requestId, decision, msg, updatedInput) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const frame = { type: 'permission_response', request_id: requestId, decision }
      if (msg) frame.message = msg
      if (updatedInput) frame.updated_input = updatedInput
      ws.send(JSON.stringify(frame))
    }
  }

  const sendQueue = ({ id, text, attachments, images }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    const frame = { type: 'queue', id, text }
    if (attachments && attachments.length > 0) frame.attachments = attachments
    if (images && images.length > 0) frame.images = images
    ws.send(JSON.stringify(frame))
    return true
  }

  const sendQueueCancel = (id) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ type: 'queue_cancel', id }))
    return true
  }

  const abort = () => {
    userAborted = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'abort' }))
      } catch {
        // ignore send errors on closing socket
      }
    }
    if (ws) ws.close()
    finalize()
  }

  connect()

  return { abort, sendPermission, sendQueue, sendQueueCancel }
}

/**
 * POST-based SSE client.
 * Returns { abort } — call abort() to cancel the stream.
 */
export function streamAgentRun(message, sessionId, onEvent, permissionMode, onComplete, model, attachments, mcpServers, images, enableFileCheckpointing = false) {
  const controller = new AbortController()

  const run = async () => {
    const body = { message, session_id: sessionId }
    if (permissionMode) {
      body.permission_mode = permissionMode
    }
    if (model) {
      body.model = model
    }
    if (attachments && attachments.length > 0) {
      body.attachments = attachments
    }
    if (images && images.length > 0) {
      body.images = images
    }
    if (mcpServers !== undefined) {
      body.mcp_servers = mcpServers
    }
    if (enableFileCheckpointing) {
      body.enable_file_checkpointing = true
    }
    const res = await fetch(`${BASE_URL}/agent/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      if (res.status === 401) {
        window.dispatchEvent(new Event('auth:unauthorized'))
      }
      const text = await res.text()
      throw new Error(`SSE error ${res.status}: ${text}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE frames
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = null

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent(currentEvent, data)
          } catch {
            // skip malformed JSON
          }
          currentEvent = null
        } else if (line === '') {
          currentEvent = null
        }
      }
    }
  }

  run().then(() => {
    if (onComplete) onComplete()
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent('error', { message: err.message })
    }
    if (onComplete) onComplete()
  })

  return { abort: () => controller.abort() }
}

/**
 * Respond to a permission request.
 */
export async function respondPermission(sessionId, requestId, decision, message, updatedInput) {
  const body = {
    session_id: sessionId,
    request_id: requestId,
    decision,
  }
  if (message) body.message = message
  if (updatedInput) body.updated_input = updatedInput

  const res = await fetch(`${BASE_URL}/agent/permission/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    const text = await res.text()
    throw new Error(`Permission respond error ${res.status}: ${text}`)
  }
  return res.json()
}
