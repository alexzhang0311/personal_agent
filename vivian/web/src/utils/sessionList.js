function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getSessionDateGroup(timestamp, now = Date.now()) {
  const dateKey = localDateKey(timestamp)
  if (!dateKey) return 'earlier'
  const current = new Date(now)
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1)
  if (dateKey === localDateKey(current)) return 'today'
  if (dateKey === localDateKey(yesterday)) return 'yesterday'
  return dateKey
}

export function groupSessionsByDate(sessions, now = Date.now()) {
  const groups = []
  for (const session of sessions) {
    const key = getSessionDateGroup(session.createdAt, now)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.sessions.push(session)
    else groups.push({ key, sessions: [session] })
  }
  return groups
}

export function formatSessionTime(timestamp, locale) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
