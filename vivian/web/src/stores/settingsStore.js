import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import {
  getUserEnv,
  updateUserEnv,
  getUserEnvStatus,
  fetchModels as fetchModelsAPI,
  getQuickActions,
  updateQuickActions as updateQuickActionsAPI,
  getVisionModel as getVisionModelAPI,
  updateVisionModel as updateVisionModelAPI,
} from '../api/settings'
import { getMyApiKey, generateMyApiKey, revokeMyApiKey } from '../api/auth'
import { getPresetPrompt, updatePresetPrompt } from '../api/admin'

const useSettingsStore = create((set, get) => ({
  env: null,
  hasEnv: null,
  models: [],
  modelsLoading: false,
  modelsError: null,
  quickActions: [],
  selectedModel: null,
  apiKey: null,
  apiKeyLoading: false,
  presetPrompt: null,
  presetPromptLoading: false,
  visionModel: null,
  transport: safeStorage.getItem('vivian-transport') || 'ws',

  fetchEnvStatus: async () => {
    try {
      const data = await getUserEnvStatus()
      set({ hasEnv: data.has_env })
      return data.has_env
    } catch {
      set({ hasEnv: false })
      return false
    }
  },

  fetchEnv: async () => {
    try {
      const data = await getUserEnv()
      set({ env: data.env, hasEnv: data.has_env })
      return data
    } catch {
      set({ env: null, hasEnv: false })
      return null
    }
  },

  saveEnv: async (envData) => {
    const data = await updateUserEnv(envData)
    set({ env: data.env, hasEnv: data.has_env })
    return data
  },

  fetchModels: async () => {
    set({ modelsLoading: true, modelsError: null })
    try {
      const data = await fetchModelsAPI()
      set({ models: data.models || [], modelsLoading: false })
      return data.models || []
    } catch (err) {
      set({ modelsLoading: false, modelsError: err.message })
      return []
    }
  },

  fetchQuickActions: async () => {
    try {
      const data = await getQuickActions()
      set({ quickActions: data.quickactions || [] })
      return data.quickactions || []
    } catch {
      set({ quickActions: [] })
      return []
    }
  },

  saveQuickActions: async (actions) => {
    const data = await updateQuickActionsAPI(actions)
    set({ quickActions: data.quickactions || [] })
    return data
  },

  fetchVisionModel: async () => {
    try {
      const data = await getVisionModelAPI()
      set({ visionModel: data.vision_model || null })
      return data.vision_model || null
    } catch {
      return null
    }
  },

  saveVisionModel: async (model) => {
    await updateVisionModelAPI(model || null)
    set({ visionModel: model || null })
  },

  setTransport: (t) => {
    safeStorage.setItem('vivian-transport', t)
    set({ transport: t })
  },

  setSelectedModel: (model) => set({ selectedModel: model }),

  fetchApiKey: async () => {
    set({ apiKeyLoading: true })
    try {
      const data = await getMyApiKey()
      set({ apiKey: data, apiKeyLoading: false })
      return data
    } catch {
      set({ apiKey: null, apiKeyLoading: false })
      return null
    }
  },

  generateApiKey: async () => {
    set({ apiKeyLoading: true })
    try {
      const data = await generateMyApiKey()
      set({ apiKey: data, apiKeyLoading: false })
      return data
    } catch {
      set({ apiKeyLoading: false })
      return null
    }
  },

  revokeApiKey: async () => {
    set({ apiKeyLoading: true })
    try {
      const data = await revokeMyApiKey()
      set({ apiKey: data, apiKeyLoading: false })
      return data
    } catch {
      set({ apiKeyLoading: false })
      return null
    }
  },

  fetchPresetPrompt: async () => {
    set({ presetPromptLoading: true })
    try {
      const data = await getPresetPrompt()
      set({ presetPrompt: data, presetPromptLoading: false })
      return data
    } catch {
      set({ presetPromptLoading: false })
      return null
    }
  },

  savePresetPrompt: async (data) => {
    const result = await updatePresetPrompt(data)
    set({ presetPrompt: result })
    return result
  },

  reset: () => set({
    env: null,
    hasEnv: null,
    models: [],
    modelsLoading: false,
    modelsError: null,
    quickActions: [],
    selectedModel: null,
    apiKey: null,
    apiKeyLoading: false,
    presetPrompt: null,
    presetPromptLoading: false,
    visionModel: null,
    transport: safeStorage.getItem('vivian-transport') || 'ws',
  }),
}))

export default useSettingsStore
