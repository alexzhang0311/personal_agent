// Safe wrappers around window.localStorage. In Safari Private Mode (and some
// embedded webviews) even *accessing* window.localStorage throws, so every
// call — including the property read — is individually guarded.

export function getItem(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setItem(key, value) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key) {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Read a persisted number, rejecting NaN/non-finite values and clamping to
 * the given bounds (same clamp shape as useResizable).
 * @param {string} key
 * @param {number} fallback
 * @param {{min?: number, max?: number}} [bounds]
 */
export function getNumber(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = getItem(key)
  if (raw == null || raw === '') return fallback
  const v = Number(raw)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export function getJSON(key, fallback = null) {
  const raw = getItem(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function getBoolean(key, fallback = false) {
  const raw = getItem(key)
  if (raw == null) return fallback
  return raw === 'true'
}

export default { getItem, setItem, removeItem, getNumber, getJSON, getBoolean }
