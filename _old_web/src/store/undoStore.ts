import { create } from 'zustand'

export type UndoOperation = {
  description: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

type UndoState = {
  past: UndoOperation[]
  future: UndoOperation[]

  push: (op: UndoOperation) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  future: [],

  push: (op) =>
    set((s) => ({ past: [...s.past, op], future: [] })),

  undo: async () => {
    const { past } = get()
    if (past.length === 0) return
    const op = past[past.length - 1]
    await op.undo()
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [op, ...s.future],
    }))
  },

  redo: async () => {
    const { future } = get()
    if (future.length === 0) return
    const op = future[0]
    await op.redo()
    set((s) => ({
      past: [...s.past, op],
      future: s.future.slice(1),
    }))
  },

  clear: () => set({ past: [], future: [] }),
}))
