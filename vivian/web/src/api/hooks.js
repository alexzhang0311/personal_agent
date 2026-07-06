import { getJSON, postJSON, putJSON, deleteJSON } from './client'

// Catalog (built-in hooks)
export const fetchCatalog = () => getJSON('/hooks/catalog')

// Config (merged: admin + project + local)
export const fetchConfig = () => getJSON('/hooks/config')
export const updateConfig = (hooks) => putJSON('/hooks/config', { hooks })

// Enable/disable a built-in hook
export const enableBuiltInHook = (hookId) =>
  postJSON(`/hooks/catalog/${encodeURIComponent(hookId)}/enable`, {})
export const disableBuiltInHook = (hookId) =>
  postJSON(`/hooks/catalog/${encodeURIComponent(hookId)}/disable`, {})

// Test (dry-run) — user custom command hooks
export const testHook = (eventType, handler, inputJson) =>
  postJSON('/hooks/test', { event_type: eventType, handler, input_json: inputJson })

// Test — built-in hooks
export const testBuiltInHook = (hookId, eventType, inputJson) =>
  postJSON('/hooks/test/builtin', { hook_id: hookId, event_type: eventType, input_json: inputJson })

// Logs (cursor-paginated)
export const fetchLogs = ({ eventType = null, limit = 50, before = null, after = null } = {}) => {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (eventType) params.set('event_type', eventType)
  if (before) params.set('before', before)
  if (after) params.set('after', after)
  return getJSON(`/hooks/logs?${params}`)
}

// Script content — read a hook script file from the user's work dir
export const fetchScriptContent = (path) =>
  getJSON(`/hooks/script/content?path=${encodeURIComponent(path)}`)

// Admin
export const fetchAdminHooks = () => getJSON('/hooks/admin')
