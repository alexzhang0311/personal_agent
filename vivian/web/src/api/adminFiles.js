import { getJSON, getAuthHeaders } from './client'
import safeStorage from '../utils/safeStorage'

export function listDirectory(path) {
  return getJSON(`/admin/files/list?path=${encodeURIComponent(path)}`)
}

export function previewFile(path) {
  return getJSON(`/admin/files/preview?path=${encodeURIComponent(path)}`)
}

export async function downloadAdminFile(path) {
  const res = await fetch(`/api/admin/files/download?path=${encodeURIComponent(path)}`, {
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

export function uploadAdminFile(directory, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/files/upload')
    const token = safeStorage.getItem('vivian-token')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(`Upload error ${xhr.status}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))

    const formData = new FormData()
    formData.append('file', file)
    formData.append('directory', directory)
    xhr.send(formData)
  })
}
