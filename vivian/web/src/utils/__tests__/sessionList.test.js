import { describe, expect, it } from 'vitest'
import { getSessionDateGroup, groupSessionsByDate } from '../sessionList'

describe('session list date grouping', () => {
  const now = new Date(2026, 6, 24, 15, 0, 0).getTime()

  it('groups today, yesterday, and older sessions in list order', () => {
    const sessions = [
      { id: 'today-a', createdAt: new Date(2026, 6, 24, 9, 0, 0).getTime() },
      { id: 'today-b', createdAt: new Date(2026, 6, 24, 8, 0, 0).getTime() },
      { id: 'yesterday', createdAt: new Date(2026, 6, 23, 20, 0, 0).getTime() },
      { id: 'older', createdAt: new Date(2026, 5, 5, 12, 0, 0).getTime() },
    ]

    const groups = groupSessionsByDate(sessions, now)

    expect(groups.map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      '2026-06-05',
    ])
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['today-a', 'today-b'])
  })

  it('keeps invalid timestamps in a safe fallback group', () => {
    expect(getSessionDateGroup('invalid', now)).toBe('earlier')
  })
})
