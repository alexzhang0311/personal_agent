import { useCallback } from 'react'
import { streamAgentRun, streamAgentRunWS, respondPermission as respondPermissionAPI } from '../api/sse'
import useChatStore from '../stores/chatStore'
import useTaskStore from '../stores/taskStore'
import useUiStore from '../stores/uiStore'
import useSidebarStore from '../stores/sidebarStore'
import useFileOpsStore from '../stores/fileOpsStore'
import useFileBrowserStore from '../stores/fileBrowserStore'
import useSettingsStore from '../stores/settingsStore'
import useToastStore from '../stores/toastStore'
import i18n from '../i18n'
import {
  GENERATED_TOOL_LABEL,
  buildGeneratedFileOpId,
  getGeneratedInputPaths,
  isGeneratedToolName,
} from '../utils/generatedTool'
import {
  FILE_SOURCE_CURRENT,
  fileNameFromPath,
  fileTabFromToolUse,
  fileTabsFromGeneratedFiles,
} from '../utils/fileArtifacts'

// Max characters of background-shell output kept in the task store; only the
// tail is retained beyond this.
const MAX_LIVE_OUTPUT = 200_000

// Module-level so session switches can kill the active stream without a
// hook instance (e.g. from Sidebar before loading another session).
export function stopActiveStream() {
  const { streamAbort, setStreaming, setStreamAbort, setWsSendPermission, clearPermissions, abortRunningTools, bumpStreamGeneration } = useChatStore.getState()
  // Invalidate in-flight onEvent/onComplete callbacks even when the abort
  // handle is already gone.
  bumpStreamGeneration()
  if (streamAbort) {
    streamAbort()
    abortRunningTools()
    useTaskStore.getState().abortRunningTasks()
    setStreaming(false)
    setStreamAbort(null)
    setWsSendPermission(null)
    clearPermissions()
  }
}

