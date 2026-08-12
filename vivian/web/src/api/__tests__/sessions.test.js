import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFolderSessions, fetchSessions, moveSessionToFolder } from '../sessions'
import useToastStore from '../../stores/toastStore'

describe('sessions API query', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useToastStore.getState().clearToasts()
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

  it('can silence an expected catalog-building 503', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '{"detail":"Session history is still being prepared"}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = fetchSessions({ q: 'session-id' })
    await expect(request).rejects.toMatchObject({
      status: 503, silent: true,
    })

    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('still shows unexpected API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSessions()).rejects.toMatchObject({
      status: 500, silent: false,
    })

    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('pages one folder using the reserved unfiled identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ sessions: [], total: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchFolderSessions('unfiled', { limit: 20, offset: 40 })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/agent/session-folders/unfiled/sessions')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ limit: '20', offset: '40' })
  })

  it('uses null to move a session back to unfiled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ status: 'ok', folder_id: null }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await moveSessionToFolder('session/a', null)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/agent/sessions/session%2Fa/folder')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ folder_id: null })
  })
})
