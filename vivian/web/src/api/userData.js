import { getJSON } from './client'

export const getUserStats = () => getJSON('/user/stats')

export const getUserAuditLog = (params = {}) => {
  const query = new URLSearchParams()
  if (params.limit != null) query.set('limit', params.limit)
  if (params.before) query.set('before', params.before)
  if (params.after) query.set('after', params.after)
  if (params.action) query.set('action', params.action)
  if (params.target) query.set('target', params.target)
  if (params.start) query.set('start', params.start)
  if (params.end) query.set('end', params.end)
  if (params.session_id) query.set('session_id', params.session_id)
  return getJSON(`/user/audit?${query}`)
}

export const getUserAnalytics = (params) => {
  const query = new URLSearchParams()
  if (params?.start) query.set('start', params.start)
  if (params?.end) query.set('end', params.end)
  return getJSON(`/user/analytics?${query}`)
}
