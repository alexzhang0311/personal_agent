import { create } from 'zustand'
import safeStorage from '../utils/safeStorage'
import { getMyApiKey } from '../api/auth'
import { downloadSkill as downloadLocalSkill, getHealthInfo } from '../api/skills'

const REMOTE_URL_KEY = 'skill-sync-remote-url'
const LOCAL_API_KEY_PLACEHOLDER = '<VIVIAN_API_KEY>'
const VIVIAN_BASE_URL_PLACEHOLDER = '<VIVIAN_BASE_URL>'

function normalizeBaseUrl(url) {
  return (url || '').trim().replace(/\/+$/, '')
}

function quoteCurl(value) {
  return `"${String(value ?? '').replace(/(["\\$`])/g, '\\$1')}"`
}

function safeArchiveName(name) {
  return String(name || 'skill').replace(/[^\w.-]+/g, '_') || 'skill'
}

function splitSkillNames(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getVivianBaseUrl(healthInfo) {
  return normalizeBaseUrl(healthInfo?.base_url) || VIVIAN_BASE_URL_PLACEHOLDER
}

function getLocalBearer(localApiKey) {
  return localApiKey || LOCAL_API_KEY_PLACEHOLDER
}

function downloadCurl(baseUrl, localApiKey, skill) {
  const output = `${safeArchiveName(skill.name)}.tar.gz`
  const endpoint = `${baseUrl}/api/resource/skills/${encodeURIComponent(skill.level)}/${encodeURIComponent(skill.name)}/download`
  return `curl -L -H ${quoteCurl(`Authorization: Bearer ${getLocalBearer(localApiKey)}`)} -o ${quoteCurl(output)} ${quoteCurl(endpoint)}`
}

function uploadCurl(baseUrl, localApiKey) {
  const endpoint = `${baseUrl}/api/resource/skills/upload`
  return [
    'curl -X POST',
    `  -H ${quoteCurl(`Authorization: Bearer ${getLocalBearer(localApiKey)}`)}`,
    '  -F "level=project"',
    '  -F "file=@/path/to/skill.tar.gz"',
    `  ${quoteCurl(endpoint)}`,
  ].join(' \\\n')
}

function buildDownloadPrompt(skills, healthInfo, localApiKey) {
  const baseUrl = getVivianBaseUrl(healthInfo)
  const selected = skills.length > 0 ? skills : [{ level: 'project', name: '<skill a>' }]
  const curls = selected.map((skill) => downloadCurl(baseUrl, localApiKey, skill)).join('\n')
  const skillList = selected.map((skill) => `- ${skill.name}`).join('\n')

  return [
    '请通过以下的http调用的方式，下载我指定的技能到当前项目的技能目录：',
    curls,
    '',
    '我需要下载的技能清单是：',
    skillList,
    '',
    '请务必在下载完成后放在对应的技能目录',
  ].join('\n')
}

function buildUploadPrompt(skillNames, healthInfo, localApiKey) {
  const baseUrl = getVivianBaseUrl(healthInfo)
  const names = skillNames.length > 0 ? skillNames : ['<skill a>', '<skill b>']
  const renderedNames = names.map((name) => `\`${name}\``).join(', ')

  return [
    '我需要将指定的技能通过以下接口上传到 Vivian 平台：',
    uploadCurl(baseUrl, localApiKey),
    '',
    `我需要下载的技能清单是：${renderedNames}`,
    '注意：上传前必须要将技能打包为 .tar.gz/.zip 文件，接口一次只能传输一个文件，如果有多个技能，需要多次调用接口上传',
  ].join('\n')
}

async function uploadToRemote(baseUrl, apiKey, level, name, blob) {
  const file = new File([blob], `${name}.tar.gz`, { type: 'application/gzip' })
  const formData = new FormData()
  formData.append('file', file)
  formData.append('level', level)
  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const res = await fetch(`${baseUrl}/api/resource/skills/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Remote ${res.status}: ${text || res.statusText}`)
  }
  return res.json().catch(() => ({}))
}

