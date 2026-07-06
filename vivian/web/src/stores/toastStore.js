import { create } from 'zustand'

const AUTO_DISMISS_MS = {
  warning: 8000,
  info: 4000,
}

let nextId = 1

const useToastStore = create((set, get) => ({
  toasts: [],
  pushToast: (toast) => {
    const id = toast?.id || `t-${nextId++}`
    const level = toast?.level || 'info'
    const dismissAfterMs = toast?.dismissAfterMs ?? AUTO_DISMISS_MS[level] ?? null
    const entry = {
      id,
      level,
      title: toast?.title || '',
      body: toast?.body || null,
      action: toast?.action || null,
      dismissAfterMs,
      createdAt: Date.now(),
    }
    set((s) => ({ toasts: [...s.toasts, entry] }))
    if (dismissAfterMs) {
      setTimeout(() => {
        const exists = get().toasts.some((t) => t.id === id)
        if (exists) get().dismissToast(id)
      }, dismissAfterMs)
    }
    return id
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}))

export default useToastStore
