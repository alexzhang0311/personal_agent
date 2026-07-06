import { create } from 'zustand'
import i18n from '../i18n'
import safeStorage from '../utils/safeStorage'

const STORAGE_KEY_CANVAS_WIDTH = 'canvas-width'
const STORAGE_KEY_TERMINAL_HEIGHT = 'terminal-height'
const STORAGE_KEY_TERMINAL_MODE = 'terminal-mode'
const STORAGE_KEY_TERMINAL_BOUNDS = 'terminal-bounds'

const TERMINAL_MIN_WIDTH = 320
const TERMINAL_MIN_HEIGHT = 160
const TERMINAL_DEFAULT_BOUNDS = { x: 120, y: 120, width: 720, height: 420 }

const getStoredCanvasWidth = () => safeStorage.getNumber(STORAGE_KEY_CANVAS_WIDTH, 380, {
  min: 280,
  max: typeof window !== 'undefined' ? window.innerWidth * 0.6 : 380,
})

const getStoredTerminalHeight = () => safeStorage.getNumber(STORAGE_KEY_TERMINAL_HEIGHT, 280, {
  min: TERMINAL_MIN_HEIGHT,
  max: typeof window !== 'undefined' ? window.innerHeight : 280,
})

const getStoredTerminalMode = () => {
  const v = safeStorage.getItem(STORAGE_KEY_TERMINAL_MODE)
  return v === 'float' || v === 'expanded' || v === 'dock' ? v : 'dock'
}

const clampBounds = (b) => {
  if (typeof window === 'undefined') return { ...TERMINAL_DEFAULT_BOUNDS, ...b }
  const vw = window.innerWidth || TERMINAL_DEFAULT_BOUNDS.width
  const vh = window.innerHeight || TERMINAL_DEFAULT_BOUNDS.height
  const width = Math.max(TERMINAL_MIN_WIDTH, Math.min(vw, Number(b.width) || TERMINAL_DEFAULT_BOUNDS.width))
  const height = Math.max(TERMINAL_MIN_HEIGHT, Math.min(vh, Number(b.height) || TERMINAL_DEFAULT_BOUNDS.height))
  const maxX = Math.max(0, vw - 80)
  const maxY = Math.max(0, vh - 80)
  const x = Math.max(0, Math.min(maxX, Number.isFinite(b.x) ? b.x : TERMINAL_DEFAULT_BOUNDS.x))
  const y = Math.max(0, Math.min(maxY, Number.isFinite(b.y) ? b.y : TERMINAL_DEFAULT_BOUNDS.y))
  return { x, y, width, height }
}

const getStoredTerminalBounds = () => {
  const parsed = safeStorage.getJSON(STORAGE_KEY_TERMINAL_BOUNDS)
  if (!parsed || typeof parsed !== 'object') return { ...TERMINAL_DEFAULT_BOUNDS }
  // If entirely off-screen, reset.
  if (typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (parsed.x > vw - 40 || parsed.y > vh - 40 || parsed.x + (parsed.width || 0) < 40 || parsed.y + (parsed.height || 0) < 40) {
      return { ...TERMINAL_DEFAULT_BOUNDS }
    }
  }
  return clampBounds({ ...TERMINAL_DEFAULT_BOUNDS, ...parsed })
}

let _canvasWidthSaveTimer = null
const _persistCanvasWidth = (value) => {
  if (_canvasWidthSaveTimer) clearTimeout(_canvasWidthSaveTimer)
  _canvasWidthSaveTimer = setTimeout(() => {
    safeStorage.setItem(STORAGE_KEY_CANVAS_WIDTH, String(value))
    _canvasWidthSaveTimer = null
  }, 200)
}

let _terminalHeightSaveTimer = null
const _persistTerminalHeight = (value) => {
  if (_terminalHeightSaveTimer) clearTimeout(_terminalHeightSaveTimer)
  _terminalHeightSaveTimer = setTimeout(() => {
    safeStorage.setItem(STORAGE_KEY_TERMINAL_HEIGHT, String(value))
    _terminalHeightSaveTimer = null
  }, 200)
}

let _terminalBoundsSaveTimer = null
const _persistTerminalBounds = (value) => {
  if (_terminalBoundsSaveTimer) clearTimeout(_terminalBoundsSaveTimer)
  _terminalBoundsSaveTimer = setTimeout(() => {
    safeStorage.setItem(STORAGE_KEY_TERMINAL_BOUNDS, JSON.stringify(value))
    _terminalBoundsSaveTimer = null
  }, 200)
}

const getStoredTheme = () => safeStorage.getItem('theme') || 'light'
const getStoredLanguage = () => safeStorage.getItem('language') || 'zh'

