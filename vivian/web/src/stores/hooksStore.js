import { create } from 'zustand'
import * as hooksApi from '../api/hooks'
import safeStorage from '../utils/safeStorage'

const DEFAULT_DETAIL_WIDTH = 380

const useHooksStore = create((set, get) => ({
  selectedHookId: null,
  activeDetailTab: 'config',
  configuredHooks: {},
  detailWidth: safeStorage.getNumber('hooks-detail-width', DEFAULT_DETAIL_WIDTH, { min: 280, max: 600 }),

  // Config state
  configLoading: false,
  savingConfig: false,

  // Catalog state
  catalog: [],
  catalogLoading: false,

  // Test state
  testResult: null,
  testRunning: false,

  // Logs state (cursor-paginated)
  logs: [],
  logsTotal: null,
  logsLoading: false,
  logsFilter: null,
  // Cursor stack: stack[-1] is the `before` cursor for the current page.
  logsCursorStack: [null],
  logsNextCursor: null,

  // Handler form state
  handlerFormOpen: false,
  editingHandler: null, // { eventType, index, entry } or null (= new)

  // --- Navigation ---
  selectHook: (id) => {
    set({ selectedHookId: id, activeDetailTab: 'config' })
    const s = get()
    if (!s._configLoaded) s.loadConfig()
    if (!s._catalogLoaded) s.loadCatalog()
  },
  clearSelection: () => set({ selectedHookId: null }),
  setDetailTab: (tab) => set({ activeDetailTab: tab }),
  setDetailWidth: (w) => {
    safeStorage.setItem('hooks-detail-width', String(w))
    set({ detailWidth: w })
  },

  // --- Config ---
  _configLoaded: false,
  loadConfig: async () => {
    set({ configLoading: true })
    try {
      const data = await hooksApi.fetchConfig()
      set({ configuredHooks: data.hooks || {}, _configLoaded: true })
    } catch (e) {
      console.error('Failed to load hook config:', e)
    } finally {
      set({ configLoading: false })
    }
  },

  saveConfig: async (hooks) => {
    set({ savingConfig: true })
    try {
      const data = await hooksApi.updateConfig(hooks)
      set({ configuredHooks: data.hooks || hooks })
    } catch (e) {
      console.error('Failed to save hook config:', e)
    } finally {
      set({ savingConfig: false })
    }
  },

  addHandler: async (eventType, entry) => {
    const hooks = { ...get().configuredHooks }
    if (!hooks[eventType]) hooks[eventType] = []
    hooks[eventType] = [...hooks[eventType], entry]
    await get().saveConfig(hooks)
  },

  updateHandler: async (eventType, idx, entry) => {
    const hooks = { ...get().configuredHooks }
    const list = [...(hooks[eventType] || [])]
    list[idx] = entry
    hooks[eventType] = list
    await get().saveConfig(hooks)
  },

  removeHandler: async (eventType, idx) => {
    const hooks = { ...get().configuredHooks }
    const list = [...(hooks[eventType] || [])]
    list.splice(idx, 1)
    hooks[eventType] = list.length ? list : undefined
    // Clean up empty keys
    if (!hooks[eventType]) delete hooks[eventType]
    await get().saveConfig(hooks)
  },

  // --- Catalog ---
  _catalogLoaded: false,
  loadCatalog: async () => {
    set({ catalogLoading: true })
    try {
      const data = await hooksApi.fetchCatalog()
      set({ catalog: Array.isArray(data) ? data : [], _catalogLoaded: true })
    } catch (e) {
      console.error('Failed to load hook catalog:', e)
    } finally {
      set({ catalogLoading: false })
    }
  },

  enableBuiltInHook: async (hookId) => {
    try {
      await hooksApi.enableBuiltInHook(hookId)
      await get().loadCatalog()
    } catch (e) {
      console.error('Failed to enable built-in hook:', e)
    }
  },

  disableBuiltInHook: async (hookId) => {
    try {
      await hooksApi.disableBuiltInHook(hookId)
      await get().loadCatalog()
    } catch (e) {
      console.error('Failed to disable built-in hook:', e)
    }
  },

  testBuiltInHook: async (hookId, eventType, inputJson) => {
    set({ testRunning: true, testResult: null })
    try {
      const result = await hooksApi.testBuiltInHook(hookId, eventType, inputJson)
      set({ testResult: result })
    } catch (e) {
      set({ testResult: { hook_id: hookId, duration_ms: 0, error: e.message } })
    } finally {
      set({ testRunning: false })
    }
  },

  // --- Test ---
  runTest: async (eventType, handler, inputJson) => {
    set({ testRunning: true, testResult: null })
    try {
      const result = await hooksApi.testHook(eventType, handler, inputJson)
      set({ testResult: result })
    } catch (e) {
      set({ testResult: { exit_code: -1, stdout: '', stderr: e.message, duration_ms: 0 } })
    } finally {
      set({ testRunning: false })
    }
  },
  clearTestResult: () => set({ testResult: null }),

  // --- Logs ---
  loadLogs: async (eventType, limit = 50) => {
    const cursor = get().logsCursorStack.at(-1)
    set({ logsLoading: true })
    try {
      const data = await hooksApi.fetchLogs({ eventType, limit, before: cursor })
      set({
        logs: data.entries || [],
        logsTotal: data.total ?? null,
        logsFilter: eventType || null,
        logsNextCursor: data.next_cursor || null,
      })
    } catch (e) {
      console.error('Failed to load hook logs:', e)
    } finally {
      set({ logsLoading: false })
    }
  },
  setLogsFilter: (eventType) => {
    set({
      logsFilter: eventType || null,
      logsCursorStack: [null],
      logsNextCursor: null,
    })
  },
  logsNext: () => {
    const { logsNextCursor, logsCursorStack } = get()
    if (!logsNextCursor) return
    set({ logsCursorStack: [...logsCursorStack, logsNextCursor] })
  },
  logsPrev: () => {
    const { logsCursorStack } = get()
    if (logsCursorStack.length <= 1) return
    set({ logsCursorStack: logsCursorStack.slice(0, -1) })
  },

  // --- Handler form ---
  openHandlerForm: (handler) => set({
    handlerFormOpen: true,
    editingHandler: handler || null,
  }),
  closeHandlerForm: () => set({
    handlerFormOpen: false,
    editingHandler: null,
  }),

  // --- Reset ---
  reset: () => set({
    selectedHookId: null,
    activeDetailTab: 'config',
    configuredHooks: {},
    configLoading: false,
    savingConfig: false,
    catalog: [],
    catalogLoading: false,
    testResult: null,
    testRunning: false,
    logs: [],
    logsTotal: null,
    logsLoading: false,
    logsFilter: null,
    logsCursorStack: [null],
    logsNextCursor: null,
    handlerFormOpen: false,
    editingHandler: null,
    _configLoaded: false,
    _catalogLoaded: false,
  }),
}))

export default useHooksStore
