import { beforeEach, describe, expect, it } from 'vitest'
import useChatStore from '../chatStore'
import useSidebarStore, { reconcileSessionRows } from '../sidebarStore'
import { getRunStatusPatch, shouldApplyRunEvent } from '../../utils/runRouting'

describe('chat run isolation and recovery state', () => {
  beforeEach(() => {
    useSidebarStore.setState({
      sessions: [], activeSessionId: null, sessionsTotal: 0,
      sessionsOffset: 0, sessionsLoading: false, sessionsHasMore: false,
    })
    useChatStore.getState().reset()
  })

  it('adds a new chat immediately and promotes it without duplicates', () => {
    const sidebar = useSidebarStore.getState()
    sidebar.addSession({ id: 'draft:1', name: 'hello', runStatus: 'running' })
    useSidebarStore.getState().promoteSession('draft:1', 'run:run-1', { runId: 'run-1' })
    useSidebarStore.getState().promoteSession('run:run-1', 'session-1', { sessionId: 'session-1' })

    expect(useSidebarStore.getState().sessions).toHaveLength(1)
    expect(useSidebarStore.getState().sessions[0]).toMatchObject({
      id: 'session-1', runId: 'run-1', sessionId: 'session-1',
    })
    expect(useSidebarStore.getState().activeSessionId).toBe('session-1')
  })

  it('coalesces retained and current runs that share one session', () => {
    const persisted = [{ id: 'session-1', sessionId: 'session-1', name: 'chat one' }]
    const runs = [
      { run_id: 'old-run', session_id: 'session-1', status: 'completed', updated_at: 10 },
      {
        run_id: 'current-run', session_id: 'session-1', status: 'waiting_user', updated_at: 20,
        pending_requests: [{ request_id: 'approval-1' }],
      },
    ]

    expect(reconcileSessionRows(persisted, runs)).toEqual([expect.objectContaining({
      id: 'session-1', sessionId: 'session-1', runId: 'current-run',
      runStatus: 'waiting_user', pendingRequest: { request_id: 'approval-1' },
    })])
  })

  it('promotion removes a raced row with the same session identity', () => {
    useSidebarStore.setState({
      sessions: [
        { id: 'run:run-1', runId: 'run-1', name: 'draft' },
        { id: 'session-1', sessionId: 'session-1', name: 'history' },
      ],
      activeSessionId: 'run:run-1',
    })

    useSidebarStore.getState().promoteSession('run:run-1', 'session-1', {
      runId: 'run-1', sessionId: 'session-1',
    })

    expect(useSidebarStore.getState().sessions).toHaveLength(1)
    expect(useSidebarStore.getState().sessions[0]).toMatchObject({
      id: 'session-1', runId: 'run-1', sessionId: 'session-1',
    })
  })

  it('routes a background confirmation to its list row, not the active chat', () => {
    expect(shouldApplyRunEvent('chat-a', 'chat-b')).toBe(false)
    expect(shouldApplyRunEvent('chat-b', 'chat-b')).toBe(true)

    const request = { request_id: 'p-b', tool_name: 'AskUserQuestion' }
    expect(getRunStatusPatch('permission_request', request)).toEqual({
      runStatus: 'waiting_user', pendingRequest: request,
    })
    expect(getRunStatusPatch('permission_resolved', { request_id: 'p-b' })).toEqual({
      runStatus: 'running', pendingRequest: null,
    })
  })

  it('restores streaming and pending AskUser state for an active run', () => {
    const pendingAskUser = {
      toolUseId: 'request-1', questions: [{ question: 'Continue?' }],
      _permissionRequestId: 'request-1',
    }
    useChatStore.getState().loadSession(
      'session-1',
      [{ role: 'assistant', content: [] }],
      null,
      {},
      { runId: 'run-1', isStreaming: true, pendingAskUser, inputText: 'draft answer' },
    )

    expect(useChatStore.getState()).toMatchObject({
      sessionId: 'session-1', runId: 'run-1', streamId: 'run-1',
      isStreaming: true, pendingAskUser, inputText: 'draft answer',
    })
  })

  it('updates only the matching run row', () => {
    useSidebarStore.setState({
      sessions: [
        { id: 'a', runId: 'run-a', runStatus: 'running' },
        { id: 'b', runId: 'run-b', runStatus: 'running' },
      ],
    })
    useSidebarStore.getState().updateRun('run-b', {
      runStatus: 'waiting_user', pendingRequest: { request_id: 'p-b' },
    })

    const [a, b] = useSidebarStore.getState().sessions
    expect(a.runStatus).toBe('running')
    expect(a.pendingRequest).toBeUndefined()
    expect(b).toMatchObject({ runStatus: 'waiting_user', pendingRequest: { request_id: 'p-b' } })
  })
})
