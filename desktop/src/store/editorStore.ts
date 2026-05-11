import { create } from 'zustand'
import { STORAGE_KEYS } from '@/constants/storage'
import type { Cell, Mandalart } from '@/types'

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
//
// 永続化スコープは per-mandalart × per-device。キー: `mandalart.fontLevel.<mandalartId>`。
// per-mandalart キー未設定時は legacy global key (`STORAGE_KEYS.fontLevel`) を fallback として
// 全マンダラートのデフォルトに引き継ぐ (= 旧バージョン user の調整値が再オープンで保たれる)。
// iOS 側 (`MandalartFontPreference`) も同じキー prefix で per-mandalart 化されており設計対称。
const FONT_LEVEL_LEGACY_KEY = STORAGE_KEYS.fontLevel
const FONT_LEVEL_MIN = -10
const FONT_LEVEL_MAX = 20
const FONT_LEVEL_DEFAULT = 0
const FONT_STEP_FACTOR = 1.1

function fontLevelKey(mandalartId: string): string {
  return `${FONT_LEVEL_LEGACY_KEY}.${mandalartId}`
}

function levelToScale(level: number): number {
  return Math.pow(FONT_STEP_FACTOR, level)
}

function clampLevel(n: number): number {
  return Math.min(FONT_LEVEL_MAX, Math.max(FONT_LEVEL_MIN, n))
}

/**
 * mandalartId が null のときは legacy global key を直接読む (= ダッシュボード等の
 * 「マンダラート未選択」状態の初期値)。エディタに入って setMandalartId が呼ばれた
 * タイミングで per-mandalart key を再 load する。
 */
function loadFontLevel(mandalartId: string | null): number {
  try {
    const raw =
      (mandalartId ? localStorage.getItem(fontLevelKey(mandalartId)) : null)
      ?? localStorage.getItem(FONT_LEVEL_LEGACY_KEY)
    if (!raw) return FONT_LEVEL_DEFAULT
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return FONT_LEVEL_DEFAULT
    return clampLevel(n)
  } catch {
    return FONT_LEVEL_DEFAULT
  }
}

function persistFontLevel(level: number, mandalartId: string) {
  try { localStorage.setItem(fontLevelKey(mandalartId), String(level)) } catch { /* noop */ }
}

// セル左上 done チェックボックス UI 表示 ON/OFF はマンダラート単位の DB カラム
// (`mandalarts.show_checkbox`、migration 007 以降) に移行した。グローバル localStorage
// による全マンダラート共通設定は廃止。EditorLayout 側で local state + DB load/persist
// で管理するため、editorStore からは関連 state を削除した。

type EditorState = {
  mandalartId: string | null
  /**
   * 現在開いているマンダラート全体 (migration 011 以降)。EditorLayout 起動時に
   * `getMandalart(id)` の結果を `setCurrentMandalart` で投入し、unmount で null クリアする。
   * realtime の `applyMandalartChange` でも対象 id 一致時に同期されるので、別端末/別タブで
   * `locked` を切替えるとエディタの read-only モードが即時反映される。
   *
   * 主用途は `locked` の購読 (`useEditorStore((s) => s.currentMandalart?.locked ?? false)`)。
   * ダッシュボードカード経由のロック切替は楽観的 UI 更新と push 同期で完結し、本 store は
   * エディタ内部での read-only 表示専用。
   */
  currentMandalart: Mandalart | null
  currentGridId: string | null
  viewMode: ViewMode
  breadcrumb: BreadcrumbItem[]
  fontLevel: number   // -10 〜 +10 の整数
  fontScale: number   // 1.1^fontLevel (派生値、Cell に渡す)

  setMandalartId: (id: string) => void
  setCurrentMandalart: (m: Mandalart | null) => void
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
  const initialLevel = loadFontLevel(null)
  return {
    mandalartId: null,
    currentMandalart: null,
    currentGridId: null,
    viewMode: '3x3',
    breadcrumb: [],
    fontLevel: initialLevel,
    fontScale: levelToScale(initialLevel),

    setMandalartId: (id) => {
      // mandalart 切替時に per-mandalart key を再 load (= 別マンダラートの拡縮が混入しない)。
      // 未設定マンダラートは legacy global key の値を fallback で引き継ぐ。
      const lvl = loadFontLevel(id)
      set({ mandalartId: id, fontLevel: lvl, fontScale: levelToScale(lvl) })
    },
    setCurrentMandalart: (m) => set({ currentMandalart: m }),
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
        const next = clampLevel(s.fontLevel + delta)
        if (next === s.fontLevel) return s
        // mandalartId 未設定時 (= ダッシュボード等で UI 自体出ないが防御) は
        // state だけ更新して persist しない。エディタ入った時に正しい per-mandalart key を読む。
        if (s.mandalartId) persistFontLevel(next, s.mandalartId)
        return { fontLevel: next, fontScale: levelToScale(next) }
      }),
    resetFontLevel: () =>
      set((s) => {
        if (s.mandalartId) persistFontLevel(FONT_LEVEL_DEFAULT, s.mandalartId)
        return { fontLevel: FONT_LEVEL_DEFAULT, fontScale: levelToScale(FONT_LEVEL_DEFAULT) }
      }),
  }
})
