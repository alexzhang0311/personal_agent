import { create } from 'zustand'

function fileName(filePath) {
  if (!filePath) return '(untitled)'
  const parts = filePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function buildTab(file) {
  const path = file.filePath || file.path || ''
  return {
    id: path,
    filePath: path,
    name: file.name || fileName(path),
    mimeType: file.mimeType || file.mime_type || null,
    extension: file.extension || null,
    size: typeof file.size === 'number' ? file.size : null,
    source: file.source || null,
    browserSource: file.browserSource || file.browser_source || null,
    sourceTool: file.sourceTool || file.source_tool || null,
    toolUseId: file.toolUseId || file.tool_use_id || null,
    mode: file.mode || 'preview',
    refreshKey: Date.now(),
  }
}

const useFileBrowserStore = create((set, get) => ({
  tabs: [],
  activeTabId: null,

  openFile: (file) => {
    const tab = buildTab(file || {})
    if (!tab.filePath) return

    set((s) => {
      const existing = s.tabs.find((item) => item.filePath === tab.filePath)
      if (existing) {
        return {
          activeTabId: existing.id,
          tabs: s.tabs.map((item) => (
            item.id === existing.id
              ? {
                ...item,
                ...tab,
                id: existing.id,
                source: tab.source || item.source,
                browserSource: tab.browserSource || item.browserSource,
                sourceTool: tab.sourceTool || item.sourceTool,
                toolUseId: tab.toolUseId || item.toolUseId,
                mode: item.mode || tab.mode,
                refreshKey: Date.now(),
              }
              : item
          )),
        }
      }
      return {
        activeTabId: tab.id,
        tabs: [...s.tabs, tab],
      }
    })
  },

  closeFile: (id) => {
    set((s) => {
      const index = s.tabs.findIndex((tab) => tab.id === id)
      const tabs = s.tabs.filter((tab) => tab.id !== id)
      if (s.activeTabId !== id) return { tabs }
      const nextActive = tabs[index] || tabs[index - 1] || tabs[0] || null
      return { tabs, activeTabId: nextActive?.id || null }
    })
  },

  closeAllFiles: () => set({ tabs: [], activeTabId: null }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setMode: (id, mode) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, mode } : tab)),
    })),

  refreshFile: (id) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, refreshKey: Date.now() } : tab)),
    })),

  setTabs: (tabs) => {
    const nextTabs = []
    const seen = new Set()
    for (const file of tabs || []) {
      const tab = buildTab(file)
      if (!tab.filePath || seen.has(tab.filePath)) continue
      seen.add(tab.filePath)
      nextTabs.push(tab)
    }
    set({ tabs: nextTabs, activeTabId: nextTabs[0]?.id || null })
  },

  clear: () => set({ tabs: [], activeTabId: null }),
  reset: () => set({ tabs: [], activeTabId: null }),
}))

export default useFileBrowserStore
