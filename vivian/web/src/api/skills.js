import { getJSON, putJSON, deleteJSON, getBackendOrigin } from './client'
import safeStorage from '../utils/safeStorage'

const BASE_URL = '/api'

function getAuthHeaders() {
  const token = safeStorage.getItem('vivian-token')
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

export const listSkills = () => getJSON('/resource/skills/')

export const getSkillDetail = (level, name) =>
  getJSON(`/resource/skills/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export const getSkillFile = (level, name, path) =>
  getJSON(`/resource/skills/${encodeURIComponent(level)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`)

export const uploadSkill = async (level, file) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('level', level)
  const res = await fetch(`${BASE_URL}/resource/skills/upload`, {
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

export const deleteSkill = (level, name) =>
  deleteJSON(`/resource/skills/${encodeURIComponent(level)}/${encodeURIComponent(name)}`)

export async function downloadSkill(level, name) {
  const res = await fetch(`${BASE_URL}/resource/skills/${encodeURIComponent(level)}/${encodeURIComponent(name)}/download`, {
    headers: { ...getAuthHeaders() },
  })
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Download error ${res.status}: ${text}`)
  }
  return res.blob()
}

export const getSkillsConfig = () => getJSON('/resource/skills/config')

export const updateSkillsConfig = (skillExclude) =>
  putJSON('/resource/skills/config', { skill_exclude: Array.isArray(skillExclude) ? skillExclude : [] })

export async function getHealthInfo() {
  const res = await fetch(`${getBackendOrigin()}/health`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Health error ${res.status}: ${text}`)
  }
  return res.json()
}
