import { getJSON, postJSON, putJSON, deleteJSON, getAuthHeaders } from './client'

const BASE_URL = '/api'

export const fetchAgents = () => getJSON('/subagents/list')

export const fetchAgent = (name) =>
  getJSON(`/subagents/${encodeURIComponent(name)}`)

export const fetchCatalog = () => getJSON('/subagents/catalog')

export const createAgent = (body) => postJSON('/subagents/', body)

export const updateAgent = (name, body) =>
  putJSON(`/subagents/${encodeURIComponent(name)}`, body)

export const deleteAgent = (name) =>
  deleteJSON(`/subagents/${encodeURIComponent(name)}`)

/**
 * Stream a one-shot test run against the named agent. Returns { abort } to cancel.
 */
export function streamAgentTest(name, prompt, onEvent, onComplete) {
  const controller = new AbortController()

  const run = async () => {
    const res = await fetch(
      `${BASE_URL}/subagents/${encodeURIComponent(name)}/test/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      }
    )

    if (!res.ok) {
      if (res.status === 401) {
        window.dispatchEvent(new Event('auth:unauthorized'))
      }
      const text = await res.text()
      throw new Error(`SSE error ${res.status}: ${text}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent(currentEvent, data)
          } catch {
            /* skip malformed JSON */
          }
          currentEvent = null
        } else if (line === '') {
          currentEvent = null
        }
      }
    }
  }

  run()
    .then(() => onComplete?.())
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent('error', { message: err.message })
      }
      onComplete?.()
    })

  return { abort: () => controller.abort() }
}
