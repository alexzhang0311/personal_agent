import { create } from 'zustand'
import {
  createSessionFolder as apiCreateSessionFolder,
  deleteSessionFolder as apiDeleteSessionFolder,
  fetchActiveRuns,
  fetchFolderSessions as apiFetchFolderSessions,
  fetchSessionFolders as apiFetchSessionFolders,
  fetchSessions as apiFetchSessions,
  moveSessionToFolder as apiMoveSessionToFolder,
  renameSessionFolder as apiRenameSessionFolder,
} from '../api/sessions'
import { UnauthorizedError } from '../api/client'
import safeStorage from '../utils/safeStorage'

const STORAGE_KEY_WIDTH = 'sidebar-width'
const STORAGE_KEY_COLLAPSED = 'sidebar-collapsed'
const PAGE_SIZE = 20
const ACTIVE_CHAT_KEY = 'vivian-active-chat'
const ACTIVE_SESSION_ALIAS_KEY = 'vivian-active-session-alias'
const EXPANDED_FOLDERS_KEY = 'session-folder-expanded'
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

const getStoredExpandedFolders = () => {
  const value = safeStorage.getJSON(EXPANDED_FOLDERS_KEY, [])
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
}

const persistExpandedFolders = (folderIds) => {
  safeStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(folderIds))
}

