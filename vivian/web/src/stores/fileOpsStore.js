import { create } from 'zustand'

const useFileOpsStore = create((set, get) => ({
  fileOps: [],
  selectedFileOpId: null,
  roundCounter: 0,

  addFileOp: (op) =>
    set((s) => ({
      fileOps: [...s.fileOps, { ...op, roundId: s.roundCounter }],
    })),

  updateFileOp: (id, data) =>
    set((s) => ({
      fileOps: s.fileOps.map((op) => (op.id === id ? { ...op, ...data } : op)),
    })),

  setSelectedFileOpId: (id) => set({ selectedFileOpId: id }),

  incrementRound: () => set((s) => ({ roundCounter: s.roundCounter + 1 })),

  clearFileOps: () => set({ fileOps: [], selectedFileOpId: null, roundCounter: 0 }),

  reset: () => set({ fileOps: [], selectedFileOpId: null, roundCounter: 0 }),
}))

export default useFileOpsStore
