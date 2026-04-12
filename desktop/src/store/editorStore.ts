import { create } from 'zustand'
import type { Cell } from '@/types'

export type ViewMode = '3x3' | '9x9'

export type BreadcrumbItem = {
  gridId: string
  cellId: string | null   // null = root
  label: string
  cells: Cell[]           // そのグリッドの9セル（ミニプレビュー用）
  highlightPosition: number | null  // 次の階層に進んだセルの position
}

type EditorState = {
  mandalartId: string | null
  currentGridId: string | null
  viewMode: ViewMode
  breadcrumb: BreadcrumbItem[]

  setMandalartId: (id: string) => void
  setCurrentGrid: (gridId: string) => void
  setViewMode: (mode: ViewMode) => void
  pushBreadcrumb: (item: BreadcrumbItem) => void
  popBreadcrumbTo: (gridId: string) => void
  resetBreadcrumb: (root: BreadcrumbItem) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  mandalartId: null,
  currentGridId: null,
  viewMode: '3x3',
  breadcrumb: [],

  setMandalartId: (id) => set({ mandalartId: id }),
  setCurrentGrid: (gridId) => set({ currentGridId: gridId }),
  setViewMode: (mode) => set({ viewMode: mode }),

  pushBreadcrumb: (item) =>
    set((s) => ({ breadcrumb: [...s.breadcrumb, item] })),

  popBreadcrumbTo: (gridId) =>
    set((s) => {
      const idx = s.breadcrumb.findIndex((b) => b.gridId === gridId)
      if (idx < 0) return s
      return { breadcrumb: s.breadcrumb.slice(0, idx + 1), currentGridId: gridId }
    }),

  resetBreadcrumb: (root) =>
    set({ breadcrumb: [root], currentGridId: root.gridId }),
}))
