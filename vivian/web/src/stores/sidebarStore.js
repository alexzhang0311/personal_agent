import { create } from 'zustand'
import { fetchSessions as apiFetchSessions, fetchActiveRuns } from '../api/sessions'
import { UnauthorizedError } from '../api/client'
import safeStorage from '../utils/safeStorage'

const STORAGE_KEY_WIDTH = 'sidebar-width'
const STORAGE_KEY_COLLAPSED = 'sidebar-collapsed'
const PAGE_SIZE = 20
const ACTIVE_CHAT_KEY = 'vivian-active-chat'
const ACTIVE_SESSION_ALIAS_KEY = 'vivian-active-session-alias'
let sessionsRequestGeneration = 0

const getStoredActiveChat = () => {
  try { return window.sessionStorage.getItem(ACTIVE_CHAT_KEY) }
  catch { return null }
}

const persistActiveChat = (id) => {
  try {
    if (id) window.sessionStorage.setItem(ACTIVE_CHAT_KEY, id)
    else {
      window.sessionStorage.removeItem(ACTIVE_CHAT_KEY)
      window.sessionStorage.removeItem(ACTIVE_SESSION_ALIAS_KEY)
    }
  } catch { /* storage unavailable */ }
}

const getStoredSessionAlias = () => {
  try { return window.sessionStorage.getItem(ACTIVE_SESSION_ALIAS_KEY) }
  catch { return null }
}

const persistSessionAlias = (sessionId) => {
  try {
    if (sessionId) window.sessionStorage.setItem(ACTIVE_SESSION_ALIAS_KEY, sessionId)
  } catch { /* storage unavailable */ }
}

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

export function mapSession(s) {
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
    sessionKind: s.session_kind || 'chat',
    schedulerContext: s.scheduler_context || null,
  }
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function runPriority(run) {
  const statusPriority = run.status === 'waiting_user' ? 2 : run.status === 'running' ? 1 : 0
  return [statusPriority, Number(run.updated_at || run.created_at || 0)]
}

function preferRun(current, candidate) {
  if (!current) return candidate
  const [currentStatus, currentTime] = runPriority(current)
  const [candidateStatus, candidateTime] = runPriority(candidate)
  if (candidateStatus !== currentStatus) return candidateStatus > currentStatus ? candidate : current
  return candidateTime > currentTime ? candidate : current
}

export function dedupeSessionRows(rows) {
  const result = []
  for (const row of rows) {
    const duplicateIndex = result.findIndex((existing) => (
      existing.id === row.id ||
      (row.runId && existing.runId === row.runId) ||
      (row.sessionId && existing.sessionId === row.sessionId)
    ))
    if (duplicateIndex < 0) result.push(row)
    else result[duplicateIndex] = { ...row, ...result[duplicateIndex] }
  }
  return result
}

export function reconcileSessionRows(persisted, activeRuns, previous = []) {
  // There can be several retained runs for one Claude session. The sidebar is
  // a Chat list, not a run list, so group by session_id and retain the most
  // actionable/current run. Filtering terminal rows also keeps this safe when
  // talking to an older backend that returned retained completed runs.
  const groupedRuns = new Map()
  for (const run of activeRuns || []) {
    if (TERMINAL_RUN_STATUSES.has(run.status)) continue
    const key = run.session_id ? `session:${run.session_id}` : `run:${run.run_id}`
    groupedRuns.set(key, preferRun(groupedRuns.get(key), run))
  }

  const activeRows = [...groupedRuns.values()].map((run) => {
    const existing = previous.find((row) => row.runId === run.run_id) ||
      (run.session_id ? previous.find((row) => row.sessionId === run.session_id) : null)
    const persistedRow = run.session_id
      ? persisted.find((row) => row.sessionId === run.session_id)
      : null
    const base = existing || persistedRow || {}
    const sessionId = run.session_id || base.sessionId || null
    return {
      ...(persistedRow || {}),
      ...base,
      id: base.id || persistedRow?.id || sessionId || `run:${run.run_id}`,
      sessionId,
      runId: run.run_id,
      name: base.name || persistedRow?.name || run.first_prompt || run.run_id,
      firstPrompt: run.first_prompt || base.firstPrompt || persistedRow?.firstPrompt,
      createdAt: Math.round((run.updated_at || run.created_at || Date.now() / 1000) * 1000),
      sessionSource: 'project',
      sessionKind: 'chat',
      runStatus: run.status,
      pendingRequest: run.pending_requests?.[0] || null,
      seq: run.seq || base.seq || 0,
    }
  })

  const activeSessionIds = new Set(activeRows.map((row) => row.sessionId).filter(Boolean))
  const activeRunIds = new Set(activeRows.map((row) => row.runId).filter(Boolean))
  return dedupeSessionRows([
    ...activeRows,
    ...persisted.filter((row) => (
      !activeSessionIds.has(row.sessionId) && !activeRunIds.has(row.runId)
    )),
  ])
}

