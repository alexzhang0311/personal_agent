export const SESSION_DRAG_THRESHOLD = 10

export function hasExceededSessionDragThreshold(startX, startY, x, y) {
  return Math.hypot(x - startX, y - startY) >= SESSION_DRAG_THRESHOLD
}

export function captureSessionPointerAfterThreshold(candidate, event, dragging = false) {
  if (!candidate || candidate.pointerId !== event.pointerId) return false
  if (!dragging && !hasExceededSessionDragThreshold(
    candidate.startX,
    candidate.startY,
    event.clientX,
    event.clientY
  )) return false

  const target = event.currentTarget
  if (!target.hasPointerCapture?.(event.pointerId)) {
    target.setPointerCapture(event.pointerId)
  }
  return true
}

export function isSameFolderTarget(session, targetFolderId) {
  return (session.folderId || null) === (targetFolderId || null)
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function formatFolderSessionTime(timestamp, {
  now = new Date(),
  yesterdayLabel = 'Yesterday',
} = {}) {
  if (!timestamp) return ''
  const numeric = Number(timestamp)
  const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) return ''
  const dayDifference = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)
  if (dayDifference === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }
  if (dayDifference === 1) return yesterdayLabel
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function folderNameForSession(session, folders) {
  if (!session.folderId) return null
  return folders.find((folder) => folder.id === session.folderId)?.name || null
}
