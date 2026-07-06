import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import * as mcpApi from '../api/mcp'

const useMcpStore = create((set, get) => ({
  // Server list
  servers: [],
  serversLoading: true,
  searchQuery: '',
  levelFilter: 'all', // 'all' | 'project' | 'global'

  // Selected server
  selectedServer: null, // { level, name }
  serverDetail: null,
  detailLoading: false,

  // Capabilities (right panel)
  capabilities: null, // { tools, prompts, resources, server_name, server_version }
  capabilitiesLoading: false,
  capabilitiesError: null,
  activeDetailTab: 'tools', // 'tools' | 'prompts' | 'resources'

  // Selected tool (for tool drawer)
  selectedTool: null, // tool object from capabilities

  // Meta panel width (persisted)
  metaPanelWidth: safeStorage.getNumber('mcp-meta-width', 320, { min: 240, max: 480 }),

  // Tool drawer width (persisted)
  toolDrawerWidth: safeStorage.getNumber('mcp-tool-drawer-width', 360, { min: 280, max: 600 }),

  // Add/edit dialog
  addDialogOpen: false,
  addDialogLevel: 'project',
  editMode: false,
  editInitialData: null,
  validating: false,
  validateResult: null,

  // Actions
  fetchServers: async () => {
    set({ serversLoading: true })
    try {
      const data = await mcpApi.listMcpServers()
      set({ servers: data.servers, serversLoading: false })
    } catch {
      set({ serversLoading: false })
    }
  },

  selectServer: async (level, name) => {
    set({
      selectedServer: { level, name },
      detailLoading: true,
      capabilities: null,
      capabilitiesError: null,
      selectedTool: null,
    })
    try {
      const detail = await mcpApi.getMcpServerDetail(level, name)
      set({ serverDetail: detail, detailLoading: false })
      // Auto-load capabilities
      get().fetchCapabilities(level, name)
    } catch {
      set({ detailLoading: false })
    }
  },

  fetchCapabilities: async (level, name) => {
    const target = level && name ? { level, name } : get().selectedServer
    if (!target) return
    set({ capabilitiesLoading: true, capabilitiesError: null })
    try {
      const caps = await mcpApi.getMcpServerCapabilities(target.level, target.name)
      set({ capabilities: caps, capabilitiesLoading: false })
    } catch (e) {
      set({ capabilitiesLoading: false, capabilitiesError: e.message || 'Failed to load capabilities' })
    }
  },

  createServer: async (data) => {
    const result = await mcpApi.createMcpServer(data)
    get().fetchServers()
    return result
  },

  updateServer: async (level, name, data) => {
    const result = await mcpApi.updateMcpServer(level, name, data)
    const { selectedServer } = get()
    if (selectedServer?.level === level && selectedServer?.name === name) {
      set({ serverDetail: result })
    }
    get().fetchServers()
    return result
  },

  deleteServer: async (level, name) => {
    await mcpApi.deleteMcpServer(level, name)
    const { selectedServer } = get()
    if (selectedServer?.level === level && selectedServer?.name === name) {
      set({ selectedServer: null, serverDetail: null, capabilities: null })
    }
    get().fetchServers()
  },

  validateServer: async (data) => {
    set({ validating: true, validateResult: null })
    try {
      const result = await mcpApi.validateMcpServer(data)
      set({ validating: false, validateResult: result })
      return result
    } catch (e) {
      const errorResult = { success: false, error: e.message || 'Validation failed' }
      set({ validating: false, validateResult: errorResult })
      return errorResult
    }
  },

  testTool: async (toolName, toolArguments) => {
    const { serverDetail } = get()
    if (!serverDetail) return null
    try {
      const result = await mcpApi.validateMcpTool({
        type: serverDetail.type,
        url: serverDetail.url,
        headers: serverDetail.headers || [],
        timeout: serverDetail.timeout || 30,
        tool_name: toolName,
        tool_arguments: toolArguments || {},
      })
      return result
    } catch (e) {
      return { success: false, error: e.message || 'Tool test failed' }
    }
  },

  // UI state setters
  setSearchQuery: (q) => set({ searchQuery: q }),
  setLevelFilter: (f) => set({ levelFilter: f }),
  setActiveDetailTab: (t) => set({ activeDetailTab: t }),
  selectTool: (tool) => set({ selectedTool: tool }),
  closeTool: () => set({ selectedTool: null }),
  setToolDrawerWidth: (w) => {
    safeStorage.setItem('mcp-tool-drawer-width', String(w))
    set({ toolDrawerWidth: w })
  },
  setMetaPanelWidth: (w) => {
    safeStorage.setItem('mcp-meta-width', String(w))
    set({ metaPanelWidth: w })
  },

  openAddDialog: (level) => set({
    addDialogOpen: true,
    addDialogLevel: level || 'project',
    editMode: false,
    editInitialData: null,
    validateResult: null,
    validating: false,
  }),

  openEditDialog: (detail) => set({
    addDialogOpen: true,
    addDialogLevel: detail.level,
    editMode: true,
    editInitialData: detail,
    validateResult: null,
    validating: false,
  }),

  closeAddDialog: () => set({
    addDialogOpen: false,
    validateResult: null,
    validating: false,
    editMode: false,
    editInitialData: null,
  }),

  clearSelection: () => set({
    selectedServer: null,
    serverDetail: null,
    capabilities: null,
    capabilitiesError: null,
    selectedTool: null,
  }),

  reset: () => set({
    servers: [], serversLoading: true, searchQuery: '', levelFilter: 'all',
    selectedServer: null, serverDetail: null, detailLoading: false,
    capabilities: null, capabilitiesLoading: false, capabilitiesError: null,
    activeDetailTab: 'tools', selectedTool: null,
    addDialogOpen: false, validating: false, validateResult: null,
    editMode: false, editInitialData: null,
  }),
}))

export default useMcpStore
