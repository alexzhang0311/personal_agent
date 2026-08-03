import { describe, expect, it } from 'vitest'
import {
  captureSessionPointerAfterThreshold,
  formatFolderSessionTime,
  hasExceededSessionDragThreshold,
  isSameFolderTarget,
  SESSION_DRAG_THRESHOLD,
} from '../sessionFolders'

describe('session folder interactions', () => {
  it('starts dragging only at the ten-pixel threshold', () => {
    expect(SESSION_DRAG_THRESHOLD).toBe(10)
    expect(hasExceededSessionDragThreshold(0, 0, 9, 0)).toBe(false)
    expect(hasExceededSessionDragThreshold(0, 0, 6, 8)).toBe(true)
  })

  it('captures the pointer only after drag starts so clicks and double-clicks survive', () => {
    const candidate = { pointerId: 7, startX: 10, startY: 10 }
    const captures = []
    const currentTarget = {
      hasPointerCapture: () => false,
      setPointerCapture: (pointerId) => captures.push(pointerId),
    }

    expect(captureSessionPointerAfterThreshold(candidate, {
      pointerId: 7,
      clientX: 15,
      clientY: 10,
      currentTarget,
    })).toBe(false)
    expect(captures).toEqual([])

    expect(captureSessionPointerAfterThreshold(candidate, {
      pointerId: 7,
      clientX: 20,
      clientY: 10,
      currentTarget,
    })).toBe(true)
    expect(captures).toEqual([7])
  })

  it('treats repeated drops into the same folder as no-ops', () => {
    expect(isSameFolderTarget({ folderId: 'folder-a' }, 'folder-a')).toBe(true)
    expect(isSameFolderTarget({ folderId: null }, null)).toBe(true)
    expect(isSameFolderTarget({ folderId: 'folder-a' }, null)).toBe(false)
  })

  it('uses compact time, yesterday, and month-day labels inside folders', () => {
    const now = new Date(2026, 6, 30, 12, 0, 0)
    expect(formatFolderSessionTime(
      new Date(2026, 6, 30, 9, 5, 0).getTime(),
      { now, yesterdayLabel: '昨天' }
    )).toMatch(/09:05|9:05/)
    expect(formatFolderSessionTime(
      new Date(2026, 6, 29, 18, 0, 0).getTime(),
      { now, yesterdayLabel: '昨天' }
    )).toBe('昨天')
    expect(formatFolderSessionTime(
      new Date(2026, 6, 22, 18, 0, 0).getTime(),
      { now, yesterdayLabel: '昨天' }
    )).toMatch(/07.*22|22.*07/)
  })
})
