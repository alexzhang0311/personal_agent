import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import * as hubApi from '../api/skillHub'
import useSkillsStore from './skillsStore'

const initialReviewState = {
  hubView: 'catalog',
  pendingSubmissions: [],
  pendingLoading: false,
  selectedSubmission: null,
  submissionDetail: null,
  submissionLoading: false,
  reviewFile: null,
  reviewFileContent: null,
  reviewFileLoading: false,
  reviewing: false,
}

const useSkillHubStore = create((set, get) => ({
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
  fileTreeWidth: safeStorage.getNumber('hub-filetree-width', 240, { min: 160, max: 400 }),
  delivering: false,
  uploading: false,
  publishingSkill: null,
  ...initialReviewState,

  openHub: () => {
    set({ open: true })
    get().fetchSkills()
  },

  closeHub: () => set({
    open: false,
    selectedSkill: null,
    skillDetail: null,
    selectedFile: null,
    fileContent: null,
    searchQuery: '',
    ...initialReviewState,
  }),

  setHubView: (hubView) => set({
    hubView,
    selectedSkill: null,
    skillDetail: null,
    selectedFile: null,
    fileContent: null,
  }),

  fetchSkills: async () => {
    set({ skillsLoading: true })
    try {
      const data = await hubApi.listHubSkills()
      set({ skills: data.skills, skillsLoading: false })
    } catch {
      set({ skillsLoading: false })
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  selectSkill: async (skill) => {
    set({ selectedSkill: skill, detailLoading: true, selectedFile: null, fileContent: null })
    try {
      const detail = await hubApi.getHubSkillDetail(skill.name)
      set({ skillDetail: detail, detailLoading: false })
    } catch {
      set({ detailLoading: false })
    }
  },

  backToGrid: () => set({
    selectedSkill: null,
    skillDetail: null,
    selectedFile: null,
    fileContent: null,
  }),

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
      get().fetchSkills()
      const { skillDetail } = get()
      if (skillDetail?.name === name) {
        set({ skillDetail: { ...skillDetail, installed: true } })
      }
      useSkillsStore.getState().fetchSkills()
    } catch (e) {
      set({ delivering: false })
      throw e
    }
  },

  submitSkill: async (name) => {
    set({ publishingSkill: name })
    try {
      await hubApi.submitHubSkill(name)
      set({ publishingSkill: null })
      await useSkillsStore.getState().fetchSkills()
    } catch (e) {
      set({ publishingSkill: null })
      throw e
    }
  },

  fetchPendingSubmissions: async () => {
    set({ pendingLoading: true })
    try {
      const data = await hubApi.listPendingSubmissions()
      set({ pendingSubmissions: data.submissions || [], pendingLoading: false })
    } catch (e) {
      set({ pendingLoading: false })
      throw e
    }
  },

  selectSubmission: async (submission) => {
    set({
      selectedSubmission: submission,
      submissionDetail: null,
      submissionLoading: true,
      reviewFile: null,
      reviewFileContent: null,
    })
    try {
      const detail = await hubApi.getSubmissionDetail(submission.id)
      set({ submissionDetail: detail, submissionLoading: false })
    } catch (e) {
      set({ submissionLoading: false })
      throw e
    }
  },

  selectReviewFile: async (path) => {
    const submission = get().selectedSubmission
    if (!submission) return
    set({ reviewFile: path, reviewFileLoading: true, reviewFileContent: null })
    try {
      const data = await hubApi.getSubmissionFile(submission.id, path)
      set({ reviewFileContent: data, reviewFileLoading: false })
    } catch (e) {
      set({ reviewFileLoading: false })
      throw e
    }
  },

  approveSubmission: async (id) => {
    set({ reviewing: true })
    try {
      await hubApi.approveSubmission(id)
      set({
        reviewing: false,
        selectedSubmission: null,
        submissionDetail: null,
        reviewFile: null,
        reviewFileContent: null,
      })
      await Promise.all([get().fetchPendingSubmissions(), get().fetchSkills()])
    } catch (e) {
      set({ reviewing: false })
      throw e
    }
  },

  rejectSubmission: async (id, reason) => {
    set({ reviewing: true })
    try {
      await hubApi.rejectSubmission(id, reason)
      set({
        reviewing: false,
        selectedSubmission: null,
        submissionDetail: null,
        reviewFile: null,
        reviewFileContent: null,
      })
      await Promise.all([get().fetchPendingSubmissions(), useSkillsStore.getState().fetchSkills()])
    } catch (e) {
      set({ reviewing: false })
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
    publishingSkill: null,
    ...initialReviewState,
  }),
}))

export default useSkillHubStore
