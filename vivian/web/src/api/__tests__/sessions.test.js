import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSessions } from '../sessions'

describe('sessions API query', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends origin and trimmed server-side search parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchSessions({
      limit: 30,
      offset: 60,
      kind: 'scheduler',
      q: '  nightly report  ',
    })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/agent/sessions')
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      limit: '30',
      offset: '60',
      source: 'project',
      kind: 'scheduler',
      q: 'nightly report',
    })
  })
})
