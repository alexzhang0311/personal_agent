export function shouldApplyRunEvent(activeChatId, originChatId) {
  return Boolean(activeChatId && originChatId && activeChatId === originChatId)
}

export function getRunStatusPatch(event, data = {}) {
  if (event === 'permission_request') {
    return { runStatus: 'waiting_user', pendingRequest: data }
  }
  if (event === 'permission_resolved' || event === 'permission_timeout' || event === 'permission_conflict') {
    return { runStatus: 'running', pendingRequest: null }
  }
  if (event === 'run_state') {
    return {
      runStatus: data.status,
      pendingRequest: data.pending_requests?.[0] || null,
    }
  }
  return null
}
