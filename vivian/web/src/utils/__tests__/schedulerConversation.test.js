import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchSessionMessages = vi.fn()
const transformSessionMessages = vi.fn()

vi.mock('../../api/sessions', () => ({ fetchSessionMessages }))
vi.mock('../sessionTransform', () => ({ transformSessionMessages }))

const { fetchSchedulerConversation } = await import('../schedulerConversation')

describe('fetchSchedulerConversation', () => {
  beforeEach(() => {
    fetchSessionMessages.mockReset()
    transformSessionMessages.mockReset()
  })

  it('loads and transforms the selected scheduler session', async () => {
    fetchSessionMessages.mockResolvedValue({ messages: [{ role: 'user', content: 'hello' }] })
    transformSessionMessages.mockReturnValue({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      subagentContent: {},
      fileOps: [],
      fileBrowserTabs: [],
      tasks: [],
    })

    const result = await fetchSchedulerConversation('session-123')

    expect(fetchSessionMessages).toHaveBeenCalledWith('session-123')
    expect(transformSessionMessages).toHaveBeenCalledWith([{ role: 'user', content: 'hello' }])
    expect(result.messages).toHaveLength(1)
  })
})
