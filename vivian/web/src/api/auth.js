const BASE_URL = '/api'
import safeStorage from '../utils/safeStorage'

async function hydrateLoginResponse(payload) {
  const token = payload?.access_token
  if (!token) return payload

  try {
    const user = await getMe(token)
    return { ...payload, user }
  } catch {
    return payload
  }
}

export async function checkSetup() {
  const res = await fetch(`${BASE_URL}/auth/setup`)
  if (!res.ok) {
    throw new Error(`API error ${res.status}`)
  }
  return res.json()
}

export async function setupAdmin(username, password, env) {
  const body = { username, password }
  if (env) body.env = env
  const res = await fetch(`${BASE_URL}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  const payload = await res.json()
  return hydrateLoginResponse(payload)
}

export async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  const payload = await res.json()
  return hydrateLoginResponse(payload)
}

export async function getMyApiKey() {
  const token = safeStorage.getItem('vivian-token')
  const res = await fetch(`${BASE_URL}/auth/me/apikey`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function generateMyApiKey() {
  const token = safeStorage.getItem('vivian-token')
  const res = await fetch(`${BASE_URL}/auth/me/apikey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function revokeMyApiKey() {
  const token = safeStorage.getItem('vivian-token')
  const res = await fetch(`${BASE_URL}/auth/me/apikey`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function getMe(token) {
  const res = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`API error ${res.status}`)
  }
  return res.json()
}

export async function changeMyPassword(currentPassword, newPassword) {
  const token = safeStorage.getItem('vivian-token')
  const res = await fetch(`${BASE_URL}/auth/me/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}