const isFolderMode = (kind, query) => kind === 'chat' && !query

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
    folderId: s.folder_id || null,
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
  sessionFolders: [],
  unfiledCount: 0,
  folderBuckets: {},
  expandedFolderIds: getStoredExpandedFolders(),
  foldersLoading: false,
  folderError: null,

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
    const state = get()
    const row = state.sessions.find((session) => session.id === id) ||
      Object.values(state.folderBuckets).flatMap((bucket) => bucket.sessions || [])
        .find((session) => session.id === id)
    if (row?.folderId) {
      const expanded = [...new Set([...state.expandedFolderIds, row.folderId])]
      persistExpandedFolders(expanded)
      set({ activeSessionId: id, expandedFolderIds: expanded })
      if (!state.folderBuckets[row.folderId]?.loaded) void get().fetchFolderSessions(row.folderId).catch(() => {})
      return
    }
    set({ activeSessionId: id })
  },

  setFolderExpanded: (folderId, expanded) => {
    const current = get().expandedFolderIds
    const next = expanded
      ? [...new Set([...current, folderId])]
      : current.filter((id) => id !== folderId)
    persistExpandedFolders(next)
    set({ expandedFolderIds: next })
    if (expanded && !get().folderBuckets[folderId]?.loaded) {
      void get().fetchFolderSessions(folderId).catch(() => {})
    }
  },

  createSessionFolder: async (name) => {
    set({ folderError: null })
    try {
      const folder = await apiCreateSessionFolder(name)
      const mapped = {
        id: folder.folder_id,
        name: folder.name,
        createdAt: folder.created_at,
        sessionCount: folder.session_count || 0,
      }
      set((s) => ({ sessionFolders: [mapped, ...s.sessionFolders] }))
      get().setFolderExpanded(mapped.id, true)
      return mapped
    } catch (error) {
      set({ folderError: String(error?.message || error) })
      throw error
    }
  },

  renameSessionFolder: async (folderId, name) => {
    set({ folderError: null })
    try {
      const folder = await apiRenameSessionFolder(folderId, name)
      set((s) => ({
        sessionFolders: s.sessionFolders.map((item) => item.id === folderId
          ? { ...item, name: folder.name }
          : item),
      }))
      return folder
    } catch (error) {
      set({ folderError: String(error?.message || error) })
      throw error
    }
  },

  deleteSessionFolder: async (folderId) => {
    set({ folderError: null })
    try {
      await apiDeleteSessionFolder(folderId)
      const state = get()
      const moved = (state.folderBuckets[folderId]?.sessions || [])
        .map((session) => ({ ...session, folderId: null }))
      const expanded = state.expandedFolderIds.filter((id) => id !== folderId)
      persistExpandedFolders(expanded)
      set((s) => {
        const buckets = { ...s.folderBuckets }
        delete buckets[folderId]
        return {
          sessionFolders: s.sessionFolders.filter((folder) => folder.id !== folderId),
          folderBuckets: buckets,
          expandedFolderIds: expanded,
          sessions: isFolderMode(s.sessionKind, s.sessionQuery)
            ? dedupeSessionRows([...moved, ...s.sessions])
            : s.sessions.map((session) => session.folderId === folderId
              ? { ...session, folderId: null }
              : session),
          unfiledCount: s.unfiledCount + moved.length,
        }
      })
      get().fetchSessions()
    } catch (error) {
      set({ folderError: String(error?.message || error) })
      throw error
    }
  },

  fetchFolderSessions: async (folderId, { reset = false } = {}) => {
    const bucket = get().folderBuckets[folderId]
    if (bucket?.loading || (!reset && bucket?.loaded && !bucket?.hasMore)) return
    const offset = reset ? 0 : (bucket?.offset || 0)
    set((s) => ({
      folderBuckets: {
        ...s.folderBuckets,
        [folderId]: { ...(s.folderBuckets[folderId] || {}), loading: true },
      },
    }))
    try {
      const data = await apiFetchFolderSessions(folderId, { limit: PAGE_SIZE, offset })
      const mapped = (data.sessions || []).map(mapSession)
      set((s) => {
        const current = s.folderBuckets[folderId] || {}
        const sessions = reset
          ? mapped
          : dedupeSessionRows([...(current.sessions || []), ...mapped])
        const nextOffset = offset + mapped.length
        return {
          folderBuckets: {
            ...s.folderBuckets,
            [folderId]: {
              sessions,
              total: data.total ?? sessions.length,
              offset: nextOffset,
              hasMore: nextOffset < (data.total ?? sessions.length),
              loading: false,
              loaded: true,
            },
          },
        }
      })
    } catch (error) {
      set((s) => ({
        folderError: String(error?.message || error),
        folderBuckets: {
          ...s.folderBuckets,
          [folderId]: { ...(s.folderBuckets[folderId] || {}), loading: false },
        },
      }))
      throw error
    }
  },

  moveSessionToFolder: async (session, targetFolderId) => {
    if (!session.sessionId || session.sessionKind === 'scheduler') return false
    const sourceFolderId = session.folderId || null
    if (sourceFolderId === targetFolderId) return false
    const snapshot = get()
    set((s) => {
      const folderView = isFolderMode(s.sessionKind, s.sessionQuery)
      const moved = { ...session, folderId: targetFolderId }
      const buckets = { ...s.folderBuckets }
      if (sourceFolderId && buckets[sourceFolderId]) {
        buckets[sourceFolderId] = {
          ...buckets[sourceFolderId],
          sessions: (buckets[sourceFolderId].sessions || [])
            .filter((row) => row.id !== session.id),
        }
      }
      if (targetFolderId && buckets[targetFolderId]?.loaded) {
        buckets[targetFolderId] = {
          ...buckets[targetFolderId],
          sessions: dedupeSessionRows([moved, ...(buckets[targetFolderId].sessions || [])]),
        }
      }
      const sessions = folderView
        ? targetFolderId === null
          ? dedupeSessionRows([moved, ...s.sessions.filter((row) => row.id !== session.id)])
          : s.sessions.filter((row) => row.id !== session.id)
        : s.sessions.map((row) => row.id === session.id ? moved : row)
      return {
        sessions,
        folderBuckets: buckets,
        unfiledCount: Math.max(0, s.unfiledCount + (targetFolderId === null ? 1 : 0) - (sourceFolderId === null ? 1 : 0)),
        sessionFolders: s.sessionFolders.map((folder) => ({
          ...folder,
          sessionCount: Math.max(0, folder.sessionCount
            + (folder.id === targetFolderId ? 1 : 0)
            - (folder.id === sourceFolderId ? 1 : 0)),
        })),
        folderError: null,
      }
    })
    try {
      await apiMoveSessionToFolder(session.sessionId, targetFolderId)
      return true
    } catch (error) {
      set({
        sessions: snapshot.sessions,
        folderBuckets: snapshot.folderBuckets,
        sessionFolders: snapshot.sessionFolders,
        unfiledCount: snapshot.unfiledCount,
        folderError: String(error?.message || error),
      })
      throw error
    }
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
    const foldersVisible = isFolderMode(sessionKind, sessionQuery)
    set({ sessionsLoading: true, foldersLoading: foldersVisible, folderError: null })
    try {
      if (foldersVisible) {
        const activeLookupKey = getStoredSessionAlias() || get().activeSessionId
        const [folderData, unfiledData, countData, activeData, activeLookupData] = await Promise.all([
          apiFetchSessionFolders(),
          apiFetchFolderSessions('unfiled', { limit: PAGE_SIZE, offset: 0 }),
          apiFetchSessions({ limit: 1, offset: 0, kind: 'chat' }),
          fetchActiveRuns().catch(() => ({ runs: [] })),
          activeLookupKey && !activeLookupKey.startsWith('run:')
            ? apiFetchSessions({
                limit: 1,
                offset: 0,
                kind: 'chat',
                q: activeLookupKey,
              }).catch(() => ({ sessions: [] }))
            : Promise.resolve({ sessions: [] }),
        ])
        if (generation !== sessionsRequestGeneration) return
        const persisted = (unfiledData.sessions || []).map(mapSession)
        const previous = get().sessions
        const sessions = reconcileSessionRows(persisted, activeData.runs || [], previous)
          .map((session) => ({ ...session, folderId: null }))
        const unpersistedActive = sessions.filter((row) => row.runId && !row.sessionId).length
        const mappedFolders = (folderData.folders || []).map((folder) => ({
          id: folder.folder_id,
          name: folder.name,
          createdAt: folder.created_at,
          sessionCount: folder.session_count || 0,
        }))
        const validFolderIds = new Set(mappedFolders.map((folder) => folder.id))
        const activeLookup = (activeLookupData.sessions || [])
          .map(mapSession)
          .find((session) => (
            session.id === activeLookupKey ||
            session.sessionId === activeLookupKey
          ))
        const expandedFolderIds = [
          ...new Set([
            ...get().expandedFolderIds.filter((id) => validFolderIds.has(id)),
            ...(activeLookup?.folderId && validFolderIds.has(activeLookup.folderId)
              ? [activeLookup.folderId]
              : []),
          ]),
        ]
        const folderBuckets = Object.fromEntries(
          Object.entries(get().folderBuckets).filter(([id]) => validFolderIds.has(id))
        )
        persistExpandedFolders(expandedFolderIds)
        const counts = countData.counts || {
          chat: countData.total || 0,
          scheduler: 0,
          all: countData.total || 0,
        }
        set({
          sessions,
          sessionFolders: mappedFolders,
          folderBuckets,
          expandedFolderIds,
          unfiledCount: (folderData.unfiled_count || 0) + unpersistedActive,
          sessionsTotal: (unfiledData.total || 0) + unpersistedActive,
          sessionsOffset: persisted.length,
          sessionsHasMore: persisted.length < (unfiledData.total || 0),
          sessionCounts: {
            chat: counts.chat + unpersistedActive,
            scheduler: counts.scheduler,
            all: counts.all + unpersistedActive,
          },
        })
        for (const folderId of expandedFolderIds) {
          if (!folderBuckets[folderId]?.loaded) void get().fetchFolderSessions(folderId).catch(() => {})
        }
        return
      }
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
      set({ folderError: String(err?.message || err) })
    } finally {
      if (generation === sessionsRequestGeneration) {
        set({ sessionsLoading: false, foldersLoading: false })
      }
    }
  },

  reset: () => set({
    sessions: [], activeSessionId: getStoredActiveChat(),
    sessionsTotal: 0, sessionsOffset: 0, sessionsLoading: false,
    sessionsHasMore: false, sessionKind: 'chat', sessionQuery: '',
    sessionCounts: { chat: 0, scheduler: 0, all: 0 },
    sessionFolders: [], unfiledCount: 0, folderBuckets: {},
    expandedFolderIds: getStoredExpandedFolders(), foldersLoading: false,
    folderError: null,
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
      const data = isFolderMode(sessionKind, sessionQuery)
        ? await apiFetchFolderSessions('unfiled', {
            limit: PAGE_SIZE, offset: sessionsOffset,
          })
        : await apiFetchSessions({
            limit: PAGE_SIZE, offset: sessionsOffset,
            kind: sessionKind, q: sessionQuery,
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
