import { create } from 'zustand'
import { STORAGE_KEYS } from '@/constants/storage'
import type { Cell } from '@/types'

export type ViewMode = '3x3' | '9x9'

export type BreadcrumbItem = {
  gridId: string
  cellId: string | null   // null = root
  label: string
  imagePath?: string | null  // テキストが空のときに画像サムネイル表示するためのフォールバック
  cells: Cell[]           // そのグリッドの9セル（ミニプレビュー用）
  highlightPosition: number | null  // 次の階層に進んだセルの position
}

// 文字サイズは「level」(-10 〜 +20 の整数) で管理し、
// 実際のスケールは 1.1^level で計算する（乗算ステップ）。
//   level  -10 → 約 39%
//   level    0 → 100%
//   level +20 → 約 673%
// 線形ステップだと level = -10 で fontScale = 0 になってしまうため乗算採用。
const FONT_LEVEL_KEY = STORAGE_KEYS.fontLevel
const FONT_LEVEL_MIN = -10
const FONT_LEVEL_MAX = 20
const FONT_LEVEL_DEFAULT = 0
const FONT_STEP_FACTOR = 1.1

function levelToScale(level: number): number {
  return Math.pow(FONT_STEP_FACTOR, level)
}

function loadFontLevel(): number {
  try {
    const v = localStorage.getItem(FONT_LEVEL_KEY)
    if (!v) return FONT_LEVEL_DEFAULT
    const n = parseInt(v, 10)
    if (Number.isNaN(n)) return FONT_LEVEL_DEFAULT
    return Math.min(FONT_LEVEL_MAX, Math.max(FONT_LEVEL_MIN, n))
  } catch {
    return FONT_LEVEL_DEFAULT
  }
}

function persistFontLevel(level: number) {
  try { localStorage.setItem(FONT_LEVEL_KEY, String(level)) } catch { /* noop */ }
}

// セル左上 done チェックボックス UI 表示 ON/OFF はマンダラート単位の DB カラム
// (`mandalarts.show_checkbox`、migration 007 以降) に移行した。グローバル localStorage
// による全マンダラート共通設定は廃止。EditorLayout 側で local state + DB load/persist
// で管理するため、editorStore からは関連 state を削除した。

type EditorState = {
  mandalartId: string | null
  currentGridId: string | null
  viewMode: ViewMode
  breadcrumb: BreadcrumbItem[]
  fontLevel: number   // -10 〜 +10 の整数
  fontScale: number   // 1.1^fontLevel (派生値、Cell に渡す)

  setMandalartId: (id: string) => void
  setCurrentGrid: (gridId: string | null) => void
  setViewMode: (mode: ViewMode) => void
  pushBreadcrumb: (item: BreadcrumbItem) => void
  popBreadcrumbTo: (gridId: string) => void
  resetBreadcrumb: (root: BreadcrumbItem) => void
  /**
   * breadcrumb 全段を一括 set + currentGridId を末尾 item に揃える。
   * 用途: ダッシュボード再オープン時に `mandalarts.last_grid_id` から ancestry を構築して
   * 復元するパス。`resetBreadcrumb` (root 1 段のみ) では足りないので新設。
   */
  setBreadcrumb: (items: BreadcrumbItem[]) => void
  // gridId に一致する breadcrumb エントリの一部フィールドを更新する (label / imagePath など)
  updateBreadcrumbItem: (gridId: string, updates: Partial<BreadcrumbItem>) => void

  bumpFontLevel: (delta: number) => void
  resetFontLevel: () => void
}

export const useEditorStore = create<EditorState>((set) => {
  const initialLevel = loadFontLevel()
  return {
    mandalartId: null,
    currentGridId: null,
    viewMode: '3x3',
    breadcrumb: [],
    fontLevel: initialLevel,
    fontScale: levelToScale(initialLevel),

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

    setBreadcrumb: (items) =>
      set({
        breadcrumb: items,
        currentGridId: items.length > 0 ? items[items.length - 1].gridId : null,
      }),

    updateBreadcrumbItem: (gridId, updates) =>
      set((s) => {
        const idx = s.breadcrumb.findIndex((b) => b.gridId === gridId)
        if (idx < 0) return s
        const next = s.breadcrumb.slice()
        next[idx] = { ...next[idx], ...updates }
        return { breadcrumb: next }
      }),

    bumpFontLevel: (delta) =>
      set((s) => {
        const next = Math.min(FONT_LEVEL_MAX, Math.max(FONT_LEVEL_MIN, s.fontLevel + delta))
        if (next === s.fontLevel) return s
        persistFontLevel(next)
        return { fontLevel: next, fontScale: levelToScale(next) }
      }),
    resetFontLevel: () => {
      persistFontLevel(FONT_LEVEL_DEFAULT)
      set({ fontLevel: FONT_LEVEL_DEFAULT, fontScale: levelToScale(FONT_LEVEL_DEFAULT) })
    },
  }
})
