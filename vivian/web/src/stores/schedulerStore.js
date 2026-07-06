import { create } from 'zustand'
import * as api from '../api/scheduler'

const useSchedulerStore = create((set, get) => ({
  jobs: [],
  jobsLoading: false,
  selectedJobId: null,
  runHistory: [],
  runHistoryTotal: null,
  // Cursor stack: stack[-1] is the `before` cursor used to fetch the current
  // page (null for the initial/newest page). Push when paging forward (Next),
  // pop when paging back (Prev).
  historyCursorStack: [null],
  historyNextCursor: null,
  runningTasks: [],
  formOpen: false,
  editingJob: null,
  health: null,

  setSelectedJobId: (id) => set({ selectedJobId: id }),
  setFormOpen: (open) => set({ formOpen: open }),
  setEditingJob: (job) => set({ editingJob: job, formOpen: !!job }),

  fetchJobs: async () => {
    set({ jobsLoading: true })
    try {
      const data = await api.listJobs()
      set({ jobs: data.jobs, jobsLoading: false })
    } catch {
      set({ jobsLoading: false })
    }
  },

  createJob: async (data) => {
    await api.createJob(data)
    get().fetchJobs()
  },

  updateJob: async (jobId, data) => {
    await api.updateJob(jobId, data)
    get().fetchJobs()
  },

  deleteJob: async (jobId) => {
    await api.deleteJob(jobId)
    set((s) => ({
      jobs: s.jobs.filter((j) => j.id !== jobId),
      selectedJobId: s.selectedJobId === jobId ? null : s.selectedJobId,
    }))
  },

  pauseJob: async (jobId) => {
    await api.pauseJob(jobId)
    get().fetchJobs()
  },

  resumeJob: async (jobId) => {
    await api.resumeJob(jobId)
    get().fetchJobs()
  },

  triggerJob: async (jobId) => {
    await api.triggerJob(jobId)
  },

  // --- History (cursor-paginated) ---

  resetHistoryCursors: () => set({
    historyCursorStack: [null],
    historyNextCursor: null,
    runHistoryTotal: null,
  }),

  fetchHistory: async ({ limit = 50, status = null } = {}) => {
    const cursor = get().historyCursorStack.at(-1)
    try {
      const data = await api.getAllHistory({ limit, before: cursor, status })
      set({
        runHistory: data.runs,
        runHistoryTotal: data.total ?? null,
        historyNextCursor: data.next_cursor || null,
      })
    } catch { /* ignore */ }
  },

  fetchJobHistory: async (jobId, { limit = 50 } = {}) => {
    const cursor = get().historyCursorStack.at(-1)
    try {
      const data = await api.getJobHistory(jobId, { limit, before: cursor })
      set({
        runHistory: data.runs,
        runHistoryTotal: data.total ?? null,
        historyNextCursor: data.next_cursor || null,
      })
    } catch { /* ignore */ }
  },

  historyNext: () => {
    const { historyNextCursor, historyCursorStack } = get()
    if (!historyNextCursor) return
    set({ historyCursorStack: [...historyCursorStack, historyNextCursor] })
  },

  historyPrev: () => {
    const { historyCursorStack } = get()
    if (historyCursorStack.length <= 1) return
    set({ historyCursorStack: historyCursorStack.slice(0, -1) })
  },

  fetchRunning: async () => {
    try {
      const data = await api.getRunning()
      set({ runningTasks: data.running })
    } catch { /* ignore */ }
  },

  cancelRun: async (runId) => {
    await api.cancelRun(runId)
  },

  fetchHealth: async () => {
    try {
      const data = await api.getHealth()
      set({ health: data })
    } catch {
      set({ health: { healthy: false, running_count: 0 } })
    }
  },

  reset: () => set({
    jobs: [], jobsLoading: false, selectedJobId: null,
    runHistory: [], runHistoryTotal: null,
    historyCursorStack: [null], historyNextCursor: null,
    runningTasks: [],
    formOpen: false, editingJob: null, health: null,
  }),

  reloadJobs: async () => {
    await api.reloadJobs()
    get().fetchJobs()
  },
}))

export default useSchedulerStore
