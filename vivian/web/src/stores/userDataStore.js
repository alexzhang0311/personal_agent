import { create } from 'zustand'
import * as userDataApi from '../api/userData'
import { listUploadedFiles, deleteUploadedFile } from '../api/files'

const useUserDataStore = create((set, get) => ({
  activeSection: 'usage',
  setActiveSection: (section) => set({ activeSection: section }),

  // Usage stats
  stats: null,
  statsLoading: true,

  fetchStats: async () => {
    set({ statsLoading: true })
    try {
      const stats = await userDataApi.getUserStats()
      set({ stats, statsLoading: false })
    } catch {
      set({ statsLoading: false })
    }
  },

  // Audit log (cursor-paginated)
  auditEntries: [],
  auditTotal: null,
  auditLoading: true,
  // Cursor stack: stack[-1] is the `before` cursor for the current page.
  // null = newest page. We append on "load more" / next, pop on prev.
  auditCursorStack: [null],
  auditNextCursor: null,
  auditActionFilter: null,
  auditTargetFilter: '',
  auditSessionFilter: '',
  auditStartTime: null,
  auditEndTime: null,

  fetchAuditLog: async (append = false) => {
    const {
      auditActionFilter, auditTargetFilter, auditSessionFilter,
      auditStartTime, auditEndTime, auditEntries,
      auditCursorStack, auditNextCursor,
    } = get()
    set({ auditLoading: true })
    try {
      let cursor
      let nextStack = auditCursorStack
      if (append) {
        if (!auditNextCursor) {
          set({ auditLoading: false })
          return
        }
        nextStack = [...auditCursorStack, auditNextCursor]
        cursor = auditNextCursor
      } else {
        cursor = auditCursorStack.at(-1)
      }

      const params = { limit: 50 }
      if (cursor) params.before = cursor
      if (auditActionFilter && auditActionFilter !== 'session') params.action = auditActionFilter
      if (auditTargetFilter) params.target = auditTargetFilter
      if (auditSessionFilter) params.session_id = auditSessionFilter
      if (auditStartTime) params.start = auditStartTime
      if (auditEndTime) params.end = auditEndTime

      const data = await userDataApi.getUserAuditLog(params)
      set({
        auditEntries: append ? [...auditEntries, ...data.entries] : data.entries,
        auditTotal: data.total ?? null,
        auditNextCursor: data.next_cursor || null,
        auditCursorStack: nextStack,
        auditLoading: false,
      })
    } catch {
      set({ auditLoading: false })
    }
  },

  resetAuditCursors: () => set({
    auditCursorStack: [null], auditNextCursor: null, auditTotal: null, auditEntries: [],
  }),

  setAuditActionFilter: (filter) => set({
    auditActionFilter: filter, auditCursorStack: [null], auditNextCursor: null,
  }),
  setAuditTargetFilter: (filter) => set({
    auditTargetFilter: filter, auditCursorStack: [null], auditNextCursor: null,
  }),
  setAuditSessionFilter: (filter) => set({
    auditSessionFilter: filter, auditCursorStack: [null], auditNextCursor: null,
  }),
  setAuditTimeRange: (start, end) => set({
    auditStartTime: start, auditEndTime: end,
    auditCursorStack: [null], auditNextCursor: null,
  }),

  // Audit chart data (separate from paginated entries)
  auditChartEntries: [],
  auditChartLoading: true,

  fetchAuditLogForCharts: async () => {
    const { auditActionFilter, auditTargetFilter, auditSessionFilter, auditStartTime, auditEndTime } = get()
    set({ auditChartLoading: true })
    try {
      const params = { limit: 200 }
      if (auditActionFilter && auditActionFilter !== 'session') params.action = auditActionFilter
      if (auditTargetFilter) params.target = auditTargetFilter
      if (auditSessionFilter) params.session_id = auditSessionFilter
      if (auditStartTime) params.start = auditStartTime
      if (auditEndTime) params.end = auditEndTime
      const data = await userDataApi.getUserAuditLog(params)
      set({ auditChartEntries: data.entries, auditChartLoading: false })
    } catch {
      set({ auditChartLoading: false })
    }
  },

  // Analytics
  analytics: null,
  analyticsLoading: true,
  analyticsStartTime: null,
  analyticsEndTime: null,

  fetchAnalytics: async () => {
    const { analyticsStartTime, analyticsEndTime } = get()
    set({ analyticsLoading: true })
    try {
      const params = {}
      if (analyticsStartTime) params.start = analyticsStartTime
      if (analyticsEndTime) params.end = analyticsEndTime
      const data = await userDataApi.getUserAnalytics(params)
      set({ analytics: data, analyticsLoading: false })
    } catch {
      set({ analyticsLoading: false })
    }
  },

  setAnalyticsTimeRange: (start, end) => set({ analyticsStartTime: start, analyticsEndTime: end }),

  // Files
  files: [],
  filesLoading: true,
  selectedFileUuids: new Set(),
  previewFile: null,
  dateFilter: null,
  extFilter: null,
  searchQuery: '',

  fetchFiles: async () => {
    const { dateFilter } = get()
    set({ filesLoading: true })
    try {
      const data = await listUploadedFiles(dateFilter || undefined)
      set({ files: data.files || [], filesLoading: false })
    } catch {
      set({ filesLoading: false })
    }
  },

  deleteFiles: async (uuids) => {
    const results = await Promise.allSettled(uuids.map((uuid) => deleteUploadedFile(uuid)))
    // Refresh file list after deletion
    const { fetchFiles } = get()
    await fetchFiles()
    // Clear selection and preview if deleted
    const { previewFile, selectedFileUuids } = get()
    const deletedSet = new Set(uuids)
    const newSelected = new Set([...selectedFileUuids].filter((u) => !deletedSet.has(u)))
    const newPreview = previewFile && deletedSet.has(previewFile.uuid) ? null : previewFile
    set({ selectedFileUuids: newSelected, previewFile: newPreview })
    return results
  },

  toggleFileSelection: (uuid) => {
    const { selectedFileUuids } = get()
    const next = new Set(selectedFileUuids)
    if (next.has(uuid)) {
      next.delete(uuid)
    } else {
      next.add(uuid)
    }
    set({ selectedFileUuids: next })
  },

  selectAllFiles: () => {
    const { files, searchQuery } = get()
    const filtered = searchQuery
      ? files.filter((f) => f.original_name.toLowerCase().includes(searchQuery.toLowerCase()))
      : files
    set({ selectedFileUuids: new Set(filtered.map((f) => f.uuid)) })
  },

  clearSelection: () => set({ selectedFileUuids: new Set() }),

  setPreviewFile: (file) => set({ previewFile: file }),

  reset: () => set({
    activeSection: 'usage', stats: null, statsLoading: true,
    auditEntries: [], auditTotal: null, auditLoading: true,
    auditCursorStack: [null], auditNextCursor: null,
    auditActionFilter: null, auditTargetFilter: '', auditSessionFilter: '',
    auditStartTime: null, auditEndTime: null,
    auditChartEntries: [], auditChartLoading: true,
    analytics: null, analyticsLoading: true,
    analyticsStartTime: null, analyticsEndTime: null,
    files: [], filesLoading: true, selectedFileUuids: new Set(),
    previewFile: null, dateFilter: null, extFilter: null, searchQuery: '',
  }),

  setDateFilter: (date) => set({ dateFilter: date }),
  setExtFilter: (ext) => set({ extFilter: ext }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}))

export default useUserDataStore