const useSidebarStore = create((set, get) => ({
  width: getStoredWidth(),
  collapsed: getStoredCollapsed(),
  sessions: [],
  activeSessionId: getStoredActiveChat(),
  // Pagination state
  sessionsTotal: 0,
  sessionsOffset: 0,
  sessionsLoading: false,
  sessionsHasMore: false,
  sessionKind: 'chat',
  sessionQuery: '',
  sessionCounts: { chat: 0, scheduler: 0, all: 0 },

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

  setActiveSessionId: (id) => {
    persistActiveChat(id)
    set({ activeSessionId: id })
  },

  addSession: (session) => set((s) => {
    const normalized = { sessionKind: 'chat', ...session }
    const withoutDuplicate = s.sessions.filter((row) => (
      row.id !== normalized.id &&
      (!normalized.runId || row.runId !== normalized.runId) &&
      (!normalized.sessionId || row.sessionId !== normalized.sessionId)
    ))
    persistActiveChat(normalized.id)
    const added = withoutDuplicate.length === s.sessions.length ? 1 : 0
    return {
      sessions: [normalized, ...withoutDuplicate],
      activeSessionId: normalized.id,
      sessionsTotal: s.sessionsTotal + added,
      sessionKind: 'chat',
      sessionCounts: {
        ...s.sessionCounts,
        chat: s.sessionCounts.chat + added,
        all: s.sessionCounts.all + added,
      },
    }
  }),

  updateSession: (id, data) => set((s) => {
    if (s.activeSessionId === id && data.sessionId) persistSessionAlias(data.sessionId)
    return {
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...data } : sess
      ),
    }
  }),

  promoteSession: (id, nextId, data = {}) => set((s) => {
    if (!nextId || id === nextId) {
      if (s.activeSessionId === id && data.sessionId) persistSessionAlias(data.sessionId)
      return { sessions: s.sessions.map((row) => row.id === id ? { ...row, ...data } : row) }
    }
    const promoted = s.sessions.find((row) => row.id === id)
    if (!promoted) return {}
    const next = { ...promoted, ...data, id: nextId }
    const sessions = [
      next,
      ...s.sessions.filter((row) => (
        row.id !== id &&
        row.id !== nextId &&
        (!next.runId || row.runId !== next.runId) &&
        (!next.sessionId || row.sessionId !== next.sessionId)
      )),
    ]
    const activeSessionId = s.activeSessionId === id ? nextId : s.activeSessionId
    if (activeSessionId === nextId && data.sessionId) persistSessionAlias(data.sessionId)
    if (activeSessionId !== s.activeSessionId) persistActiveChat(activeSessionId)
    return { sessions, activeSessionId }
  }),

  updateRun: (runId, data) => set((s) => ({
    sessions: s.sessions.map((sess) => sess.runId === runId ? { ...sess, ...data } : sess),
  })),

  setSessionKind: (kind) => {
    if (kind === get().sessionKind) return
    sessionsRequestGeneration += 1
    set({
      sessionKind: kind,
      sessions: [],
      sessionsTotal: 0,
      sessionsOffset: 0,
      sessionsHasMore: false,
    })
    get().fetchSessions()
  },

  setSessionQuery: (query) => {
    const normalized = query.trim()
    if (normalized === get().sessionQuery) return
    sessionsRequestGeneration += 1
    set({
      sessionQuery: normalized,
      sessions: [],
      sessionsTotal: 0,
      sessionsOffset: 0,
      sessionsHasMore: false,
    })
    get().fetchSessions()
  },

  fetchSessions: async () => {
    const { sessionKind, sessionQuery } = get()
    const generation = ++sessionsRequestGeneration
    set({ sessionsLoading: true })
    try {
      const [data, activeData] = await Promise.all([
        apiFetchSessions({
          limit: PAGE_SIZE,
          offset: 0,
          kind: sessionKind,
          q: sessionQuery,
        }),
        sessionKind === 'scheduler'
          ? Promise.resolve({ runs: [] })
          : fetchActiveRuns().catch(() => ({ runs: [] })),
      ])
      if (generation !== sessionsRequestGeneration) return
      const hasKindMetadata = Boolean(data.counts)
      const mappedPersisted = (data.sessions || []).map(mapSession)
      // During a rolling deployment an older API may ignore `kind` and omit
      // classification metadata. Those legacy rows are all historical chats:
      // keep Chat/All useful, but never leak them into the Scheduler view.
      const persisted = hasKindMetadata || sessionKind !== 'scheduler'
        ? mappedPersisted
        : []
      const previous = get().sessions
      const sessions = reconcileSessionRows(persisted, activeData.runs || [], previous)
      const unpersistedActive = sessions.filter((row) => row.runId && !row.sessionId).length
      const persistedTotal = hasKindMetadata
        ? (data.total ?? persisted.length)
        : sessionKind === 'scheduler'
          ? 0
          : (data.total ?? persisted.length)
      const counts = data.counts || {
        chat: data.total ?? mappedPersisted.length,
        scheduler: 0,
        all: data.total ?? mappedPersisted.length,
      }
      const storedActive = get().activeSessionId
      const storedAlias = getStoredSessionAlias()
      const restoredActive = sessions.find((row) => (
        row.id === storedActive ||
        (row.runId && `run:${row.runId}` === storedActive) ||
        (storedAlias && row.sessionId === storedAlias)
      ))?.id || storedActive
      if (restoredActive !== storedActive) persistActiveChat(restoredActive)
      set({
        sessions,
        activeSessionId: restoredActive,
        sessionsTotal: persistedTotal + unpersistedActive,
        sessionsOffset: persisted.length,
        sessionsHasMore: persisted.length < persistedTotal,
        sessionCounts: {
          chat: counts.chat + unpersistedActive,
          scheduler: counts.scheduler,
          all: counts.all + unpersistedActive,
        },
      })
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      console.error('Failed to fetch sessions:', err)
    } finally {
      if (generation === sessionsRequestGeneration) set({ sessionsLoading: false })
    }
  },

  reset: () => set({
    sessions: [], activeSessionId: getStoredActiveChat(),
    sessionsTotal: 0, sessionsOffset: 0, sessionsLoading: false,
    sessionsHasMore: false, sessionKind: 'chat', sessionQuery: '',
    sessionCounts: { chat: 0, scheduler: 0, all: 0 },
  }),

  fetchMoreSessions: async () => {
    const {
      sessionsOffset, sessionsLoading, sessionsHasMore,
      sessionKind, sessionQuery,
    } = get()
    if (sessionsLoading || !sessionsHasMore) return
    const generation = sessionsRequestGeneration
    set({ sessionsLoading: true })
    try {
      const data = await apiFetchSessions({
        limit: PAGE_SIZE,
        offset: sessionsOffset,
        kind: sessionKind,
        q: sessionQuery,
      })
      if (generation !== sessionsRequestGeneration) return
      const newSessions = (data.sessions || []).map(mapSession)
      set((s) => {
        const combined = dedupeSessionRows([...s.sessions, ...newSessions])
        const total = data.total ?? combined.length
        const unpersistedActive = combined.filter((row) => row.runId && !row.sessionId).length
        return {
          sessions: combined,
          sessionsTotal: total + unpersistedActive,
          sessionsOffset: s.sessionsOffset + newSessions.length,
          sessionsHasMore: s.sessionsOffset + newSessions.length < total,
          sessionCounts: data.counts
            ? {
                chat: data.counts.chat + unpersistedActive,
                scheduler: data.counts.scheduler,
                all: data.counts.all + unpersistedActive,
              }
            : s.sessionCounts,
        }
      })
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      console.error('Failed to fetch more sessions:', err)
    } finally {
      if (generation === sessionsRequestGeneration) set({ sessionsLoading: false })
    }
  },
}))

export default useSidebarStore
