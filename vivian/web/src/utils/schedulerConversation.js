import { fetchSessionMessages } from '../api/sessions'
import { transformSessionMessages } from './sessionTransform'

export async function fetchSchedulerConversation(sessionId) {
  const data = await fetchSessionMessages(sessionId)
  return transformSessionMessages(data.messages || [])
}
