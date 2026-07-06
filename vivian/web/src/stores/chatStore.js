import { create } from 'zustand'
import { listSkills } from '../api/skills'
import safeStorage from '../utils/safeStorage'

const CKPT_STORAGE_PREFIX = 'vivian-ckpt:'
const REWIND_STORAGE_PREFIX = 'vivian-rewind:'

// Monotonic counter for `_cid` — stable React list keys for live messages.
// 'c-' prefix keeps these distinct from sessionTransform's 's-' load-path ids.
let cidCounter = 0
const withCid = (message) => (message && !message._cid ? { ...message, _cid: `c-${++cidCounter}` } : message)

const useChatStore = create((set, get) => ({
  messages: [],
  // Subagent content: parent_tool_use_id -> flat array of content blocks
  // (text, thinking, tool_use with status/result). Streamed in via useSSE,
  // hydrated in loadSession from sessionTransform.
  subagentContent: {},
  sessionId: null,
  inputText: '',
  isStreaming: false,
  isCompacting: false,
  streamAbort: null,
  pendingAskUser: null,
  streamId: null,
  pendingPermission: null,
  permissionQueue: [],
  permissionMode: 'bypassPermissions',
  mcpServers: 'auto', // 'auto' | 'disable' | ['srv-A', ...]
  pendingPlanApproval: null,
  availableSkills: [],
  skillsLoaded: false,
  skillsLoading: false,
  wsSendPermission: null,
  // Mid-stream queue of user messages awaiting injection at the next
  // tool-result boundary (backend). Each entry:
  //   { id, text, attachments, images, status: 'pending' | 'flushing' }
  queuedUserMessages: [],
  queueSender: null, // (payload) => void — active only while streaming
  attachments: [],
  quotedText: null,
  fileReference: null,
  fileReferenceTemplate: null,
  selectedXlsxReference: null,
  selectedFileReference: null,

  enableFileCheckpointing: false,
  checkpoints: [], // [{ uuid, afterMessageIndex, preview, timestamp }]
  forkParentId: null,
  rewindMarker: null, // { checkpointUuid, rewindTs, revertedToolUseIds: string[] }

  // Backend retry indicator: shown inside the assistant-message slot until
  // the next assistant event resolves it (success) or retry_exhausted
  // promotes the slot to an ErrorBlock.
  retryState: null, // { attempt, max, delaySeconds, errorCode, message, succeeded? } | null
  setRetryState: (s) => set({ retryState: s }),
  clearRetryState: () => set({ retryState: null }),
  // Flag the indicator as "reconnect successful" — kept around briefly so the
  // user sees confirmation before the banner disappears. The caller schedules
  // the eventual clear.
  markRetrySucceeded: () => set((s) => (
    s.retryState
      ? { retryState: { ...s.retryState, succeeded: true, delaySeconds: 0 } }
      : {}
  )),
  tickRetryDelay: () => set((s) => (
    s.retryState && s.retryState.delaySeconds > 0
      ? { retryState: { ...s.retryState, delaySeconds: s.retryState.delaySeconds - 1 } }
      : {}
  )),

  // Last user-sent prompt — used by ErrorBlock [Retry] to resend on demand.
  lastUserPrompt: null,
  setLastUserPrompt: (p) => set({ lastUserPrompt: p }),
  clearLastUserPrompt: () => set({ lastUserPrompt: null }),

  // Monotonic stream generation. Bumped on session load and on stop so a
  // stale stream's late events can't write into a freshly loaded session.
  // NOTE: a generation counter, not a sessionId compare — new-session streams
  // legitimately assign their sessionId mid-flight.
  streamGeneration: 0,
  bumpStreamGeneration: () => set((s) => ({ streamGeneration: s.streamGeneration + 1 })),

  quickActionVariableMode: false,
  setQuickActionVariableMode: (active) => set({ quickActionVariableMode: active }),

  setQuotedText: (text) => set({ quotedText: text }),
  clearQuotedText: () => set({ quotedText: null }),

  setFileReference: (ref) => set({ fileReference: ref }),
  clearFileReference: () => set({ fileReference: null }),
  setFileReferenceTemplate: (tpl) => set({ fileReferenceTemplate: tpl }),
  clearFileReferenceTemplate: () => set({ fileReferenceTemplate: null }),
  setSelectedXlsxReference: (ref) => set({ selectedXlsxReference: ref }),
  clearSelectedXlsxReference: () => set({ selectedXlsxReference: null }),
  setSelectedFileReference: (ref) => set({ selectedFileReference: ref }),
  clearSelectedFileReference: () => set({ selectedFileReference: null }),

  // Pending optimize request from Skills file viewer
  pendingOptimize: null,
  setPendingOptimize: (data) => set({ pendingOptimize: data }),
  clearPendingOptimize: () => set({ pendingOptimize: null }),
  setInputText: (text) => set({ inputText: text }),
  addAttachment: (attachment) => set((s) => ({
    attachments: [...s.attachments, attachment],
  })),
  updateAttachment: (id, data) => set((s) => ({
    attachments: s.attachments.map((a) => a.id === id ? { ...a, ...data } : a),
  })),
  removeAttachment: (id) => set((s) => {
    const removed = s.attachments.find((a) => a.id === id)
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    return { attachments: s.attachments.filter((a) => a.id !== id) }
  }),
  clearAttachments: ({ keepErrors = false } = {}) => set((s) => {
    const kept = keepErrors ? s.attachments.filter((a) => a.status === 'error') : []
    s.attachments.forEach((a) => {
      if (a.previewUrl && !kept.includes(a)) URL.revokeObjectURL(a.previewUrl)
    })
    return { attachments: kept }
  }),
  fetchAvailableSkills: async () => {
    if (get().skillsLoaded || get().skillsLoading) return
    set({ skillsLoading: true })
    try {
      const data = await listSkills()
      set({ availableSkills: data.skills || [], skillsLoaded: true, skillsLoading: false })
    } catch {
      set({ skillsLoaded: true, skillsLoading: false })
    }
  },
  setCompacting: (value) => set({ isCompacting: value }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setMcpServers: (value) => set({ mcpServers: value }),
  setCheckpointingEnabled: (v) => {
    const { sessionId } = get()
    set({ enableFileCheckpointing: v })
    if (sessionId) {
      safeStorage.setItem(`${CKPT_STORAGE_PREFIX}${sessionId}`, String(v))
    }
  },
  recordCheckpoint: (uuid, afterMessageIndex, preview) => set((s) => {
    if (!uuid) return {}
    if (s.checkpoints.some((c) => c.uuid === uuid)) return {}
    return {
      checkpoints: [...s.checkpoints, { uuid, afterMessageIndex, preview, timestamp: Date.now() }],
    }
  }),
  findCheckpointForAssistant: (assistantIdx) => {
    const msgs = get().messages
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user' && msgs[i]?.uuid) return msgs[i].uuid
    }
    return null
  },
  truncateMessagesTo: (assistantIdx) => set((s) => ({
    messages: s.messages.slice(0, assistantIdx + 1),
  })),
  setRewindMarker: (marker) => {
    const { sessionId } = get()
    set({ rewindMarker: marker })
    if (sessionId) {
      safeStorage.setItem(`${REWIND_STORAGE_PREFIX}${sessionId}`, JSON.stringify(marker))
    }
  },
  clearRewindMarker: () => {
    const { sessionId } = get()
    set({ rewindMarker: null })
    if (sessionId) {
      safeStorage.removeItem(`${REWIND_STORAGE_PREFIX}${sessionId}`)
    }
  },
  setSessionId: (id) => set({ sessionId: id }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamAbort: (abort) => set({ streamAbort: abort }),
  setPendingAskUser: (data) => set({ pendingAskUser: data }),
  clearPendingAskUser: () => set({ pendingAskUser: null }),
  setStreamId: (id) => set({ streamId: id }),
  setPendingPermission: (data) => set({ pendingPermission: data }),
  queuePermission: (data) => set((s) => ({
    permissionQueue: [...s.permissionQueue, data],
  })),
  resolvePermission: (requestId) => set((s) => {
    const [next, ...rest] = s.permissionQueue
    return {
      pendingPermission: next || null,
      permissionQueue: rest,
    }
  }),
  clearPermissions: () => set({ pendingPermission: null, permissionQueue: [], streamId: null, wsSendPermission: null }),
  setWsSendPermission: (fn) => set({ wsSendPermission: fn }),
  setQueueSender: (fn) => set({ queueSender: fn }),
  enqueueUserMessage: (msg) => set((s) => ({
    queuedUserMessages: [...s.queuedUserMessages, { ...msg, status: 'pending' }],
  })),
  markQueuedFlushing: (id) => set((s) => ({
    queuedUserMessages: s.queuedUserMessages.map((m) => m.id === id ? { ...m, status: 'flushing' } : m),
  })),
  removeQueuedMessage: (id) => set((s) => ({
    queuedUserMessages: s.queuedUserMessages.filter((m) => m.id !== id),
  })),
  clearQueuedMessages: () => set({ queuedUserMessages: [] }),
  setPendingPlanApproval: (data) => set({ pendingPlanApproval: data }),
  clearPendingPlanApproval: () => set({ pendingPlanApproval: null }),

  addMessage: (message) => set((s) => {
    const next = { messages: [...s.messages, withCid(message)] }
    if (message?.role === 'user' && s.rewindMarker) {
      next.rewindMarker = null
      if (s.sessionId) {
        safeStorage.removeItem(`${REWIND_STORAGE_PREFIX}${s.sessionId}`)
      }
    }
    return next
  }),

  appendToLastAssistant: (text) => set((s) => {
    const msgs = [...s.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = {
        ...last,
        content: [...last.content, { type: 'text', text }],
      }
    }
    return { messages: msgs }
  }),

  updateLastAssistantContent: (content) => set((s) => {
    const msgs = [...s.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = { ...last, content }
    }
    return { messages: msgs }
  }),

  // Append blocks (text/thinking/tool_use) to a subagent's content bucket.
  appendToSubagentContent: (parentId, blocks) => set((s) => {
    if (!parentId || !blocks || blocks.length === 0) return {}
    const existing = s.subagentContent[parentId] || []
    return {
      subagentContent: { ...s.subagentContent, [parentId]: [...existing, ...blocks] },
    }
  }),

  // Update a tool_use block nested inside a subagent with its result + status.
  updateSubagentToolResult: (parentId, toolUseId, result) => set((s) => {
    if (!parentId) return {}
    const existing = s.subagentContent[parentId]
    if (!existing) return {}
    let changed = false
    const updated = existing.map((block) => {
      if (block.type === 'tool_use' && block.id === toolUseId) {
        changed = true
        const duration = block.startTime ? Date.now() - block.startTime : null
        return { ...block, result, status: result.is_error ? 'error' : 'success', duration }
      }
      return block
    })
    if (!changed) return {}
    return { subagentContent: { ...s.subagentContent, [parentId]: updated } }
  }),

  // Mark all in-progress subagent tool_use blocks as aborted.
  abortRunningSubagentTools: () => set((s) => {
    const next = {}
    let changed = false
    for (const [parentId, blocks] of Object.entries(s.subagentContent)) {
      const hasRunning = blocks.some((b) => b.type === 'tool_use' && (!b.status || b.status === 'running'))
      if (!hasRunning) { next[parentId] = blocks; continue }
      changed = true
      next[parentId] = blocks.map((b) => {
        if (b.type === 'tool_use' && (!b.status || b.status === 'running')) {
          const duration = b.startTime ? Date.now() - b.startTime : null
          return { ...b, status: 'error', result: { is_error: true, content: 'Aborted' }, duration }
        }
        return b
      })
    }
    if (!changed) return {}
    return { subagentContent: next }
  }),

  setSubagentContent: (map) => set({ subagentContent: map || {} }),

  addToolUse: (block) => set((s) => {
    const msgs = [...s.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = {
        ...last,
        content: [...last.content, { ...block, status: 'running' }],
      }
    }
    return { messages: msgs }
  }),

  updateToolResult: (toolUseId, result) => set((s) => {
    // Keep identity for untouched messages so memo(MessageBubble) holds —
    // same bail pattern as updateSubagentToolResult above.
    let msgsChanged = false
    const msgs = s.messages.map((msg) => {
      if (msg.role !== 'assistant') return msg
      const has = msg.content.some((b) => b.type === 'tool_use' && b.id === toolUseId)
      if (!has) return msg
      msgsChanged = true
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'tool_use' && block.id === toolUseId) {
            const duration = block.startTime ? Date.now() - block.startTime : null
            return { ...block, result, status: result.is_error ? 'error' : 'success', duration }
          }
          return block
        }),
      }
    })
    // Also update subagent tool_use blocks in case this result belongs to one.
    const subNext = {}
    let subChanged = false
    for (const [parentId, blocks] of Object.entries(s.subagentContent)) {
      const has = blocks.some((b) => b.type === 'tool_use' && b.id === toolUseId)
      if (!has) { subNext[parentId] = blocks; continue }
      subChanged = true
      subNext[parentId] = blocks.map((b) => {
        if (b.type === 'tool_use' && b.id === toolUseId) {
          const duration = b.startTime ? Date.now() - b.startTime : null
          return { ...b, result, status: result.is_error ? 'error' : 'success', duration }
        }
        return b
      })
    }
    if (!msgsChanged && !subChanged) return {}
    const next = {}
    if (msgsChanged) next.messages = msgs
    if (subChanged) next.subagentContent = subNext
    return next
  }),

  // Mark all in-progress tool_use blocks as error (used when stream is aborted)
  abortRunningTools: () => set((s) => {
    const msgs = s.messages.map((msg) => {
      if (msg.role !== 'assistant') return msg
      const hasRunning = msg.content.some((b) => b.type === 'tool_use' && (!b.status || b.status === 'running'))
      if (!hasRunning) return msg
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'tool_use' && (!block.status || block.status === 'running')) {
            const duration = block.startTime ? Date.now() - block.startTime : null
            return { ...block, status: 'error', result: { is_error: true, content: 'Aborted' }, duration }
          }
          return block
        }),
      }
    })
    // Also abort any running subagent tools.
    const subNext = {}
    for (const [parentId, blocks] of Object.entries(s.subagentContent)) {
      const hasRunning = blocks.some((b) => b.type === 'tool_use' && (!b.status || b.status === 'running'))
      if (!hasRunning) { subNext[parentId] = blocks; continue }
      subNext[parentId] = blocks.map((b) => {
        if (b.type === 'tool_use' && (!b.status || b.status === 'running')) {
          const duration = b.startTime ? Date.now() - b.startTime : null
          return { ...b, status: 'error', result: { is_error: true, content: 'Aborted' }, duration }
        }
        return b
      })
    }
    return { messages: msgs, subagentContent: subNext }
  }),

  setResult: (data) => set({
    sessionId: data.session_id,
    isStreaming: false,
    isCompacting: false,
    streamAbort: null,
    wsSendPermission: null,
  }),

  clearMessages: () => set({
    messages: [], subagentContent: {}, sessionId: null, streamId: null, pendingPermission: null,
    permissionQueue: [], pendingPlanApproval: null, wsSendPermission: null,
    attachments: [], quotedText: null, fileReference: null,
    fileReferenceTemplate: null, selectedXlsxReference: null, selectedFileReference: null, isCompacting: false,
    checkpoints: [], forkParentId: null, enableFileCheckpointing: false,
    rewindMarker: null, queuedUserMessages: [], retryState: null, lastUserPrompt: null,
  }),

  reset: () => set({
    messages: [], subagentContent: {}, sessionId: null, inputText: '', isStreaming: false, isCompacting: false,
    streamAbort: null, pendingAskUser: null, streamId: null,
    pendingPermission: null, permissionQueue: [], permissionMode: 'bypassPermissions',
    pendingPlanApproval: null, availableSkills: [], skillsLoaded: false, skillsLoading: false,
    wsSendPermission: null, attachments: [], quickActionVariableMode: false, mcpServers: 'auto',
    pendingOptimize: null, quotedText: null, fileReference: null, fileReferenceTemplate: null,
    selectedXlsxReference: null, selectedFileReference: null,
    enableFileCheckpointing: false, checkpoints: [], forkParentId: null,
    rewindMarker: null, queuedUserMessages: [], queueSender: null,
    retryState: null, lastUserPrompt: null,
  }),

  // For loading a session
  loadSession: (sessionId, messages, parentId = null, subagentContent = {}) => {
    const restored = safeStorage.getBoolean(`${CKPT_STORAGE_PREFIX}${sessionId}`)
    let rewindMarker = null
    const parsed = safeStorage.getJSON(`${REWIND_STORAGE_PREFIX}${sessionId}`)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.revertedToolUseIds)) {
      rewindMarker = parsed
    }
    set((s) => ({
      sessionId,
      messages,
      subagentContent: subagentContent || {},
      isStreaming: false,
      inputText: '',
      checkpoints: [],
      forkParentId: parentId,
      enableFileCheckpointing: restored,
      rewindMarker,
      streamGeneration: s.streamGeneration + 1,
    }))
    get().fetchAvailableSkills()
  },
}))

export default useChatStore
