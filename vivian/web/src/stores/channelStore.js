import { create } from 'zustand'
import * as api from '../api/channels'

const useChannelStore = create((set, get) => ({
  config: null,
  configLoading: false,
  status: null,
  statusLoading: false,
  health: null,
  saving: false,
  connecting: false,
  error: null,

  fetchConfig: async () => {
    set({ configLoading: true })
    try {
      const data = await api.getWeComConfig()
      set({ config: data, configLoading: false, error: null })
    } catch (err) {
      set({ configLoading: false, error: err.message })
    }
  },

  saveConfig: async (data) => {
    set({ saving: true, error: null })
    try {
      const result = await api.updateWeComConfig(data)
      set({ config: result, saving: false })
      return result
    } catch (err) {
      set({ saving: false, error: err.message })
      throw err
    }
  },

  connect: async () => {
    set({ connecting: true, error: null })
    try {
      await api.connectWeCom()
      set({ connecting: false })
      setTimeout(() => get().fetchStatus(), 2000)
    } catch (err) {
      set({ connecting: false, error: err.message })
    }
  },

  disconnect: async () => {
    set({ connecting: true, error: null })
    try {
      await api.disconnectWeCom()
      set({ connecting: false })
      setTimeout(() => get().fetchStatus(), 1000)
    } catch (err) {
      set({ connecting: false, error: err.message })
    }
  },

  reconnect: async () => {
    set({ connecting: true, error: null })
    try {
      await api.reconnectWeCom()
      set({ connecting: false })
      setTimeout(() => get().fetchStatus(), 3000)
    } catch (err) {
      set({ connecting: false, error: err.message })
    }
  },

  fetchStatus: async () => {
    set({ statusLoading: true })
    try {
      const data = await api.getWeComStatus()
      set({ status: data, statusLoading: false })
    } catch {
      set({ statusLoading: false })
    }
  },

  fetchHealth: async () => {
    try {
      const data = await api.getChannelsHealth()
      set({ health: data })
    } catch {
      set({ health: { healthy: false } })
    }
  },

  reset: () => set({
    config: null, configLoading: false, status: null,
    statusLoading: false, health: null,
    saving: false, connecting: false, error: null,
  }),

  // --- OpenClaw ---
  ocConfig: null,
  ocConfigLoading: false,
  ocStatus: null,
  ocStatusLoading: false,
  ocSaving: false,
  ocConnecting: false,
  ocError: null,

  fetchOcConfig: async () => {
    set({ ocConfigLoading: true })
    try {
      const data = await api.getOpenClawConfig()
      set({ ocConfig: data, ocConfigLoading: false, ocError: null })
    } catch (err) {
      set({ ocConfigLoading: false, ocError: err.message })
    }
  },

  saveOcConfig: async (data) => {
    set({ ocSaving: true, ocError: null })
    try {
      const result = await api.updateOpenClawConfig(data)
      set({ ocConfig: result, ocSaving: false })
      return result
    } catch (err) {
      set({ ocSaving: false, ocError: err.message })
      throw err
    }
  },

  connectOc: async () => {
    set({ ocConnecting: true, ocError: null })
    try {
      await api.connectOpenClaw()
      set({ ocConnecting: false })
      setTimeout(() => get().fetchOcStatus(), 2000)
    } catch (err) {
      set({ ocConnecting: false, ocError: err.message })
    }
  },

  disconnectOc: async () => {
    set({ ocConnecting: true, ocError: null })
    try {
      await api.disconnectOpenClaw()
      set({ ocConnecting: false })
      setTimeout(() => get().fetchOcStatus(), 1000)
    } catch (err) {
      set({ ocConnecting: false, ocError: err.message })
    }
  },

  reconnectOc: async () => {
    set({ ocConnecting: true, ocError: null })
    try {
      await api.reconnectOpenClaw()
      set({ ocConnecting: false })
      setTimeout(() => get().fetchOcStatus(), 3000)
    } catch (err) {
      set({ ocConnecting: false, ocError: err.message })
    }
  },

  fetchOcStatus: async () => {
    set({ ocStatusLoading: true })
    try {
      const data = await api.getOpenClawStatus()
      set({ ocStatus: data, ocStatusLoading: false })
    } catch {
      set({ ocStatusLoading: false })
    }
  },
}))

export default useChannelStore
