import { create } from 'zustand'
import type { CellSnapshot } from '@/types'

type ClipboardState = {
  mode: 'cut' | 'copy' | null
  // copy: 元セルを live 参照する (ペースト時に現在の内容を読む)
  sourceCellId: string | null
  // cut: 元セルは即削除されるため detached な snapshot を保持する
  snapshot: CellSnapshot | null

  setCopy: (cellId: string) => void
  setCut: (snapshot: CellSnapshot) => void
  clear: () => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  mode: null,
  sourceCellId: null,
  snapshot: null,

  setCopy: (cellId) => set({ mode: 'copy', sourceCellId: cellId, snapshot: null }),
  setCut: (snapshot) => set({ mode: 'cut', sourceCellId: null, snapshot }),
  clear: () => set({ mode: null, sourceCellId: null, snapshot: null }),
}))
