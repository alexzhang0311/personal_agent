import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  fetchActiveRuns: vi.fn(),
  fetchFolderSessions: vi.fn(),
  fetchFolders: vi.fn(),
  fetchSessions: vi.fn(),
  moveSession: vi.fn(),
  renameFolder: vi.fn(),
}))

vi.mock('../../api/sessions', () => ({
  createSessionFolder: api.createFolder,
  deleteSessionFolder: api.deleteFolder,
  fetchActiveRuns: api.fetchActiveRuns,
  fetchFolderSessions: api.fetchFolderSessions,
  fetchSessionFolders: api.fetchFolders,
  fetchSessions: api.fetchSessions,
  moveSessionToFolder: api.moveSession,
  renameSessionFolder: api.renameFolder,
}))

import useSidebarStore from '../sidebarStore'

const session = {
  id: 'session-1',
  sessionId: 'session-1',
  name: 'Session one',
  sessionKind: 'chat',
  folderId: null,
}

function resetStore() {
  useSidebarStore.setState({
    sessions: [session],
    sessionsTotal: 1,
    sessionsOffset: 1,
    sessionsHasMore: false,
    sessionsLoading: false,
    activeSessionId: null,
    sessionKind: 'chat',
    sessionQuery: '',
    sessionCounts: { chat: 1, scheduler: 0, all: 1 },
    sessionFolders: [{ id: 'folder-a', name: 'A', sessionCount: 0 }],
    unfiledCount: 1,
    folderBuckets: {
      'folder-a': { sessions: [], total: 0, offset: 0, loaded: false, hasMore: true },
    },
    expandedFolderIds: [],
    folderError: null,
  })
}

describe('sidebar session folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const stored = new Map()
    vi.stubGlobal('window', {
      sessionStorage: {
        clear: () => stored.clear(),
        getItem: (key) => stored.get(key) ?? null,
        removeItem: (key) => stored.delete(key),
        setItem: (key, value) => stored.set(key, String(value)),
      },
    })
    window.sessionStorage.clear()
    resetStore()
    api.fetchActiveRuns.mockResolvedValue({ runs: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not request an API move when the target is unchanged', async () => {
    const unchanged = { ...session, folderId: 'folder-a' }
    const result = await useSidebarStore.getState().moveSessionToFolder(
      unchanged,
      'folder-a'
    )

    expect(result).toBe(false)
    expect(api.moveSession).not.toHaveBeenCalled()
  })

  it('rolls back an optimistic move when the request fails', async () => {
    api.moveSession.mockRejectedValue(new Error('offline'))

    await expect(
      useSidebarStore.getState().moveSessionToFolder(session, 'folder-a')
    ).rejects.toThrow('offline')

    const state = useSidebarStore.getState()
    expect(state.sessions).toEqual([session])
    expect(state.unfiledCount).toBe(1)
    expect(state.sessionFolders[0].sessionCount).toBe(0)
    expect(state.folderBuckets['folder-a'].sessions).toEqual([])
  })

  it('loads an expanded folder page by page', async () => {
    api.fetchFolderSessions
      .mockResolvedValueOnce({
        sessions: [{
          session_id: 'folder-session-1', summary: 'One', last_modified: 2,
          file_size: 10, session_kind: 'chat', folder_id: 'folder-a',
        }],
        total: 2,
      })
      .mockResolvedValueOnce({
        sessions: [{
          session_id: 'folder-session-2', summary: 'Two', last_modified: 1,
          file_size: 10, session_kind: 'chat', folder_id: 'folder-a',
        }],
        total: 2,
      })

    await useSidebarStore.getState().fetchFolderSessions('folder-a')
    await useSidebarStore.getState().fetchFolderSessions('folder-a')

    expect(api.fetchFolderSessions.mock.calls).toEqual([
      ['folder-a', { limit: 20, offset: 0 }],
      ['folder-a', { limit: 20, offset: 1 }],
    ])
    expect(useSidebarStore.getState().folderBuckets['folder-a'].sessions)
      .toHaveLength(2)
  })

  it('keeps scheduler and search requests on the flat session endpoint', async () => {
    api.fetchSessions.mockResolvedValue({
      sessions: [], total: 0,
      counts: { chat: 0, scheduler: 0, all: 0 },
    })

    useSidebarStore.setState({ sessionKind: 'scheduler', sessionQuery: '' })
    await useSidebarStore.getState().fetchSessions()
    useSidebarStore.setState({ sessionKind: 'chat', sessionQuery: 'needle' })
    await useSidebarStore.getState().fetchSessions()

    expect(api.fetchFolders).not.toHaveBeenCalled()
    expect(api.fetchFolderSessions).not.toHaveBeenCalled()
    expect(api.fetchSessions).toHaveBeenNthCalledWith(1, {
      limit: 20, offset: 0, kind: 'scheduler', q: '',
    })
    expect(api.fetchSessions).toHaveBeenNthCalledWith(2, {
      limit: 20, offset: 0, kind: 'chat', q: 'needle',
    })
  })

  it('expands and loads the active session folder after a refresh', async () => {
    window.sessionStorage.setItem('vivian-active-chat', 'session-in-folder')
    useSidebarStore.setState({ activeSessionId: 'session-in-folder' })
    api.fetchFolders.mockResolvedValue({
      folders: [{
        folder_id: 'folder-a',
        name: 'A',
        created_at: '2026-07-30T00:00:00Z',
        session_count: 1,
      }],
      unfiled_count: 0,
    })
    api.fetchFolderSessions.mockImplementation((folderId) => Promise.resolve({
      sessions: folderId === 'folder-a'
        ? [{
            session_id: 'session-in-folder',
            summary: 'Active',
            last_modified: 1,
            session_kind: 'chat',
            folder_id: 'folder-a',
          }]
        : [],
      total: folderId === 'folder-a' ? 1 : 0,
    }))
    api.fetchSessions
      .mockResolvedValueOnce({
        sessions: [],
        total: 1,
        counts: { chat: 1, scheduler: 0, all: 1 },
      })
      .mockResolvedValueOnce({
        sessions: [{
          session_id: 'session-in-folder',
          summary: 'Active',
          last_modified: 1,
          session_kind: 'chat',
          folder_id: 'folder-a',
        }],
        total: 1,
      })

    await useSidebarStore.getState().fetchSessions()

    expect(useSidebarStore.getState().expandedFolderIds).toContain('folder-a')
    await vi.waitFor(() => {
      expect(useSidebarStore.getState().folderBuckets['folder-a'].loaded).toBe(true)
    })
  })
})
