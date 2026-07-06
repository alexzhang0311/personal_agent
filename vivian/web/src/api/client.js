import useToastStore from '../stores/toastStore'
import safeStorage from '../utils/safeStorage'

const BASE_URL = '/api'

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

function getAuthHeaders() {
  const token = safeStorage.getItem('vivian-token')
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

function pushApiToast(status, body) {
  try {
    useToastStore.getState().pushToast({
      level: 'error',
      title: `API error ${status}`,
      body: body ? String(body).slice(0, 400) : undefined,
    })
  } catch { /* toast unavailable */ }
}

export async function handleAPIResponse(res) {
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    const text = await res.text()
    pushApiToast(res.status, text)
    throw new UnauthorizedError(`API error ${res.status}: ${text}`)
  }
  if (!res.ok) {
    const text = await res.text()
    pushApiToast(res.status, text)
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function postJSON(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  })
  return handleAPIResponse(res)
}

export async function getJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...getAuthHeaders() },
  })
  return handleAPIResponse(res)
}

export async function putJSON(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  })
  return handleAPIResponse(res)
}

export async function deleteJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  return handleAPIResponse(res)
}

export async function agentRun(message, sessionId) {
  return postJSON('/agent/run', { message, session_id: sessionId })
}

/**
 * Returns the backend base origin for non-API routes (e.g. /docs).
 * - Direct mount (same origin): returns '' (relative path works)
 * - Separate deploy (dev proxy): detects via a probe to /api and falls back to current origin
 */
export function getBackendOrigin() {
  // In production (direct mount or reverse proxy), relative paths just work
  // In dev, the Vite proxy handles /api but browser navigations to /docs
  // get caught by SPA fallback. We need the actual backend origin.
  if (import.meta.env.DEV) {
    // Dev mode: backend is on the proxy target
    // Read from env or fall back to the known dev default
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8081'
  }
  // Production: same origin
  return ''
}

export { getAuthHeaders }
