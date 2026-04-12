import { create } from 'zustand'

type ClipboardState = {
  mode: 'cut' | 'copy' | null
  sourceCellId: string | null

  set: (mode: 'cut' | 'copy', cellId: string) => void
  clear: () => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  mode: null,
  sourceCellId: null,

  set: (mode, cellId) => set({ mode, sourceCellId: cellId }),
  clear: () => set({ mode: null, sourceCellId: null }),
}))
