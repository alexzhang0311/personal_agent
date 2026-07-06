import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import { checkSetup, getMe } from '../api/auth'
import useTaskStore from './taskStore'
import useChatStore from './chatStore'
import useSidebarStore from './sidebarStore'
import useFileOpsStore from './fileOpsStore'
import useFileBrowserStore from './fileBrowserStore'
import useSkillsStore from './skillsStore'
import useSettingsStore from './settingsStore'
import useAdminStore from './adminStore'
import useSchedulerStore from './schedulerStore'
import useUiStore from './uiStore'
import useUserDataStore from './userDataStore'
import useHooksStore from './hooksStore'
import useSkillHubStore from './skillHubStore'

const useAuthStore = create((set, get) => ({
  user: null,
  token: safeStorage.getItem('vivian-token') || null,
  needsSetup: null,
  loading: true,

  setToken: (token) => {
    if (token) {
      safeStorage.setItem('vivian-token', token)
    } else {
      safeStorage.removeItem('vivian-token')
    }
    set({ token })
  },

  setUser: (user) => set({ user }),

  logout: () => {
    safeStorage.removeItem('vivian-token')
    set({ user: null, token: null })

    // Reset all stores to clear previous user's data
    useTaskStore.getState().reset?.()
    useChatStore.getState().reset?.()
    useSidebarStore.getState().reset?.()
    useFileOpsStore.getState().reset?.()
    useFileBrowserStore.getState().reset?.()
    useSkillsStore.getState().reset?.()
    useSettingsStore.getState().reset?.()
    useAdminStore.getState().reset?.()
    useSchedulerStore.getState().reset?.()
    useUiStore.getState().reset?.()
    useUserDataStore.getState().reset?.()
    useHooksStore.getState().reset?.()
    useSkillHubStore.getState().reset?.()
  },

  initialize: async () => {
    set({ loading: true })
    try {
      // Check if setup is needed
      const setupStatus = await checkSetup()
      if (setupStatus.needs_setup) {
        set({ needsSetup: true, loading: false })
        return
      }
      set({ needsSetup: false })

      // Validate existing token
      const token = get().token
      if (token) {
        try {
          const user = await getMe(token)
          set({ user, loading: false })
          return
        } catch {
          // Token invalid, clear it
          safeStorage.removeItem('vivian-token')
          set({ token: null })
        }
      }
      set({ loading: false })
    } catch {
      set({ loading: false })
    }
  },
}))

export default useAuthStore
