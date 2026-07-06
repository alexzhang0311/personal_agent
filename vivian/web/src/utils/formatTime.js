import i18n from '../i18n'

function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Chat-style timestamp: "HH:mm" for today, "YYYY-MM-DD HH:mm" otherwise.
 * Returns null for missing/invalid input.
 */
export function formatMessageTimestamp(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return time
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`
}

function currentLocale() {
  return i18n.language === 'zh' ? 'zh-CN' : 'en-GB'
}

/**
 * Time-of-day "HH:mm:ss" in the active UI language's locale.
 * Returns '—' for missing/invalid input.
 */
export function formatTimeOfDay(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(currentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * Full date+time in the active UI language's locale.
 * Returns '—' for missing/invalid input.
 */
export function formatDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(currentLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
