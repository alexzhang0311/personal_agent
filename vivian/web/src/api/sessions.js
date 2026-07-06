import { getAuthHeaders, handleAPIResponse } from './client'

const BASE_URL = '/api'

export async function fetchSessions(limit = 20, offset = 0, source = 'project') {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  params.set('source', source)
  const res = await fetch(`${BASE_URL}/agent/sessions?${params}`, {
    headers: { ...getAuthHeaders() },
  })
  return handleAPIResponse(res)
}

export async function deleteSession(sessionId) {
  const res = await fetch(
    `${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', headers: { ...getAuthHeaders() } }
  )
  return handleAPIResponse(res)
}

export async function fetchSessionMessages(sessionId, limit, offset) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (offset != null && offset !== 0) params.set('offset', String(offset))
  const qs = params.toString()
  const res = await fetch(
    `${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}/messages${qs ? '?' + qs : ''}`,
    { headers: { ...getAuthHeaders() } }
  )
  return handleAPIResponse(res)
}

async function handleJson(res) {
  return handleAPIResponse(res)
}

export async function rewindFiles(sessionId, checkpointUuid) {
  const res = await fetch(`${BASE_URL}/agent/rewind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ session_id: sessionId, checkpoint_uuid: checkpointUuid }),
  })
  return handleJson(res)
}

export async function forkSession(sessionId, upToMessageUuid, title) {
  const body = { session_id: sessionId }
  if (upToMessageUuid) body.up_to_message_uuid = upToMessageUuid
  if (title) body.title = title
  const res = await fetch(`${BASE_URL}/agent/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  })
  return handleJson(res)
}

export async function renameSession(sessionId, title) {
  const res = await fetch(
    `${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ title }),
    }
  )
  return handleJson(res)
}

export async function tagSession(sessionId, tag) {
  const res = await fetch(
    `${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}/tag`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ tag: tag ?? null }),
    }
  )
  return handleJson(res)
}
