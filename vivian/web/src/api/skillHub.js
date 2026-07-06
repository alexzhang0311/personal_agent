import { getJSON, postJSON, deleteJSON } from './client'
import safeStorage from '../utils/safeStorage'

const BASE_URL = '/api'

function getAuthHeaders() {
  const token = safeStorage.getItem('vivian-token')
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

export const listHubSkills = () => getJSON('/resource/skill-hub/')

export const getHubSkillDetail = (name) =>
  getJSON(`/resource/skill-hub/${encodeURIComponent(name)}`)

export const getHubSkillFile = (name, path) =>
  getJSON(`/resource/skill-hub/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`)

export const deliverHubSkill = (name) =>
  postJSON(`/resource/skill-hub/${encodeURIComponent(name)}/deliver`, {})

export const uploadHubSkill = async (file) => {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/resource/skill-hub/upload`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export const deleteHubSkill = (name) =>
  deleteJSON(`/resource/skill-hub/${encodeURIComponent(name)}`)
