import { create } from 'zustand'

const useConnectionStore = create((set) => ({
  state: 'connected', // 'connected' | 'reconnecting' | 'disconnected'
  attempt: 0,
  maxAttempts: 0,
  delaySeconds: 0,
  code: null,

  markConnected: () => set({
    state: 'connected', attempt: 0, maxAttempts: 0, delaySeconds: 0, code: null,
  }),
  markReconnecting: ({ attempt, maxAttempts, delaySeconds, code }) => set({
    state: 'reconnecting',
    attempt: attempt ?? 0,
    maxAttempts: maxAttempts ?? 0,
    delaySeconds: delaySeconds ?? 0,
    code: code ?? null,
  }),
  markDisconnected: ({ code } = {}) => set({
    state: 'disconnected',
    delaySeconds: 0,
    code: code ?? null,
  }),
  tickDelay: () => set((s) => (
    s.state === 'reconnecting' && s.delaySeconds > 0
      ? { delaySeconds: s.delaySeconds - 1 }
      : {}
  )),
}))

export default useConnectionStore
