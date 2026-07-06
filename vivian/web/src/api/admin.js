import { getJSON, postJSON, putJSON, deleteJSON } from './client'

export const listUsers = () => getJSON('/admin/users')
export const createUser = (data) => postJSON('/admin/users', data)
export const updateUser = (username, data) => putJSON(`/admin/users/${encodeURIComponent(username)}`, data)
export const deleteUser = (username) => deleteJSON(`/admin/users/${encodeURIComponent(username)}`)
export const getAdminStats = () => getJSON('/admin/stats')
export const getAuditLog = (params = {}) => {
  const query = new URLSearchParams()
  if (params.limit != null) query.set('limit', params.limit)
  if (params.before) query.set('before', params.before)
  if (params.after) query.set('after', params.after)
  if (params.action) query.set('action', params.action)
  if (params.actor) query.set('actor', params.actor)
  if (params.target) query.set('target', params.target)
  if (params.start) query.set('start', params.start)
  if (params.end) query.set('end', params.end)
  if (params.session_id) query.set('session_id', params.session_id)
  return getJSON(`/admin/audit?${query}`)
}

export const getUserSkills = (username) => getJSON(`/admin/users/${encodeURIComponent(username)}/skills`)
export const deleteUserSkill = (username, level, name) => deleteJSON(`/admin/users/${encodeURIComponent(username)}/skills/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export const getUserMcpServers = (username) => getJSON(`/admin/users/${encodeURIComponent(username)}/mcp`)
export const deleteUserMcpServer = (username, level, name) => deleteJSON(`/admin/users/${encodeURIComponent(username)}/mcp/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export const getUserSchedulerJobs = (username) => getJSON(`/admin/users/${encodeURIComponent(username)}/scheduler/jobs`)
export const getUserActiveHooks = (username) => getJSON(`/admin/users/${encodeURIComponent(username)}/hooks/active`)

export const getPresetPrompt = () => getJSON('/admin/presetprompt')
export const updatePresetPrompt = (data) => putJSON('/admin/presetprompt', data)

export const getCliPath = () => getJSON('/admin/clipath')
export const updateCliPath = (data) => putJSON('/admin/clipath', data)

export const getHistoryRetention = () => getJSON('/admin/history-retention')
export const updateHistoryRetention = (data) => putJSON('/admin/history-retention', data)

export const getRetryableTools = () => getJSON('/admin/retryable-tools')
export const updateRetryableTools = (data) => putJSON('/admin/retryable-tools', data)

export const getRiskyTools = () => getJSON('/admin/risky-tools')
export const updateRiskyTools = (data) => putJSON('/admin/risky-tools', data)

export const getSensitivePatterns = () => getJSON('/admin/sensitive-patterns')
export const updateSensitivePatterns = (data) => putJSON('/admin/sensitive-patterns', data)

export const getPlugins = () => getJSON('/admin/system/plugin')
export const updatePlugin = (id, data) => putJSON(`/admin/system/plugin/${encodeURIComponent(id)}`, data)

export const getPtyConfig = () => getJSON('/admin/pty/config')
export const updatePtyConfig = (data) => putJSON('/admin/pty/config', data)
export const getPtyFeature = () => getJSON('/pty/feature')