const useUiStore = create((set, get) => ({
  activeNavTab: 'vivian',
  canvasVisible: false,
  canvasWidth: getStoredCanvasWidth(),
  canvasMinimized: false,
  activeCanvasTab: 'tasks',
  confirmDialog: null,
  lastResult: null,
  planContent: null,
  planFilePath: null,
  theme: getStoredTheme(),
  language: getStoredLanguage(),
  settingsOpen: false,
  settingsActiveTab: 'api',
  settingsPopoverOpen: false,
  introOpen: false,
  terminalOpen: false,
  terminalMinimized: false,
  terminalHeight: getStoredTerminalHeight(),
  terminalMode: getStoredTerminalMode(),
  terminalBounds: getStoredTerminalBounds(),
  terminalConfirmAcked: false,
  terminalFeatureEnabled: false,
  terminalSessionActive: false,
  terminalActiveCount: 0,

  reset: () => set({
    activeNavTab: 'vivian', canvasVisible: false, canvasMinimized: false,
    activeCanvasTab: 'tasks', confirmDialog: null, lastResult: null,
    planContent: null, planFilePath: null,
    settingsOpen: false, settingsActiveTab: 'api', settingsPopoverOpen: false,
    introOpen: false,
    terminalOpen: false, terminalMinimized: false,
    terminalConfirmAcked: false, terminalFeatureEnabled: false,
    terminalSessionActive: false, terminalActiveCount: 0,
  }),

  openIntro: () => set({ introOpen: true }),
  closeIntro: () => set({ introOpen: false }),

  setActiveNavTab: (tab) => set({ activeNavTab: tab }),

  openSettings: (tab) => set({ settingsOpen: true, settingsActiveTab: tab || get().settingsActiveTab || 'api', settingsPopoverOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
  toggleSettingsPopover: () => set((s) => ({ settingsPopoverOpen: !s.settingsPopoverOpen })),
  closeSettingsPopover: () => set({ settingsPopoverOpen: false }),

  showCanvas: () => set({ canvasVisible: true }),
  hideCanvas: () => set({ canvasVisible: false }),
  toggleCanvas: () => set((s) => ({ canvasVisible: !s.canvasVisible })),

  setCanvasWidth: (width) => {
    set({ canvasWidth: width })
    _persistCanvasWidth(width)
  },

  setCanvasMinimized: (minimized) => set({ canvasMinimized: minimized }),
  toggleCanvasMinimized: () => set((s) => ({ canvasMinimized: !s.canvasMinimized })),

  setActiveCanvasTab: (tab) => set({ activeCanvasTab: tab }),

  showConfirmDialog: (dialog) => set({ confirmDialog: dialog }),
  hideConfirmDialog: () => set({ confirmDialog: null }),

  setLastResult: (result) => set({ lastResult: result }),

  setPlanContent: (content, filePath) => set({ planContent: content, planFilePath: filePath }),
  clearPlanContent: () => set({ planContent: null, planFilePath: null }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    safeStorage.setItem('theme', next)
    document.documentElement.dataset.theme = next
    set({ theme: next })
  },

  toggleLanguage: () => {
    const next = get().language === 'en' ? 'zh' : 'en'
    safeStorage.setItem('language', next)
    i18n.changeLanguage(next)
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
    set({ language: next })
  },

  setTerminalOpen: (open) => set({
    terminalOpen: !!open,
    terminalMinimized: open ? false : false,
  }),
  setTerminalMinimized: (v) => set({ terminalMinimized: !!v }),
  toggleTerminal: () => set((s) => {
    if (!s.terminalOpen) return { terminalOpen: true, terminalMinimized: false }
    return { terminalMinimized: !s.terminalMinimized }
  }),
  setTerminalHeight: (h) => {
    const clamped = Math.max(160, Math.min(window.innerHeight * 0.6, h))
    set({ terminalHeight: clamped })
    _persistTerminalHeight(clamped)
  },
  setTerminalMode: (mode) => {
    const next = mode === 'float' || mode === 'expanded' || mode === 'dock' ? mode : 'dock'
    safeStorage.setItem(STORAGE_KEY_TERMINAL_MODE, next)
    set((s) => ({
      terminalMode: next,
      // Minimize is dock-only; force off when switching away from dock.
      terminalMinimized: next === 'dock' ? s.terminalMinimized : false,
    }))
  },
  setTerminalBounds: (partial) => {
    set((s) => {
      const merged = clampBounds({ ...s.terminalBounds, ...partial })
      _persistTerminalBounds(merged)
      return { terminalBounds: merged }
    })
  },
  setTerminalConfirmAcked: (v) => set({ terminalConfirmAcked: !!v }),
  setTerminalFeatureEnabled: (v) => set({ terminalFeatureEnabled: !!v }),
  setTerminalSessionActive: (v) => set({ terminalSessionActive: !!v }),
  setTerminalActiveCount: (n) => set({ terminalActiveCount: Math.max(0, Number(n) || 0) }),
}))

export default useUiStore
