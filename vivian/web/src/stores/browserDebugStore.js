import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'

const STORAGE_KEY_MODE = 'browser-debug-mode'
const EVENT_LOG_LIMIT = 50

const getStoredMode = () => {
  const v = safeStorage.getItem(STORAGE_KEY_MODE)
  return v === 'interact' ? 'interact' : 'inspect'
}

const useBrowserDebugStore = create((set, get) => ({
  htmlSource: null,
  mode: getStoredMode(),
  selected: null,
  eventLog: [],
  modalOpen: false,
  hover: null,
  reloadKey: 0,

  setHtmlSource: (source) => set({
    htmlSource: source,
    selected: null,
    eventLog: [],
    hover: null,
    reloadKey: get().reloadKey + 1,
  }),
  clearHtmlSource: () => set({
    htmlSource: null,
    selected: null,
    eventLog: [],
    hover: null,
  }),

  setMode: (mode) => {
    const next = mode === 'interact' ? 'interact' : 'inspect'
    safeStorage.setItem(STORAGE_KEY_MODE, next)
    set({ mode: next, hover: null })
  },

  setSelected: (selected) => set({ selected }),
  clearSelected: () => set({ selected: null }),

  setHover: (hover) => set({ hover }),

  appendEvent: (event) => set((s) => {
    const next = [...s.eventLog, event]
    if (next.length > EVENT_LOG_LIMIT) next.splice(0, next.length - EVENT_LOG_LIMIT)
    return { eventLog: next }
  }),
  clearEvents: () => set({ eventLog: [] }),

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  reload: () => set((s) => ({
    reloadKey: s.reloadKey + 1,
    hover: null,
  })),

  reset: () => set({
    htmlSource: null,
    selected: null,
    eventLog: [],
    modalOpen: false,
    hover: null,
    reloadKey: 0,
  }),
}))

export default useBrowserDebugStore
