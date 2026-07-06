import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import * as skillsApi from '../api/skills'

const useSkillsStore = create((set, get) => ({
  // Skill list
  skills: [],
  skillsLoading: true,
  searchQuery: '',
  levelFilter: 'all', // 'all' | 'project' | 'global'

  // Skill denylist: names excluded from agent runs.
  skillExclude: [],
  configLoaded: false,

  // Selected skill
  selectedSkill: null, // { level, name }
  skillDetail: null,
  detailLoading: false,

  // Selected file
  selectedFile: null, // path string
  fileContent: null,
  fileLoading: false,

  // File tree width (persisted)
  fileTreeWidth: safeStorage.getNumber('skill-filetree-width', 260, { min: 180, max: 480 }),

  // View mode
  viewMode: 'preview', // 'preview' | 'source'

  // Upload
  uploading: false,

  fetchSkills: async () => {
    set({ skillsLoading: true })
    try {
      const data = await skillsApi.listSkills()
      set({ skills: data.skills, skillsLoading: false })
    } catch {
      set({ skillsLoading: false })
    }
  },

  fetchSkillsConfig: async () => {
    if (get().configLoaded) return
    try {
      const data = await skillsApi.getSkillsConfig()
      set({
        skillExclude: Array.isArray(data?.skill_exclude) ? data.skill_exclude : [],
        configLoaded: true,
      })
    } catch {
      set({ configLoaded: true })
    }
  },

  toggleSkill: async (skillName) => {
    const { skillExclude } = get()
    const prev = Array.isArray(skillExclude) ? skillExclude : []
    const isExcluded = prev.includes(skillName)
    const next = isExcluded
      ? prev.filter((n) => n !== skillName)
      : [...prev, skillName]

    // Optimistic update — and reflect on the skills list's enabled field.
    set({ skillExclude: next })
    set((state) => ({
      skills: state.skills.map((s) =>
        s.name === skillName ? { ...s, enabled: !next.includes(s.name) } : s
      ),
    }))

    try {
      await skillsApi.updateSkillsConfig(next)
    } catch {
      set({ skillExclude: prev })
      get().fetchSkills()
    }
  },

  selectSkill: async (level, name) => {
    set({
      selectedSkill: { level, name },
      detailLoading: true,
      selectedFile: null,
      fileContent: null,
    })
    try {
      const detail = await skillsApi.getSkillDetail(level, name)
      set({ skillDetail: detail, detailLoading: false })
    } catch {
      set({ detailLoading: false })
    }
  },

  selectFile: async (path) => {
    const { selectedSkill } = get()
    if (!selectedSkill) return
    set({ selectedFile: path, fileLoading: true })
    try {
      const data = await skillsApi.getSkillFile(selectedSkill.level, selectedSkill.name, path)
      set({ fileContent: data, fileLoading: false })
    } catch {
      set({ fileLoading: false })
    }
  },

  uploadSkill: async (level, file) => {
    set({ uploading: true })
    try {
      await skillsApi.uploadSkill(level, file)
      set({ uploading: false })
      // Refresh list
      get().fetchSkills()
    } catch (e) {
      set({ uploading: false })
      throw e
    }
  },

  downloadSkill: async (level, name) => {
    const blob = await skillsApi.downloadSkill(level, name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.tar.gz`
    a.click()
    URL.revokeObjectURL(url)
  },

  deleteSkill: async (level, name) => {
    await skillsApi.deleteSkill(level, name)
    const { selectedSkill } = get()
    if (selectedSkill?.level === level && selectedSkill?.name === name) {
      set({ selectedSkill: null, skillDetail: null, selectedFile: null, fileContent: null })
    }
    get().fetchSkills()
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setLevelFilter: (filter) => set({ levelFilter: filter }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setFileTreeWidth: (width) => {
    safeStorage.setItem('skill-filetree-width', String(width))
    set({ fileTreeWidth: width })
  },

  clearSelection: () => set({
    selectedSkill: null,
    skillDetail: null,
    selectedFile: null,
    fileContent: null,
  }),

  reset: () => set({
    skills: [], skillsLoading: true, searchQuery: '', levelFilter: 'all',
    selectedSkill: null, skillDetail: null, detailLoading: false,
    selectedFile: null, fileContent: null, fileLoading: false,
    viewMode: 'preview', uploading: false,
    skillExclude: [], configLoaded: false,
  }),
}))

export default useSkillsStore
