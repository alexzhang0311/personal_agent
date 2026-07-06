import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import * as adminApi from '../api/admin'

const useAdminStore = create((set, get) => ({
  activeSection: 'users',
  setActiveSection: (section) => set({ activeSection: section }),

  // User management
  users: [],
  usersLoading: true,
  selectedUser: null,
  drawerOpen: false,

  fetchUsers: async () => {
    set({ usersLoading: true })
    try {
      const users = await adminApi.listUsers()
      set({ users, usersLoading: false })
    } catch {
      set({ usersLoading: false })
    }
  },

  openUserDrawer: (username) => set({ selectedUser: username, drawerOpen: true }),
  closeUserDrawer: () => set({ selectedUser: null, drawerOpen: false }),

  // User inspection (tab viewer)
  inspectedUser: null,
  inspectedTab: 'skills',
  inspectedUserSkills: [],
  inspectedUserSkillsLoading: false,
  inspectedUserMcpServers: [],
  inspectedUserMcpLoading: false,
  inspectedUserSchedulerJobs: [],
  inspectedUserSchedulerLoading: false,
  inspectedUserHooks: { builtins: [], custom: [] },
  inspectedUserHooksLoading: false,

  setInspectedUser: (username) => {
    set({ inspectedUser: username })
    if (username) {
      get().fetchInspectedUserSkills(username)
      get().fetchInspectedUserMcpServers(username)
      get().fetchInspectedUserSchedulerJobs(username)
      get().fetchInspectedUserHooks(username)
    }
  },

  setInspectedTab: (tab) => set({ inspectedTab: tab }),

  fetchInspectedUserSkills: async (username) => {
    set({ inspectedUserSkillsLoading: true })
    try {
      const data = await adminApi.getUserSkills(username)
      set({ inspectedUserSkills: data.skills, inspectedUserSkillsLoading: false })
    } catch {
      set({ inspectedUserSkills: [], inspectedUserSkillsLoading: false })
    }
  },

  deleteInspectedUserSkill: async (username, level, name) => {
    try {
      await adminApi.deleteUserSkill(username, level, name)
      get().fetchInspectedUserSkills(username)
    } catch (e) {
      console.error('Failed to delete skill:', e)
    }
  },

  fetchInspectedUserMcpServers: async (username) => {
    set({ inspectedUserMcpLoading: true })
    try {
      const data = await adminApi.getUserMcpServers(username)
      set({ inspectedUserMcpServers: data.servers, inspectedUserMcpLoading: false })
    } catch {
      set({ inspectedUserMcpServers: [], inspectedUserMcpLoading: false })
    }
  },

  deleteInspectedUserMcpServer: async (username, level, name) => {
    try {
      await adminApi.deleteUserMcpServer(username, level, name)
      get().fetchInspectedUserMcpServers(username)
    } catch (e) {
      console.error('Failed to delete MCP server:', e)
    }
  },

  fetchInspectedUserSchedulerJobs: async (username) => {
    set({ inspectedUserSchedulerLoading: true })
    try {
      const data = await adminApi.getUserSchedulerJobs(username)
      set({
        inspectedUserSchedulerJobs: data.jobs || [],
        inspectedUserSchedulerLoading: false,
      })
    } catch {
      set({ inspectedUserSchedulerJobs: [], inspectedUserSchedulerLoading: false })
    }
  },

  fetchInspectedUserHooks: async (username) => {
    set({ inspectedUserHooksLoading: true })
    try {
      const data = await adminApi.getUserActiveHooks(username)
      set({
        inspectedUserHooks: {
          builtins: data.builtins || [],
          custom: data.custom || [],
        },
        inspectedUserHooksLoading: false,
      })
    } catch {
      set({
        inspectedUserHooks: { builtins: [], custom: [] },
        inspectedUserHooksLoading: false,
      })
    }
  },

  // Resizable edit drawer
  drawerWidth: safeStorage.getNumber('admin-drawer-width', 420, { min: 320, max: typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.6) : 420 }),
  setDrawerWidth: (width) => {
    safeStorage.setItem('admin-drawer-width', String(width))
    set({ drawerWidth: width })
  },

  // Stats
  stats: null,
  statsLoading: true,

  fetchStats: async () => {
    set({ statsLoading: true })
    try {
      const stats = await adminApi.getAdminStats()
      set({ stats, statsLoading: false })
    } catch {
      set({ statsLoading: false })
    }
  },

  // Audit log (cursor-paginated)
  auditEntries: [],
  auditTotal: null,
  auditLoading: true,
  auditCursorStack: [null],
  auditNextCursor: null,
  auditActionFilter: null,
  auditActorFilter: '',
  auditTargetFilter: '',
  auditSessionFilter: '',
  auditStartTime: null,
  auditEndTime: null,

  fetchAuditLog: async (append = false) => {
    const {
      auditActionFilter, auditActorFilter, auditTargetFilter, auditSessionFilter,
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
      if (auditActionFilter && auditActionFilter !== '_actor' && auditActionFilter !== 'session') params.action = auditActionFilter
      if (auditActorFilter) params.actor = auditActorFilter
      if (auditTargetFilter) params.target = auditTargetFilter
      if (auditSessionFilter) params.session_id = auditSessionFilter
      if (auditStartTime) params.start = auditStartTime
      if (auditEndTime) params.end = auditEndTime

      const data = await adminApi.getAuditLog(params)
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
  setAuditActorFilter: (filter) => set({
    auditActorFilter: filter, auditCursorStack: [null], auditNextCursor: null,
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

  // Actor list for dropdown (fetched without actor filter)
  auditActors: [],

  fetchAuditActors: async () => {
    const { auditStartTime, auditEndTime } = get()
    try {
      const params = { limit: 200 }
      if (auditStartTime) params.start = auditStartTime
      if (auditEndTime) params.end = auditEndTime
      const data = await adminApi.getAuditLog(params)
      const counts = {}
      for (const e of data.entries) {
        if (e.actor) counts[e.actor] = (counts[e.actor] || 0) + 1
      }
      const actors = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([actor, count]) => ({ actor, count }))
      set({ auditActors: actors })
    } catch {}
  },

  reset: () => set({
    activeSection: 'users', users: [], usersLoading: true,
    selectedUser: null, drawerOpen: false,
    inspectedUser: null, inspectedTab: 'skills',
    inspectedUserSkills: [], inspectedUserSkillsLoading: false,
    inspectedUserMcpServers: [], inspectedUserMcpLoading: false,
    inspectedUserSchedulerJobs: [], inspectedUserSchedulerLoading: false,
    inspectedUserHooks: { builtins: [], custom: [] }, inspectedUserHooksLoading: false,
    stats: null, statsLoading: true,
    auditEntries: [], auditTotal: null, auditLoading: true,
    auditCursorStack: [null], auditNextCursor: null,
    auditActionFilter: null, auditActorFilter: '', auditTargetFilter: '', auditSessionFilter: '',
    auditStartTime: null, auditEndTime: null,
    auditChartEntries: [], auditChartLoading: true,
    auditActors: [],
  }),

  fetchAuditLogForCharts: async () => {
    const { auditActionFilter, auditActorFilter, auditTargetFilter, auditSessionFilter, auditStartTime, auditEndTime } = get()
    set({ auditChartLoading: true })
    try {
      const params = { limit: 200 }
      if (auditActionFilter && auditActionFilter !== '_actor' && auditActionFilter !== 'session') params.action = auditActionFilter
      if (auditActorFilter) params.actor = auditActorFilter
      if (auditTargetFilter) params.target = auditTargetFilter
      if (auditSessionFilter) params.session_id = auditSessionFilter
      if (auditStartTime) params.start = auditStartTime
      if (auditEndTime) params.end = auditEndTime
      const data = await adminApi.getAuditLog(params)
      set({ auditChartEntries: data.entries, auditChartLoading: false })
    } catch {
      set({ auditChartLoading: false })
    }
  },
}))

export default useAdminStore
