import { create } from 'zustand'
import { fetchSessions as apiFetchSessions } from '../api/sessions'
import { UnauthorizedError } from '../api/client'
import safeStorage from '../utils/safeStorage'

const STORAGE_KEY_WIDTH = 'sidebar-width'
const STORAGE_KEY_COLLAPSED = 'sidebar-collapsed'
const PAGE_SIZE = 20

const getStoredWidth = () => safeStorage.getNumber(STORAGE_KEY_WIDTH, 240, { min: 180, max: 480 })

const getStoredCollapsed = () => safeStorage.getBoolean(STORAGE_KEY_COLLAPSED)

let _widthSaveTimer = null
const persistWidth = (width) => {
  if (_widthSaveTimer) clearTimeout(_widthSaveTimer)
  _widthSaveTimer = setTimeout(() => {
    safeStorage.setItem(STORAGE_KEY_WIDTH, String(width))
    _widthSaveTimer = null
  }, 200)
}

function mapSession(s) {
  return {
    id: s.session_id,
    sessionId: s.session_id,
    name: s.custom_title || s.first_prompt || s.summary || s.session_id,
    customTitle: s.custom_title || null,
    createdAt: s.last_modified,
    summary: s.summary,
    firstPrompt: s.first_prompt,
    gitBranch: s.git_branch,
    cwd: s.cwd,
    fileSize: s.file_size,
    sessionSource: s.session_source || 'project',
    tag: s.tag || null,
    parentSessionId: s.parent_session_id || null,
    parentMessageUuid: s.parent_message_uuid || null,
    forkCount: s.fork_count || 0,
  }
}

const useSidebarStore = create((set, get) => ({
  width: getStoredWidth(),
  collapsed: getStoredCollapsed(),
  sessions: [],
  activeSessionId: null,
  // Pagination state
  sessionsTotal: 0,
  sessionsOffset: 0,
  sessionsLoading: false,
  sessionsHasMore: false,
  // Source filter
  sessionsSource: 'project',
  // Tag filter (null = show all)
  activeTag: null,
  setActiveTag: (tag) => set({ activeTag: tag }),

  setWidth: (width) => {
    set({ width })
    persistWidth(width)
  },

  setCollapsed: (collapsed) => {
    safeStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed))
    set({ collapsed })
  },

  toggleCollapsed: () => set((s) => {
    const collapsed = !s.collapsed
    safeStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed))
    return { collapsed }
  }),

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  addSession: (session) => set((s) => ({
    sessions: [session, ...s.sessions],
    activeSessionId: session.id,
    sessionsTotal: s.sessionsTotal + 1,
  })),

  updateSession: (id, data) => set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id === id ? { ...sess, ...data } : sess
    ),
  })),

  setSessionsSource: (source) => {
    set({ sessionsSource: source, sessions: [], sessionsOffset: 0, sessionsHasMore: false })
    get().fetchSessions()
  },

  fetchSessions: async () => {
    const { sessionsSource } = get()
    set({ sessionsLoading: true })
    try {
      const data = await apiFetchSessions(PAGE_SIZE, 0, sessionsSource)
      const sessions = (data.sessions || []).map(mapSession)
      set({
        sessions,
        sessionsTotal: data.total || sessions.length,
        sessionsOffset: sessions.length,
        sessionsHasMore: sessions.length < (data.total || 0),
      })
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      console.error('Failed to fetch sessions:', err)
    } finally {
      set({ sessionsLoading: false })
    }
  },

  reset: () => set({
    sessions: [], activeSessionId: null,
    sessionsTotal: 0, sessionsOffset: 0, sessionsLoading: false,
    sessionsHasMore: false, sessionsSource: 'project',
  }),

  fetchMoreSessions: async () => {
    const { sessionsOffset, sessionsLoading, sessionsHasMore, sessionsSource } = get()
    if (sessionsLoading || !sessionsHasMore) return
    set({ sessionsLoading: true })
    try {
      const data = await apiFetchSessions(PAGE_SIZE, sessionsOffset, sessionsSource)
      const newSessions = (data.sessions || []).map(mapSession)
      set((s) => {
        const combined = [...s.sessions, ...newSessions]
        const total = data.total || combined.length
        return {
          sessions: combined,
          sessionsTotal: total,
          sessionsOffset: combined.length,
          sessionsHasMore: combined.length < total,
        }
      })
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      console.error('Failed to fetch more sessions:', err)
    } finally {
      set({ sessionsLoading: false })
    }
  },
}))

export default useSidebarStore