const useSkillSyncStore = create((set, get) => ({
  open: false,
  direction: 'push',
  targetMode: 'vivian',
  remoteUrl: safeStorage.getItem(REMOTE_URL_KEY) || '',
  apiKey: '',
  searchQuery: '',
  selected: {},
  statuses: {},
  syncing: false,
  hint: null,
  healthInfo: null,
  localApiKey: '',
  promptLoading: false,
  importSkillInput: '',
  importSkillNames: [],

  loadPromptContext: async () => {
    set({ promptLoading: true })
    const [healthResult, apiKeyResult] = await Promise.allSettled([
      getHealthInfo(),
      getMyApiKey(),
    ])

    const next = {
      promptLoading: false,
      healthInfo: healthResult.status === 'fulfilled' ? healthResult.value : null,
      localApiKey: apiKeyResult.status === 'fulfilled' ? (apiKeyResult.value?.api_key || '') : '',
    }

    if (healthResult.status === 'rejected') {
      next.hint = { level: 'warning', key: 'skillSync.hintContextFailed' }
    }

    set(next)
  },

  openPushSync: () => {
    set({
      open: true,
      direction: 'push',
      targetMode: 'vivian',
      searchQuery: '',
      selected: {},
      statuses: {},
      syncing: false,
      hint: null,
    })
    get().loadPromptContext()
  },

  openPullSync: () => {
    set({
      open: true,
      direction: 'pull',
      targetMode: 'other',
      searchQuery: '',
      selected: {},
      statuses: {},
      syncing: false,
      hint: null,
      importSkillInput: '',
      importSkillNames: [],
    })
    get().loadPromptContext()
  },

  openSync: () => get().openPushSync(),

  closeSync: () => set({
    open: false,
    apiKey: '',
    selected: {},
    statuses: {},
    syncing: false,
    searchQuery: '',
    hint: null,
    promptLoading: false,
    importSkillInput: '',
    importSkillNames: [],
  }),

  setRemoteUrl: (url) => {
    safeStorage.setItem(REMOTE_URL_KEY, url)
    set({ remoteUrl: url })
  },
  setApiKey: (key) => set({ apiKey: key }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setTargetMode: (mode) => set({ targetMode: mode, hint: null }),
  setImportSkillInput: (value) => set({ importSkillInput: value }),
  addImportSkill: (value) => set((s) => {
    const names = splitSkillNames(value ?? s.importSkillInput)
    if (names.length === 0) return { importSkillInput: '' }
    const seen = new Set(s.importSkillNames)
    const next = [...s.importSkillNames]
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name)
        next.push(name)
      }
    }
    return { importSkillNames: next, importSkillInput: '' }
  }),
  removeImportSkill: (name) => set((s) => ({
    importSkillNames: s.importSkillNames.filter((item) => item !== name),
  })),

  keyFor: (level, name) => `${level}::${name}`,

  toggleOne: (level, name) => set((s) => {
    const k = `${level}::${name}`
    const next = { ...s.selected }
    if (next[k]) delete next[k]
    else next[k] = { level, name }
    return { selected: next }
  }),

  selectAll: (items) => set(() => {
    const next = {}
    for (const it of items) next[`${it.level}::${it.name}`] = { level: it.level, name: it.name }
    return { selected: next }
  }),

  clearSelection: () => set({ selected: {} }),

  clearHint: () => set({ hint: null }),
  setHint: (hint) => set({ hint }),

  getDownloadPrompt: () => {
    const { selected, healthInfo, localApiKey } = get()
    return buildDownloadPrompt(Object.values(selected), healthInfo, localApiKey)
  },

  getUploadPrompt: () => {
    const { importSkillNames, healthInfo, localApiKey } = get()
    return buildUploadPrompt(importSkillNames, healthInfo, localApiKey)
  },

  runSync: async () => {
    const { remoteUrl, apiKey, selected } = get()
    const base = normalizeBaseUrl(remoteUrl)

    if (!base) {
      set({ hint: { level: 'error', key: 'skillSync.hintRemoteRequired' } })
      return
    }
    const targets = Object.values(selected)
    if (targets.length === 0) {
      set({ hint: { level: 'error', key: 'skillSync.hintSelectAtLeastOne' } })
      return
    }

    const initial = {}
    for (const t of targets) initial[`${t.level}::${t.name}`] = { state: 'pending' }
    set({ syncing: true, statuses: initial, hint: { level: 'info', key: 'skillSync.hintRunning' } })

    let ok = 0
    let failed = 0
    for (const t of targets) {
      const k = `${t.level}::${t.name}`
      set((s) => ({ statuses: { ...s.statuses, [k]: { state: 'downloading' } } }))
      try {
        const blob = await downloadLocalSkill(t.level, t.name)
        set((s) => ({ statuses: { ...s.statuses, [k]: { state: 'uploading' } } }))
        await uploadToRemote(base, apiKey, 'project', t.name, blob)
        set((s) => ({ statuses: { ...s.statuses, [k]: { state: 'done' } } }))
        ok += 1
      } catch (err) {
        set((s) => ({
          statuses: { ...s.statuses, [k]: { state: 'failed', error: err?.message || String(err) } },
        }))
        failed += 1
      }
    }

    set({
      syncing: false,
      hint: {
        level: failed === 0 ? 'success' : 'warning',
        key: 'skillSync.hintFinished',
        values: { ok, failed },
      },
    })
  },

  reset: () => set({
    open: false,
    direction: 'push',
    targetMode: 'vivian',
    apiKey: '',
    searchQuery: '',
    selected: {},
    statuses: {},
    syncing: false,
    hint: null,
    healthInfo: null,
    localApiKey: '',
    promptLoading: false,
    importSkillInput: '',
    importSkillNames: [],
  }),
}))

export default useSkillSyncStore
