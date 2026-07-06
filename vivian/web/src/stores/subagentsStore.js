import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import {
  fetchAgents,
  fetchAgent,
  fetchCatalog,
  createAgent as createAgentApi,
  updateAgent as updateAgentApi,
  deleteAgent as deleteAgentApi,
  streamAgentTest,
} from '../api/subagents'

const DEFAULT_TEST_WIDTH = 480
const STORAGE_KEY = 'subagents-test-width'

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']

const emptyDraft = () => ({
  __mode: 'create', // 'create' or 'edit'
  __originalName: null,
  name: '',
  description: '',
  prompt: '',
  tools: [...DEFAULT_ALLOWED_TOOLS],
  disallowedTools: [],
  model: '',
  permissionMode: '',
  maxTurns: null,
  skills: [],
  mcpServers: [],
  memory: '',
  background: false,
})

const detailToDraft = (detail) => ({
  __mode: 'edit',
  __originalName: detail.name,
  name: detail.name,
  description: detail.description || '',
  prompt: detail.prompt || '',
  tools: Array.isArray(detail.tools) ? [...detail.tools] : [],
  disallowedTools: Array.isArray(detail.disallowedTools) ? [...detail.disallowedTools] : [],
  model: detail.model || '',
  permissionMode: detail.permissionMode || '',
  maxTurns: detail.maxTurns ?? null,
  skills: Array.isArray(detail.skills) ? [...detail.skills] : [],
  mcpServers: Array.isArray(detail.mcpServers) ? [...detail.mcpServers] : [],
  memory: detail.memory || '',
  background: !!detail.background,
})

const draftToBody = (draft) => {
  const body = {
    name: draft.name,
    description: draft.description,
    prompt: draft.prompt,
    tools: draft.tools,
    disallowedTools: draft.disallowedTools,
    skills: draft.skills,
    mcpServers: draft.mcpServers,
  }
  if (draft.model) body.model = draft.model
  if (draft.permissionMode) body.permissionMode = draft.permissionMode
  if (draft.maxTurns != null && draft.maxTurns !== '') body.maxTurns = Number(draft.maxTurns)
  if (draft.memory) body.memory = draft.memory
  if (typeof draft.background === 'boolean') body.background = draft.background
  return body
}

const useSubagentsStore = create((set, get) => ({
  list: [],
  listLoading: false,
  selectedName: null,
  detail: null,
  detailLoading: false,
  formDraft: null,
  dirty: false,
  catalog: { tools: [], skills: [], mcp_servers: [], reserved_names: [] },
  catalogLoaded: false,

  testWidth: safeStorage.getNumber(STORAGE_KEY, DEFAULT_TEST_WIDTH, { min: 320, max: 720 }),
  testRunning: false,
  testEvents: [],
  testAbort: null,

  setTestWidth: (w) => {
    safeStorage.setItem(STORAGE_KEY, String(w))
    set({ testWidth: w })
  },

  loadList: async () => {
    set({ listLoading: true })
    try {
      const data = await fetchAgents()
      set({ list: data.agents || [] })
    } catch (e) {
      console.error('Failed to load subagents list:', e)
    } finally {
      set({ listLoading: false })
    }
  },

  loadCatalog: async () => {
    if (get().catalogLoaded) return
    try {
      const data = await fetchCatalog()
      set({ catalog: data, catalogLoaded: true })
    } catch (e) {
      console.error('Failed to load subagents catalog:', e)
    }
  },

  selectAgent: async (name) => {
    set({ selectedName: name, detailLoading: true, dirty: false })
    try {
      const detail = await fetchAgent(name)
      set({ detail, formDraft: detailToDraft(detail) })
    } catch (e) {
      console.error('Failed to load agent detail:', e)
      set({ detail: null, formDraft: null })
    } finally {
      set({ detailLoading: false })
    }
  },

  clearSelection: () =>
    set({ selectedName: null, detail: null, formDraft: null, dirty: false, testEvents: [] }),

  startNewAgent: () => {
    set({
      selectedName: null,
      detail: null,
      formDraft: { ...emptyDraft() },
      dirty: false,
    })
  },

  startFromTemplate: (template) => {
    set({
      selectedName: null,
      detail: null,
      formDraft: { ...emptyDraft(), ...template, __mode: 'create', __originalName: null },
      dirty: true,
    })
  },

  setFormField: (key, value) => {
    const draft = get().formDraft
    if (!draft) return
    const next = { ...draft, [key]: value }

    // Allowed / Disallowed are mutually exclusive — picking a tool in one
    // pops it out of the other. Skills are independent (the SDK auto-injects
    // the Skill tool when ``options.skills`` is set on the parent run).
    if (key === 'tools') {
      const allowed = Array.isArray(value) ? value : []
      next.disallowedTools = (next.disallowedTools || []).filter((t) => !allowed.includes(t))
    }

    if (key === 'disallowedTools') {
      const disallowed = Array.isArray(value) ? value : []
      next.tools = (next.tools || []).filter((t) => !disallowed.includes(t))
    }

    set({ formDraft: next, dirty: true })
  },

  discardDraft: () => {
    const { detail } = get()
    if (detail) {
      set({ formDraft: detailToDraft(detail), dirty: false })
    } else {
      set({ formDraft: null, dirty: false })
    }
  },

  saveDraft: async () => {
    const { formDraft } = get()
    if (!formDraft) return null

    const body = draftToBody(formDraft)
    let detail = null
    if (formDraft.__mode === 'create') {
      detail = await createAgentApi(body)
    } else {
      const updateBody = { ...body }
      if (formDraft.name !== formDraft.__originalName) {
        updateBody.new_name = formDraft.name
      }
      detail = await updateAgentApi(formDraft.__originalName, updateBody)
    }

    set({
      detail,
      selectedName: detail.name,
      formDraft: detailToDraft(detail),
      dirty: false,
    })
    await get().loadList()
    return detail
  },

  deleteSelected: async () => {
    const { selectedName } = get()
    if (!selectedName) return
    await deleteAgentApi(selectedName)
    set({ selectedName: null, detail: null, formDraft: null, dirty: false })
    await get().loadList()
  },

  runTest: (prompt) => {
    const { selectedName, testAbort } = get()
    if (!selectedName) return
    if (testAbort) testAbort.abort?.()

    set({ testRunning: true, testEvents: [] })
    const abort = streamAgentTest(
      selectedName,
      prompt,
      (event, data) => {
        set((s) => ({ testEvents: [...s.testEvents, { event, data, ts: Date.now() }] }))
      },
      () => {
        set({ testRunning: false, testAbort: null })
      }
    )
    set({ testAbort: abort })
  },

  stopTest: () => {
    const { testAbort } = get()
    if (testAbort) testAbort.abort?.()
    set({ testAbort: null, testRunning: false })
  },

  clearTestEvents: () => set({ testEvents: [] }),

  reset: () =>
    set({
      list: [],
      listLoading: false,
      selectedName: null,
      detail: null,
      formDraft: null,
      dirty: false,
      testRunning: false,
      testEvents: [],
      testAbort: null,
    }),
}))

export default useSubagentsStore
