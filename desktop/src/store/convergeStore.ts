import { create } from 'zustand'

/**
 * 「中心セル → ダッシュボードカード」のクロスルート収束アニメ用 state。
 *
 * EditorLayout がホーム遷移時に中心セルの矩形と表示内容を保存して dashboard へ
 * navigate する。App 直下にマウントされた `ConvergeOverlay` がこの state を購読し、
 * 中心セルの見た目を再現した overlay を sourceRect の位置/サイズで描画 → polling で
 * 該当カード (`data-converge-card={id}`) を見つけ、見つかった矩形に向けて transform
 * (translate + scale) で吸い込ませる。アニメ完了後 `clear()` で state を消す。
 *
 * 必要な情報は中心セル単体の rect + 表示内容のみ (text / 画像パス / 色)。html-to-image
 * のスクリーンショットも DOM clone も使わない軽量実装。
 */
type SourceRect = { left: number; top: number; width: number; height: number }
type CenterCell = {
  text: string
  imagePath: string | null
  color: string | null
  /** 中心セル text の実フォントサイズ (px)。Cell.tsx と同じ見た目で overlay を描画するため。 */
  fontPx: number
  /** Cell.tsx textInsetStyle.top を再現する inset (px、border-box 内側起算)。
   * showCheckbox=ON のときのみ side より大きくなる。 */
  topInsetPx: number
  /** Cell.tsx textInsetStyle.right/bottom/left に対応する inset (px、border-box 内側起算)。 */
  sideInsetPx: number
}

type ConvergeState = {
  mandalartId: string | null
  sourceRect: SourceRect | null
  centerCell: CenterCell | null
  setConverge: (id: string, rect: SourceRect, centerCell: CenterCell) => void
  clear: () => void
}

export const useConvergeStore = create<ConvergeState>((set) => ({
  mandalartId: null,
  sourceRect: null,
  centerCell: null,
  setConverge: (id, rect, centerCell) =>
    set({ mandalartId: id, sourceRect: rect, centerCell }),
  clear: () => set({ mandalartId: null, sourceRect: null, centerCell: null }),
}))
