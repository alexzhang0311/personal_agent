import { describe, expect, it } from 'vitest'
import { sortRunHistory } from '../runHistorySort'

const runs = [
  { run_id: 'skipped-32', status: 'skipped', started_at: '2026-08-05T20:32:46Z', duration_ms: null, num_turns: null },
  { run_id: 'skipped-27', status: 'skipped', started_at: '2026-08-05T20:27:37Z', duration_ms: null, num_turns: null },
  { run_id: 'running-37', status: 'running', started_at: '2026-08-05T20:37:10Z', duration_ms: null, num_turns: null },
]

describe('sortRunHistory', () => {
  it('sorts the current page by start time descending without status grouping', () => {
    expect(sortRunHistory(runs, 'started_at', 'desc').map((run) => run.run_id)).toEqual([
      'running-37',
      'skipped-32',
      'skipped-27',
    ])
  })

  it('does not mutate the API response order', () => {
    sortRunHistory(runs, 'started_at', 'desc')
    expect(runs.map((run) => run.run_id)).toEqual(['skipped-32', 'skipped-27', 'running-37'])
  })

  it('keeps missing numeric values after populated values in either direction', () => {
    const numericRuns = [
      { run_id: 'missing', duration_ms: null },
      { run_id: 'slow', duration_ms: 2000 },
      { run_id: 'fast', duration_ms: 1000 },
    ]
    expect(sortRunHistory(numericRuns, 'duration_ms', 'asc').map((run) => run.run_id)).toEqual([
      'fast', 'slow', 'missing',
    ])
    expect(sortRunHistory(numericRuns, 'duration_ms', 'desc').map((run) => run.run_id)).toEqual([
      'slow', 'fast', 'missing',
    ])
  })
})
