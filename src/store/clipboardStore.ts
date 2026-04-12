import { create } from 'zustand'
import type { CellSnapshot } from '@/types'

type ClipboardState = {
  mode: 'cut' | 'copy' | null
  sourceCellId: string | null
  snapshot: CellSnapshot | null

  set: (mode: 'cut' | 'copy', cellId: string, snapshot: CellSnapshot) => void
  clear: () => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  mode: null,
  sourceCellId: null,
  snapshot: null,

  set: (mode, cellId, snapshot) => set({ mode, sourceCellId: cellId, snapshot }),
  clear: () => set({ mode: null, sourceCellId: null, snapshot: null }),
}))
