import { getAuthHeaders, deleteJSON, getJSON } from './client'

const BASE_URL = '/api'

export async function uploadFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/files/upload`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upload error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function deleteUploadedFile(uuid) {
  return deleteJSON(`/files/${encodeURIComponent(uuid)}`)
}

export async function listUploadedFiles(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  return getJSON(`/files/${query}`)
}

export async function downloadFile(uuid) {
  const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(uuid)}`, {
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