export function useSSE() {
  const sendMessage = useCallback((message, permissionMode, attachments, attachmentsMeta, images) => {
    const tabId = window.__VIVIAN_TAB_ID || (window.__VIVIAN_TAB_ID = Math.random().toString(36).slice(2, 8))
    const { sessionId, setStreaming, setStreamAbort, setWsSendPermission, addMessage, addToolUse, updateToolResult, setStreamId, setPendingPermission, queuePermission, clearPermissions, setCompacting, setSessionId, enableFileCheckpointing, recordCheckpoint, setRetryState, clearRetryState, setLastUserPrompt } = useChatStore.getState()
    setLastUserPrompt({ message, permissionMode, attachments, attachmentsMeta, images })
    clearRetryState()
    const promptPreview = String(message).replace(/\s+/g, ' ').slice(0, 120)
    console.info('[TAB:%s] sendMessage sessionId=%s prompt=%s', tabId, sessionId, promptPreview)
    const { addTask, updateTask, setTodos, setTodoWriteInfo } = useTaskStore.getState()
    const { showCanvas, setLastResult, setActiveCanvasTab } = useUiStore.getState()
    const { activeSessionId, updateSession } = useSidebarStore.getState()
    const { addFileOp, updateFileOp, incrementRound } = useFileOpsStore.getState()
    const { openFile: openFileBrowserTab } = useFileBrowserStore.getState()

    // Add user message (with attachment info for display)
    const userMsg = {
      role: 'user',
      content: [],
      timestamp: Date.now(),
    }
    // Add image content blocks for display
    if (images && images.length > 0) {
      for (const img of images) {
        userMsg.content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type, data: img.data },
          filename: img.filename,
        })
      }
    }
    userMsg.content.push({ type: 'text', text: message })
    if (attachmentsMeta && attachmentsMeta.length > 0) {
      userMsg.attachments = attachmentsMeta
    }
    addMessage(userMsg)

    // Create assistant message placeholder
    const streamStartTime = Date.now()
    addMessage({
      role: 'assistant',
      content: [],
      timestamp: streamStartTime,
    })

    setStreaming(true)

    // Capture the generation this stream belongs to; loadSession/stop bump it.
    const streamGen = useChatStore.getState().streamGeneration

    // Track tool_use_ids that are canvas-only (hidden from message flow)
    const hiddenToolIds = new Set()
    const generatedToolIds = new Set()
    // Track TodoWrite tool_use_ids for todo extraction
    const todoWriteIds = new Set()
    // Buffer hook_event payloads keyed by tool_use_id when they arrive before
    // the matching tool_use block is rendered. Flushed on tool_use arrival.
    const pendingHookEvents = new Map()

    const selectedModel = useSettingsStore.getState().selectedModel

    const transport = useSettingsStore.getState().transport

    const openToolFileInBrowser = (block, options = {}) => {
      const tab = fileTabFromToolUse(block, FILE_SOURCE_CURRENT)
      if (!tab) return false
      openFileBrowserTab(tab)
      showCanvas()
      if (options.activate) setActiveCanvasTab('file-browser')
      return true
    }

    const onEvent = (event, data) => {
      const state = useChatStore.getState()
      // Stale stream (session switched / stopped since this stream began):
      // drop the event so it can't overwrite the freshly loaded session.
      if (state.streamGeneration !== streamGen) return
      const msgs = [...state.messages]
      const lastIdx = msgs.length - 1
      const lastMsg = msgs[lastIdx]

      console.debug('[SSE]', event, data)

      // Merge a hook_event payload into the tool_use block whose id matches
      // `toolUseId`. Returns true when the merge happened. The hookEvents
      // array is keyed by event uuid so a hook_started/hook_response pair
      // collapses into a single pill.
      function mergeHookEventIntoBlock(toolUseId, hookEvent) {
        if (!toolUseId) return false
        const messages = useChatStore.getState().messages
        for (let mi = messages.length - 1; mi >= 0; mi--) {
          const msg = messages[mi]
          if (!Array.isArray(msg.content)) continue
          let changed = false
          const newContent = msg.content.map((b) => {
            if (b?.type !== 'tool_use' || b.id !== toolUseId) return b
            const prevEvents = b.metadata?.hookEvents || []
            const evtKey = hookEvent.uuid || `${hookEvent.hook_event_name}-${hookEvent.subtype}-${prevEvents.length}`
            const filtered = prevEvents.filter((e) => (e.uuid || '') !== (hookEvent.uuid || '___none'))
            const nextEvents = [...filtered, { ...hookEvent, _key: evtKey }]
            changed = true
            return { ...b, metadata: { ...(b.metadata || {}), hookEvents: nextEvents } }
          })
          if (changed) {
            const updated = [...messages]
            updated[mi] = { ...msg, content: newContent }
            useChatStore.setState({ messages: updated })
            return true
          }
        }
        return false
      }

      // Extract todos from TodoWrite result content or tool_use_result
      function extractTodos(resultBlock, toolUseResult) {
        // Try tool_use_result dict first
        if (toolUseResult) {
          const items = toolUseResult.newTodos || toolUseResult.todos || toolUseResult.new_todos
          if (Array.isArray(items)) return items
        }
        // Try parsing result content as JSON
        if (typeof resultBlock.content === 'string' && resultBlock.content.trim()) {
          try {
            const parsed = JSON.parse(resultBlock.content)
            if (Array.isArray(parsed)) return parsed
            const items = parsed.newTodos || parsed.todos || parsed.new_todos
            if (Array.isArray(items)) return items
          } catch { /* not JSON */ }
        }
        return null
      }

      switch (event) {
        case 'stream_init': {
          console.info('[TAB:%s] stream_init streamId=%s', tabId, data.stream_id)
          if (data.stream_id) {
            setStreamId(data.stream_id)
          }
          break
        }

        case 'user_message': {
          // Raw user frame (checkpoint carrier). Record UUID + attach to
          // the most recent user chat message so inline rewind/fork have
          // a target UUID. Deduped in-store by uuid.
          if (!data.uuid) break
          const currentMsgs = useChatStore.getState().messages
          // Find last user message without a uuid yet and attach this UUID.
          for (let i = currentMsgs.length - 1; i >= 0; i--) {
            const m = currentMsgs[i]
            if (m.role === 'user' && !m.uuid) {
              const updated = [...currentMsgs]
              updated[i] = { ...m, uuid: data.uuid }
              useChatStore.setState({ messages: updated })
              break
            }
            if (m.role === 'user' && m.uuid === data.uuid) break
          }
          const previewRaw = Array.isArray(data.content)
            ? data.content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ')
            : (typeof data.content === 'string' ? data.content : '')
          const preview = (previewRaw || '').trim().slice(0, 80)
          recordCheckpoint(data.uuid, currentMsgs.length, preview)
          break
        }

        case 'permission_request': {
          console.info('[TAB:%s] RECEIVED permission_request request_id=%s tool=%s session_id=%s prompt=%s',
            tabId, data.request_id, data.tool_name, data.session_id, promptPreview)
          // ExitPlanMode → show plan approval card
          if (data.tool_name === 'ExitPlanMode') {
            const planContent = data.input?.plan || data.input?.content || ''
            const { planFilePath } = useUiStore.getState()
            useChatStore.getState().setPendingPlanApproval({
              requestId: data.request_id,
              planContent,
              planFilePath,
            })
            // Also update plan content in canvas if not already set
            const { setPlanContent: setPlan, showCanvas: showCanvasUI, setActiveCanvasTab: setCanvasTab } = useUiStore.getState()
            if (planContent) {
              setPlan(planContent, planFilePath)
            }
            showCanvasUI()
            setCanvasTab('plan')
            break
          }
          // AskUserQuestion via can_use_tool → route to existing ask_user flow
          if (data.tool_name === 'AskUserQuestion' && data.input?.questions) {
            const askBlock = {
              toolUseId: data.request_id,
              questions: data.input.questions,
              _permissionRequestId: data.request_id,
            }
            useChatStore.getState().setPendingAskUser(askBlock)
            // Also add ask_user block to message content
            if (lastMsg && lastMsg.role === 'assistant') {
              const newContent = [...lastMsg.content, {
                type: 'ask_user',
                id: data.request_id,
                toolUseId: data.request_id,
                questions: data.input.questions,
                status: 'pending',
              }]
              useChatStore.setState({
                messages: [...msgs.slice(0, lastIdx), { ...lastMsg, content: newContent }],
              })
            }
            break
          }
          const { pendingPermission } = useChatStore.getState()
          if (pendingPermission) {
            queuePermission(data)
          } else {
            setPendingPermission(data)
          }
          break
        }

        case 'assistant': {
          // Real assistant content arrived — flash "reconnect successful" if a
          // retry was pending, then clear after a beat. Use the store snapshot
          // captured right before mutation so a fresh retry started during the
          // 1.5s window doesn't get prematurely wiped.
          const priorRetry = useChatStore.getState().retryState
          if (priorRetry && !priorRetry.succeeded) {
            useChatStore.getState().markRetrySucceeded()
            setTimeout(() => {
              const current = useChatStore.getState().retryState
              if (current?.succeeded) useChatStore.getState().clearRetryState()
            }, 1500)
          }
          // Increment round counter for file ops grouping
          incrementRound()
          if (!data.content) break
          const assistantBlocks = data.content.filter((b) => (
            b.type === 'thinking' || b.type === 'text'
          ))

          // Subagent assistant frame: route content to the subagent's bucket
          // keyed by parent_tool_use_id instead of the main thread.
          if (data.parent_tool_use_id) {
            if (assistantBlocks.length > 0) {
              useChatStore.getState().appendToSubagentContent(data.parent_tool_use_id, assistantBlocks)
            }
            break
          }

          if (lastMsg && lastMsg.role === 'assistant') {
            const newContent = [...lastMsg.content, ...assistantBlocks]
            useChatStore.setState({
              messages: [
                ...msgs.slice(0, lastIdx),
                { ...lastMsg, content: newContent },
              ],
            })
          }
          break
        }

        case 'tool_use': {
          if (!data.content) break
          const toolBlocks = data.content
            .filter((b) => b.type === 'tool_use')
            .map((b) => {
              const buffered = pendingHookEvents.get(b.id)
              const base = { ...b, status: 'running', startTime: Date.now() }
              if (buffered && buffered.length) {
                base.metadata = { ...(base.metadata || {}), hookEvents: buffered }
                pendingHookEvents.delete(b.id)
              }
              return base
            })

          for (const block of toolBlocks) {
            if (isGeneratedToolName(block.name)) generatedToolIds.add(block.id)
            openToolFileInBrowser(block, {
              activate: block.name === 'Read' || Boolean(data.parent_tool_use_id),
            })
          }

          // Subagent tool_use frame: route tool_use blocks into the subagent's
          // bucket so they render nested inside their SubagentFrame.
          if (data.parent_tool_use_id) {
            if (toolBlocks.length > 0) {
              useChatStore.getState().appendToSubagentContent(data.parent_tool_use_id, toolBlocks)
            }
            break
          }

          if (lastMsg && lastMsg.role === 'assistant') {
            const TASK_TOOLS = [
              'TaskOutput', 'TaskStop',
              // OpenClaw delegations — render as live canvas tasks, not inline cards
              'delegate_to_openclaw',
              'mcp__vivian_openclaw__delegate_to_openclaw',
            ]
            const messageBlocks = []

            for (const block of toolBlocks) {
              // AskUserQuestion → interactive card in chat (not a regular tool card)
              if (block.name === 'AskUserQuestion' && block.input?.questions) {
                hiddenToolIds.add(block.id)
                const askBlock = {
                  type: 'ask_user',
                  id: block.id,
                  toolUseId: block.id,
                  questions: block.input.questions,
                  status: 'pending',
                }
                messageBlocks.push(askBlock)
                useChatStore.getState().setPendingAskUser({
                  toolUseId: block.id,
                  questions: block.input.questions,
                })
                continue
              }

              // BashOutput → hidden, output appends to parent background Bash task
              if (block.name === 'BashOutput' || block.name === 'TaskOutput') {
                hiddenToolIds.add(block.id)
                if (block.name === 'BashOutput' && block.input?.bash_id) {
                  const tasks = useTaskStore.getState().tasks
                  const parentId = Object.keys(tasks).find(
                    (k) => tasks[k].shellId === block.input.bash_id
                  )
                  if (parentId) {
                    updateTask(parentId, { lastBashOutputId: block.id })
                  }
                }
                continue
              }

              // KillBash → hidden, marks parent task as killed
              if (block.name === 'KillBash') {
                hiddenToolIds.add(block.id)
                continue
              }

              // TodoWrite → render inline via TodoWriteCard AND mirror in Canvas.
              if (block.name === 'TodoWrite') {
                todoWriteIds.add(block.id)
                setTodoWriteInfo({
                  tool_use_id: block.id,
                  name: block.name,
                  input: block.input,
                  status: 'running',
                  startTime: Date.now(),
                })
                messageBlocks.push(block)
                continue
              }

              // Plan file Write → route to PLAN canvas tab instead of FILES
              if (block.name === 'Write' && block.input?.file_path &&
                  block.input.file_path.endsWith('.md') &&
                  block.input.file_path.includes('/plans/')) {
                hiddenToolIds.add(block.id)
                const { setPlanContent, showCanvas: showCanvasUI, setActiveCanvasTab: setCanvasTab } = useUiStore.getState()
                setPlanContent(block.input.content, block.input.file_path)
                showCanvasUI()
                setCanvasTab('plan')
                continue
              }

              // ExitPlanMode → hidden, handled via permission_request
              if (block.name === 'ExitPlanMode') {
                hiddenToolIds.add(block.id)
                continue
              }

              // File operation tools → FILES panel (hidden from messages)
              const FILE_OP_TOOLS = ['Write', 'Edit']
              if (FILE_OP_TOOLS.includes(block.name)) {
                hiddenToolIds.add(block.id)
                addFileOp({
                  id: block.id,
                  type: block.name.toLowerCase(),
                  filePath: block.input?.file_path || '',
                  status: 'running',
                  startTime: Date.now(),
                  input: block.input,
                  content: null,
                  originalFile: null,
                  structuredPatch: null,
                  toolUseResult: null,
                })
                showCanvas()
                setActiveCanvasTab('changes')
                // Emit a per-file clickable indicator in the message flow.
                // Clicking selects this specific fileOp in the canvas.
                messageBlocks.push({
                  type: 'file_ref',
                  id: `file-ref-${block.id}`,
                  fileOpId: block.id,
                  name: block.name,
                  filePath: block.input?.file_path || '',
                })
                continue
              }

              // Generated file registration → FILES panel (hidden from messages)
              if (isGeneratedToolName(block.name)) {
                hiddenToolIds.add(block.id)
                generatedToolIds.add(block.id)
                const generatedPaths = getGeneratedInputPaths(block.input)

                generatedPaths.forEach((filePath, index) => {
                  const generatedOpId = buildGeneratedFileOpId(block.id, index)
                  messageBlocks.push({
                    type: 'file_ref',
                    id: `file-ref-${generatedOpId}`,
                    name: GENERATED_TOOL_LABEL,
                    filePath,
                  })
                  // Auto-open in File Browser at tool_use time. The matching
                  // tool_result event later re-opens with mime/size/extension
                  // — fileBrowserStore.openFile merges into the same tab.
                  openFileBrowserTab({
                    filePath,
                    name: fileNameFromPath(filePath),
                    source: GENERATED_TOOL_LABEL,
                    browserSource: FILE_SOURCE_CURRENT,
                    sourceTool: GENERATED_TOOL_LABEL,
                    toolUseId: block.id,
                  })
                })

                showCanvas()
                setActiveCanvasTab('file-browser')
                continue
              }

              // Background Bash / TaskOutput / TaskStop / OpenClaw delegations
              // still get mirrored into the (now-hidden) taskStore for live
              // shell-output tracking, but we ALSO render them inline as
              // regular tool cards (or SubagentFrame for Agent/Task).
              const isBackgroundBash = block.input?.run_in_background === true
              const isShellTracked = isBackgroundBash || TASK_TOOLS.includes(block.name)

              if (isShellTracked) {
                const isOpenClawDelegation =
                  block.name === 'delegate_to_openclaw' ||
                  block.name === 'mcp__vivian_openclaw__delegate_to_openclaw'
                const description =
                  isOpenClawDelegation
                    ? `OpenClaw → ${block.input?.agent_id || 'default'}: ${block.input?.task || ''}`
                    : block.input?.description || block.input?.command || block.name
                addTask({
                  tool_use_id: block.id,
                  name: block.name,
                  input: block.input,
                  status: 'running',
                  startTime: Date.now(),
                  description,
                })
              }

              // All tools (including Agent/Task/TodoWrite/Bash) render inline.
              messageBlocks.push(block)
            }

            // Add blocks to message content
            if (messageBlocks.length > 0) {
              const newContent = [...lastMsg.content, ...messageBlocks]
              useChatStore.setState({
                messages: [
                  ...msgs.slice(0, lastIdx),
                  { ...lastMsg, content: newContent },
                ],
              })
            }
          }
          break
        }

        case 'tool_result': {
          // Handle compact tool_result events (summary + completion marker)
          // During compacting, tool_results with no tool_use_id / parent_tool_use_id=null carry summary or completion
          if (useChatStore.getState().isCompacting) {
            console.debug('[SSE][compact] tool_result during compacting:', JSON.stringify(data).slice(0, 500))
            // Extract text content from the event — could be on data directly or inside data.content blocks
            let compactText = null
            if (typeof data.content === 'string') {
              compactText = data.content
            } else if (Array.isArray(data.content)) {
              for (const rb of data.content) {
                if (rb && typeof rb.content === 'string' && (!rb.tool_use_id)) {
                  compactText = rb.content
                  break
                }
              }
            }
            // Also check top-level: compact tool_results have parent_tool_use_id === null or absent tool_use_id
            const isCompactResult = data.parent_tool_use_id === null || data.parent_tool_use_id === undefined
            const hasNoToolId = !data.tool_use_id && (!Array.isArray(data.content) || !data.content.some((rb) => rb && rb.tool_use_id))

            if (compactText && (isCompactResult || hasNoToolId)) {
              if (compactText.includes('<local-command-stdout>')) {
                // Completion marker — end compacting
                setCompacting(false)
                break
              } else {
                // Summary text — attach to the compact system message
                const currentMsgs = useChatStore.getState().messages
                const compactIdx = [...currentMsgs].reverse().findIndex(
                  (m) => m.role === 'system' && m.type === 'compact'
                )
                if (compactIdx >= 0) {
                  const realIdx = currentMsgs.length - 1 - compactIdx
                  const updated = [...currentMsgs]
                  updated[realIdx] = { ...updated[realIdx], summary: compactText }
                  useChatStore.setState({ messages: updated })
                }
                break
              }
            }
          }

          const currentTasks = useTaskStore.getState().tasks
          const allResultBlocks = []

          // Collect tool_result blocks from data.content
          if (data.content) {
            const blocks = Array.isArray(data.content) ? data.content : [data.content]
            for (const rb of blocks) {
              if (rb && rb.type === 'tool_result' && rb.tool_use_id) {
                allResultBlocks.push(rb)
              }
            }
          }

          // Process all result blocks
          for (const rb of allResultBlocks) {
            // Update message flow only for visible tools
            if (!hiddenToolIds.has(rb.tool_use_id)) {
              updateToolResult(rb.tool_use_id, rb)
            }

            // Complete canvas task if tracked
            if (currentTasks[rb.tool_use_id]) {
              const taskEntry = currentTasks[rb.tool_use_id]
              const updateData = {
                status: rb.is_error ? 'error' : 'success',
                endTime: Date.now(),
                result: rb,
                toolUseResult: data.tool_use_result,
              }
              // Background Bash: extract shellId from result
              if (taskEntry.name === 'Bash' && taskEntry.input?.run_in_background) {
                const tur = data.tool_use_result || {}
                if (tur.shellId || tur.shell_id) {
                  updateData.shellId = tur.shellId || tur.shell_id
                  updateData.shellStatus = 'running'
                  updateData.liveOutput = ''
                  // Override status back to running since bg bash continues
                  updateData.status = 'running'
                  delete updateData.endTime
                }
              }
              updateTask(rb.tool_use_id, updateData)
            }

            // BashOutput result → append output to parent task
            {
              const tur = data.tool_use_result || {}
              const bashId = tur.bash_id || tur.bashId
              if (bashId) {
                const tasks = useTaskStore.getState().tasks
                const parentId = Object.keys(tasks).find(
                  (k) => tasks[k].shellId === bashId
                )
                if (parentId) {
                  const prevOutput = tasks[parentId].liveOutput || ''
                  const newOutput = typeof rb.content === 'string' ? rb.content : ''
                  const shellStatus = tur.status || tur.shellStatus || 'running'
                  // Cap retained shell output — long-running background
                  // commands can otherwise grow this string unboundedly.
                  let liveOutput = prevOutput + newOutput
                  if (liveOutput.length > MAX_LIVE_OUTPUT) {
                    liveOutput = '…[truncated]\n' + liveOutput.slice(liveOutput.length - MAX_LIVE_OUTPUT)
                  }
                  updateTask(parentId, {
                    liveOutput,
                    shellStatus: shellStatus === 'completed' || shellStatus === 'done' ? 'completed' : shellStatus === 'failed' ? 'failed' : 'running',
                  })
                  // If shell completed, mark parent task done
                  if (shellStatus === 'completed' || shellStatus === 'done') {
                    updateTask(parentId, { status: 'success', endTime: Date.now() })
                  }
                }
              }
            }

            // KillBash result → mark parent task as killed
            {
              const tur = data.tool_use_result || {}
              const shellId = tur.shell_id || tur.shellId
              if (shellId) {
                const tasks = useTaskStore.getState().tasks
                const parentId = Object.keys(tasks).find(
                  (k) => tasks[k].shellId === shellId
                )
                if (parentId) {
                  updateTask(parentId, {
                    shellStatus: 'killed',
                    status: 'error',
                    endTime: Date.now(),
                  })
                }
              }
            }

            // Complete file operation if tracked
            const currentFileOps = useFileOpsStore.getState().fileOps
            const matchingFileOps = currentFileOps.filter((op) =>
              op.id === rb.tool_use_id ||
              (op.type === 'generated' && op.toolUseId === rb.tool_use_id)
            )
            if (matchingFileOps.length > 0) {
              const tur = data.tool_use_result || {}

              for (const op of matchingFileOps) {
                useFileOpsStore.getState().updateFileOp(op.id, {
                  status: rb.is_error ? 'error' : 'success',
                  endTime: Date.now(),
                  content: tur.content || tur.new_content || null,
                  originalFile: tur.original_file || tur.originalFile || null,
                  structuredPatch: tur.structured_patch || tur.structuredPatch || null,
                  resultContent: typeof rb.content === 'string' ? rb.content : null,
                  toolUseResult: tur,
                })
              }

              const generatedFileOps = matchingFileOps
                .filter((op) => op.type === 'generated')
                .sort((a, b) => (a.sourceIndex || 0) - (b.sourceIndex || 0))
              const generatedFiles = Array.isArray(tur.files) ? tur.files : []

              generatedFileOps.forEach((op, index) => {
                const file = generatedFiles[index]
                if (!file) return
                useFileOpsStore.getState().updateFileOp(op.id, {
                  filePath: file.path || op.filePath,
                  relativePath: file.relative_path || null,
                  mimeType: file.mime_type || null,
                  size: typeof file.size === 'number' ? file.size : null,
                  extension: file.extension || null,
                })
              })
            }

            if (generatedToolIds.has(rb.tool_use_id)) {
              const tur = data.tool_use_result || {}
              const files = Array.isArray(tur.files) ? tur.files : []
              fileTabsFromGeneratedFiles(files, FILE_SOURCE_CURRENT, rb.tool_use_id)
                .forEach((file) => openFileBrowserTab(file))
              if (files.length > 0) {
                const currentMsgs = useChatStore.getState().messages
                const updatedMsgs = currentMsgs.map((msg) => {
                  if (!Array.isArray(msg.content)) return msg
                  let changed = false
                  const content = msg.content.map((contentBlock) => {
                    const index = files.findIndex((_, fileIndex) =>
                      contentBlock?.id === `file-ref-${buildGeneratedFileOpId(rb.tool_use_id, fileIndex)}`
                    )
                    if (index < 0 || !files[index]?.path) return contentBlock
                    changed = true
                    return {
                      ...contentBlock,
                      filePath: files[index].path,
                      mimeType: files[index].mime_type,
                      size: files[index].size,
                      extension: files[index].extension,
                    }
                  })
                  return changed ? { ...msg, content } : msg
                })
                useChatStore.setState({ messages: updatedMsgs })
              }
              if (files.length > 0) {
                showCanvas()
                setActiveCanvasTab('file-browser')
              }
            }

            // Update TodoWrite info on result
            if (todoWriteIds.has(rb.tool_use_id)) {
              setTodoWriteInfo({
                status: rb.is_error ? 'error' : 'success',
                endTime: Date.now(),
                result: rb,
              })
            }

            // Extract TodoWrite todos
            if (todoWriteIds.has(rb.tool_use_id)) {
              const newTodos = extractTodos(rb, data.tool_use_result)
              if (newTodos) {
                setTodos(newTodos)
                showCanvas()
              }
            }
          }

          // Fallback: extract TodoWrite todos from tool_use_result dict
          if (data.tool_use_result) {
            const tur = data.tool_use_result
            const todoItems = tur.newTodos || tur.todos || tur.new_todos
            if (Array.isArray(todoItems) && useTaskStore.getState().todos.length === 0) {
              setTodos(todoItems)
              showCanvas()
            }
          }
          break
        }

        case 'result': {
          // Set duration on the assistant message
          const finalMsgs = [...useChatStore.getState().messages]
          const finalIdx = finalMsgs.length - 1
          if (finalMsgs[finalIdx]?.role === 'assistant') {
            finalMsgs[finalIdx] = {
              ...finalMsgs[finalIdx],
              duration: Date.now() - streamStartTime,
              inputTokens: data.usage?.input_tokens,
              outputTokens: data.usage?.output_tokens,
              agentLoops: data.num_turns,
            }
            useChatStore.setState({ messages: finalMsgs })
          }
          // ResultMessage can arrive before the transport has actually closed.
          // Keep the UI in streaming mode until onComplete so any late
          // assistant/tool/system events still render under the active state.
          if (data.session_id) {
            setSessionId(data.session_id)
          }
          setCompacting(false)
          setLastResult(data)
          // Update session in sidebar
          if (data.session_id && activeSessionId) {
            updateSession(activeSessionId, {
              sessionId: data.session_id,
              cost: data.total_cost_usd,
              duration: data.duration_ms,
            })
          }
          break
        }

        case 'task_started': {
          // Backend sends task_started as its own SSE event type
          // Fields are flat: data.tool_use_id, data.task_id, data.description, etc.
          const toolUseId = data.tool_use_id
          const currentTasks = useTaskStore.getState().tasks
          if (toolUseId && currentTasks[toolUseId]) {
            // Enrich existing canvas task (created from tool_use)
            updateTask(toolUseId, {
              task_id: data.task_id,
              description: data.description || currentTasks[toolUseId].description,
              task_type: data.task_type,
              status: 'running',
            })
          } else {
            // Create new canvas task from task_started event
            const id = toolUseId || data.task_id || data.session_id
            addTask({
              tool_use_id: id,
              name: 'Task',
              description: data.description || 'Task',
              status: 'running',
              startTime: Date.now(),
              task_id: data.task_id,
              task_type: data.task_type,
            })
            showCanvas()
          }
          break
        }

        case 'task_progress': {
          const toolUseId = data.tool_use_id
          const taskId = data.task_id
          const currentTasks = useTaskStore.getState().tasks
          const id = (toolUseId && currentTasks[toolUseId]) ? toolUseId
            : Object.keys(currentTasks).find((k) => currentTasks[k].task_id === taskId)
          if (id) {
            updateTask(id, {
              progress: data.data,
              description: data.description || currentTasks[id]?.description,
              last_tool_name: data.last_tool_name,
            })
          }
          break
        }

        case 'task_notification': {
          const toolUseId = data.tool_use_id
          const taskId = data.task_id
          const currentTasks = useTaskStore.getState().tasks
          const id = (toolUseId && currentTasks[toolUseId]) ? toolUseId
            : Object.keys(currentTasks).find((k) => currentTasks[k].task_id === taskId)
          if (id) {
            const status = data.status || 'success'
            updateTask(id, {
              status: status === 'completed' ? 'success' : status,
              summary: data.summary,
              endTime: Date.now(),
            })
          }
          break
        }

        case 'hook_event': {
          // Lifecycle pings from include_hook_events. Only PreToolUse /
          // PostToolUse flow over the wire; others are dropped server-side.
          const payload = data?.data || {}
          const toolUseId = payload.tool_use_id || payload.toolUseId
          if (!toolUseId) break
          const merged = mergeHookEventIntoBlock(toolUseId, data)
          if (!merged) {
            const buf = pendingHookEvents.get(toolUseId) || []
            const evtKey = data.uuid || `${data.hook_event_name}-${data.subtype}-${buf.length}`
            const filtered = buf.filter((e) => (e.uuid || '') !== (data.uuid || '___none'))
            pendingHookEvents.set(toolUseId, [...filtered, { ...data, _key: evtKey }])
          }
          break
        }

        case 'system': {
          // SystemMessage with subtype — task events may arrive as system events
          // with fields nested under data.data
          const subtype = data.subtype
          if (subtype === 'task_started') {
            const nested = data.data || {}
            const toolUseId = nested.tool_use_id
            const currentTasks = useTaskStore.getState().tasks
            if (toolUseId && currentTasks[toolUseId]) {
              updateTask(toolUseId, {
                task_id: nested.task_id,
                description: nested.description || currentTasks[toolUseId].description,
                task_type: nested.task_type,
                status: 'running',
              })
            } else {
              const id = toolUseId || nested.task_id || nested.session_id
              if (id) {
                addTask({
                  tool_use_id: id,
                  name: 'Task',
                  description: nested.description || 'Task',
                  status: 'running',
                  startTime: Date.now(),
                  task_id: nested.task_id,
                  task_type: nested.task_type,
                })
                showCanvas()
              }
            }
          } else if (subtype === 'task_progress') {
            const nested = data.data || {}
            const toolUseId = nested.tool_use_id
            const taskId = nested.task_id
            const currentTasks = useTaskStore.getState().tasks
            const id = (toolUseId && currentTasks[toolUseId]) ? toolUseId
              : Object.keys(currentTasks).find((k) => currentTasks[k].task_id === taskId)
            if (id) {
              updateTask(id, {
                progress: nested.data,
                description: nested.description || currentTasks[id]?.description,
                last_tool_name: nested.last_tool_name,
              })
            }
          } else if (subtype === 'task_notification') {
            const nested = data.data || {}
            const toolUseId = nested.tool_use_id
            const taskId = nested.task_id
            const currentTasks = useTaskStore.getState().tasks
            const id = (toolUseId && currentTasks[toolUseId]) ? toolUseId
              : Object.keys(currentTasks).find((k) => currentTasks[k].task_id === taskId)
            if (id) {
              const status = nested.status || 'success'
              updateTask(id, {
                status: status === 'completed' ? 'success' : status,
                summary: nested.summary,
                endTime: Date.now(),
              })
            }
          } else if (subtype === 'status') {
            console.debug('[SSE][compact] system status event:', JSON.stringify(data).slice(0, 500))
            const nested = data.data || {}
            if (nested.status === 'compacting') {
              setCompacting(true)
              addMessage({ role: 'system', type: 'compact', status: 'compacting', timestamp: Date.now() })
            }
          } else if (subtype === 'compact_boundary') {
            console.debug('[SSE][compact] compact_boundary event:', JSON.stringify(data).slice(0, 500))
            const nested = data.data || {}
            const metadata = nested.compact_metadata || {}
            // Find the compacting system message and update it to complete
            const currentMsgs = useChatStore.getState().messages
            const compactIdx = currentMsgs.findIndex(
              (m) => m.role === 'system' && m.type === 'compact' && m.status === 'compacting'
            )
            if (compactIdx >= 0) {
              const updated = [...currentMsgs]
              updated[compactIdx] = {
                ...updated[compactIdx],
                status: 'complete',
                compactMetadata: {
                  trigger: metadata.trigger || 'manual',
                  preTokens: metadata.pre_tokens || 0,
                },
              }
              useChatStore.setState({ messages: updated })
            }
          } else if (subtype === 'init') {
            const nested = data.data || {}
            if (nested.session_id) setSessionId(nested.session_id)
          }
          break
        }

        case 'queued': {
          // Backend accepted the mid-stream queue frame. Nothing to do —
          // the bubble is already rendered in 'pending' status; leave it
          // there until 'queue_flush' promotes it.
          break
        }

        case 'queue_flush': {
          // Backend is about to deliver this queued message as a new turn.
          // Promote the dim queued row into a normal user bubble so the
          // history shows the question was actually asked.
          const qid = data?.id
          const qtext = data?.text
          const queued = useChatStore.getState().queuedUserMessages.find((m) => m.id === qid)
          const text = qtext || queued?.text || ''
          const images = queued?.images || []
          const attachmentsMeta = queued?.attachmentsMeta || null

          const userMsg = { role: 'user', content: [], timestamp: Date.now() }
          for (const img of images) {
            userMsg.content.push({
              type: 'image',
              source: { type: 'base64', media_type: img.media_type, data: img.data },
              filename: img.filename,
            })
          }
          if (text) userMsg.content.push({ type: 'text', text })
          if (attachmentsMeta && attachmentsMeta.length > 0) userMsg.attachments = attachmentsMeta
          useChatStore.getState().addMessage(userMsg)
          useChatStore.getState().addMessage({
            role: 'assistant', content: [], timestamp: Date.now(),
          })
          useChatStore.getState().removeQueuedMessage(qid)
          break
        }

        case 'queue_cancelled': {
          // Backend confirmed removal — ensure local store is in sync (the UI
          // typically removes optimistically when the user clicks cancel).
          if (data?.id) useChatStore.getState().removeQueuedMessage(data.id)
          break
        }

        case 'retry_attempt': {
          setRetryState({
            attempt: data.attempt,
            max: data.max_attempts,
            delaySeconds: data.delay_seconds || 0,
            errorCode: data.error_code || null,
            message: data.message || null,
          })
          break
        }

        case 'retry_exhausted': {
          clearRetryState()
          setStreaming(false)
          setStreamAbort(null)
          useChatStore.getState().abortRunningTools()
          useTaskStore.getState().abortRunningTasks()
          if (lastMsg && lastMsg.role === 'assistant') {
            useChatStore.setState({
              messages: [
                ...msgs.slice(0, lastIdx),
                {
                  ...lastMsg,
                  is_synthetic: true,
                  error: true,
                  errorInfo: {
                    code: data.error_code || 'unknown',
                    attempts: data.attempts,
                    message: data.message,
                    raw_detail: data.raw_detail || null,
                    api_error_status: data.api_error_status ?? null,
                  },
                },
              ],
            })
          }
          useToastStore.getState().pushToast({
            level: data.api_error_status === 429 ? 'warning' : 'error',
            title: i18n.t('chat.upstreamErrorTitle'),
            body: data.message || i18n.t('chat.retriesExhausted'),
          })
          break
        }

        case 'stream_error': {
          clearRetryState()
          setStreaming(false)
          setStreamAbort(null)
          useChatStore.getState().abortRunningTools()
          useTaskStore.getState().abortRunningTasks()
          if (lastMsg && lastMsg.role === 'assistant') {
            useChatStore.setState({
              messages: [
                ...msgs.slice(0, lastIdx),
                {
                  ...lastMsg,
                  is_synthetic: true,
                  error: true,
                  errorInfo: {
                    code: data.code || 'unknown',
                    attempts: 1,
                    message: data.message || 'Stream error',
                    api_error_status: data.api_error_status ?? null,
                  },
                },
              ],
            })
          }
          useToastStore.getState().pushToast({
            level: data.api_error_status === 429 ? 'warning' : 'error',
            title: `${i18n.t('chat.streamErrorTitle')}${data.code ? ` (${data.code})` : ''}`,
            body: data.message || i18n.t('chat.streamEnded'),
          })
          break
        }

        case 'rate_limit_status': {
          // Informational — CLI is auto-handling 429s; don't retry, just notify.
          const status = data.status || 'unknown'
          if (status === 'allowed' || status === 'allowed_warning') {
            useToastStore.getState().pushToast({
              level: 'warning',
              title: i18n.t('chat.rateLimitedTitle'),
              body: data.resets_at ? i18n.t('chat.rateLimitResets', { time: data.resets_at }) : undefined,
            })
          }
          break
        }

        case 'error': {
          setStreaming(false)
          setStreamAbort(null)
          useChatStore.getState().abortRunningTools()
          useTaskStore.getState().abortRunningTasks()
          // Add error to last message
          if (lastMsg && lastMsg.role === 'assistant') {
            useChatStore.setState({
              messages: [
                ...msgs.slice(0, lastIdx),
                {
                  ...lastMsg,
                  is_synthetic: true,
                  error: true,
                  errorInfo: {
                    code: 'transport',
                    attempts: 1,
                    message: data.message,
                  },
                },
              ],
            })
          }
          useToastStore.getState().pushToast({
            level: 'error',
            title: i18n.t('connection.errorTitle'),
            body: data.message || i18n.t('connection.lost'),
          })
          break
        }
      }
    }

    const onComplete = () => {
      const { setStreaming, setStreamAbort, setWsSendPermission, setQueueSender, clearQueuedMessages, streamGeneration, messages: doneMsgs } = useChatStore.getState()
      if (streamGeneration !== streamGen) return
      setStreaming(false)
      setStreamAbort(null)
      setWsSendPermission(null)
      setQueueSender(null)
      clearQueuedMessages()
      // Successful turn: release the retained prompt payload (multi-MB image
      // base64). Failed turns keep it so ErrorBlock [Retry] can resend.
      const lastAssistant = [...doneMsgs].reverse().find((m) => m.role === 'assistant')
      if (lastAssistant && !lastAssistant.error) {
        useChatStore.getState().clearLastUserPrompt()
      }
      useSidebarStore.getState().fetchSessions()
    }

    const mcpServers = useChatStore.getState().mcpServers

    if (transport === 'ws') {
      const { abort, sendPermission, sendQueue, sendQueueCancel } = streamAgentRunWS(message, sessionId, onEvent, permissionMode, onComplete, selectedModel, attachments, mcpServers, images, { tabId }, enableFileCheckpointing)
      setStreamAbort(abort)
      setWsSendPermission(sendPermission)
      useChatStore.getState().setQueueSender({ sendQueue, sendQueueCancel })
    } else {
      const { abort } = streamAgentRun(message, sessionId, onEvent, permissionMode, onComplete, selectedModel, attachments, mcpServers, images, enableFileCheckpointing)
      setStreamAbort(abort)
    }
  }, [])

  const sendAnswer = useCallback(async (answerText, toolUseId, answerData) => {
    const { pendingAskUser } = useChatStore.getState()
    const isPermissionBased = pendingAskUser?._permissionRequestId

    // Update the ask_user block: status + persist selections/customInputs + answeredText
    const msgs = [...useChatStore.getState().messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== 'assistant') continue
      const newContent = msg.content.map((b) => {
        if (b.type === 'ask_user' && b.toolUseId === toolUseId) {
          return {
            ...b,
            status: 'answered',
            answeredText: answerText,
            answeredSelections: answerData?.selections || {},
            answeredCustomInputs: answerData?.customInputs || {},
          }
        }
        return b
      })
      const changed = newContent.some((b, j) => b !== msg.content[j])
      if (changed) {
        msgs[i] = { ...msg, content: newContent }
        useChatStore.setState({ messages: msgs })
        break
      }
    }
    useChatStore.getState().clearPendingAskUser()

    if (isPermissionBased) {
      // Route through permission: WS if available, otherwise POST
      const { streamId, wsSendPermission } = useChatStore.getState()
      const updatedInput = { questions: pendingAskUser.questions, answer: answerText }
      if (wsSendPermission) {
        wsSendPermission(isPermissionBased, 'allow', null, updatedInput)
      } else if (streamId) {
        try {
          await respondPermissionAPI(streamId, isPermissionBased, 'allow', null, updatedInput)
        } catch (err) {
          useToastStore.getState().pushToast({
            level: 'error',
            title: i18n.t('chat.permissionRespondFailed'),
            body: String(err?.message || err),
          })
        }
      }
    } else {
      // Original flow: send the answer as a new message to resume the session
      sendMessage(answerText)
    }
  }, [sendMessage])

  const declineAskUser = useCallback(async () => {
    const { pendingAskUser } = useChatStore.getState()
    if (!pendingAskUser) return
    const toolUseId = pendingAskUser.toolUseId
    const isPermissionBased = pendingAskUser._permissionRequestId
    // Mark all pending ask_user blocks as 'declined'
    const msgs = [...useChatStore.getState().messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== 'assistant') continue
      const newContent = msg.content.map((b) => {
        if (b.type === 'ask_user' && b.toolUseId === toolUseId) {
          return { ...b, status: 'declined' }
        }
        return b
      })
      const changed = newContent.some((b, j) => b !== msg.content[j])
      if (changed) {
        msgs[i] = { ...msg, content: newContent }
        useChatStore.setState({ messages: msgs })
        break
      }
    }
    useChatStore.getState().clearPendingAskUser()
    // If permission-based, send deny: WS if available, otherwise POST
    if (isPermissionBased) {
      const { streamId, wsSendPermission } = useChatStore.getState()
      if (wsSendPermission) {
        wsSendPermission(isPermissionBased, 'deny', 'User skipped the question')
      } else if (streamId) {
        try {
          await respondPermissionAPI(streamId, isPermissionBased, 'deny', 'User skipped the question')
        } catch (err) {
          useToastStore.getState().pushToast({
            level: 'error',
            title: i18n.t('chat.permissionDeclineFailed'),
            body: String(err?.message || err),
          })
        }
      }
    }
  }, [])

  const respondPermission = useCallback(async (requestId, decision, message, updatedInput) => {
    const { streamId, wsSendPermission } = useChatStore.getState()
    if (wsSendPermission) {
      wsSendPermission(requestId, decision, message, updatedInput)
    } else if (streamId) {
      try {
        await respondPermissionAPI(streamId, requestId, decision, message, updatedInput)
      } catch (err) {
        useToastStore.getState().pushToast({
          level: 'error',
          title: i18n.t('chat.permissionRespondFailed'),
          body: String(err?.message || err),
        })
      }
    } else {
      console.warn('[SSE] respondPermission: no streamId, skipping API call')
    }
    // Always resolve the permission UI regardless of API success
    useChatStore.getState().resolvePermission(requestId)
  }, [])

  const stopStream = useCallback(() => stopActiveStream(), [])

  return { sendMessage, stopStream, sendAnswer, declineAskUser, respondPermission }
}
