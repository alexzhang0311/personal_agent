import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import * as hubApi from '../api/skillHub'
import useSkillsStore from './skillsStore'

const useSkillHubStore = create((set, get) => ({
  // Hub modal
  open: false,

  // Skill list
  skills: [],
  skillsLoading: true,
  searchQuery: '',

  // Detail view
  selectedSkill: null, // skill summary object
  skillDetail: null,
  detailLoading: false,

  // File viewer
  selectedFile: null,
  fileContent: null,
  fileLoading: false,
  fileTreeWidth: safeStorage.getNumber('hub-filetree-width', 240, { min: 160, max: 400 }),

  // Actions
  delivering: false,
  uploading: false,

  openHub: () => {
    set({ open: true })
    get().fetchSkills()
  },

  closeHub: () => {
    set({
      open: false,
      selectedSkill: null,
      skillDetail: null,
      selectedFile: null,
      fileContent: null,
      searchQuery: '',
    })
  },

  fetchSkills: async () => {
    set({ skillsLoading: true })
    try {
      const data = await hubApi.listHubSkills()
      set({ skills: data.skills, skillsLoading: false })
    } catch {
      set({ skillsLoading: false })
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  selectSkill: async (skill) => {
    set({
      selectedSkill: skill,
      detailLoading: true,
      selectedFile: null,
      fileContent: null,
    })
    try {
      const detail = await hubApi.getHubSkillDetail(skill.name)
      set({ skillDetail: detail, detailLoading: false })
    } catch {
      set({ detailLoading: false })
    }
  },

  backToGrid: () => {
    set({
      selectedSkill: null,
      skillDetail: null,
      selectedFile: null,
      fileContent: null,
    })
  },

  selectFile: async (path) => {
    const { selectedSkill } = get()
    if (!selectedSkill) return
    set({ selectedFile: path, fileLoading: true })
    try {
      const data = await hubApi.getHubSkillFile(selectedSkill.name, path)
      set({ fileContent: data, fileLoading: false })
    } catch {
      set({ fileLoading: false })
    }
  },

  setFileTreeWidth: (width) => {
    safeStorage.setItem('hub-filetree-width', String(width))
    set({ fileTreeWidth: width })
  },

  deliverSkill: async (name) => {
    set({ delivering: true })
    try {
      await hubApi.deliverHubSkill(name)
      set({ delivering: false })
      // Refresh hub skills to update installed status
      get().fetchSkills()
      // Also update the detail if viewing this skill
      const { skillDetail } = get()
      if (skillDetail?.name === name) {
        set({ skillDetail: { ...skillDetail, installed: true } })
      }
      // Refresh main skills list
      useSkillsStore.getState().fetchSkills()
    } catch (e) {
      set({ delivering: false })
      throw e
    }
  },

  uploadSkill: async (file) => {
    set({ uploading: true })
    try {
      await hubApi.uploadHubSkill(file)
      set({ uploading: false })
      get().fetchSkills()
    } catch (e) {
      set({ uploading: false })
      throw e
    }
  },

  deleteSkill: async (name) => {
    await hubApi.deleteHubSkill(name)
    const { selectedSkill } = get()
    if (selectedSkill?.name === name) {
      set({ selectedSkill: null, skillDetail: null, selectedFile: null, fileContent: null })
    }
    get().fetchSkills()
  },

  reset: () => set({
    open: false,
    skills: [],
    skillsLoading: true,
    searchQuery: '',
    selectedSkill: null,
    skillDetail: null,
    detailLoading: false,
    selectedFile: null,
    fileContent: null,
    fileLoading: false,
    delivering: false,
    uploading: false,
  }),
}))

export default useSkillHubStore
