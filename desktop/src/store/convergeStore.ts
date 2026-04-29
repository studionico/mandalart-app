import { create } from 'zustand'

/**
 * エディタ ↔ ダッシュボード ↔ ストック間の「セル ↔ カード ↔ ストックエントリ」モーフィングアニメ用 state。
 *
 * 3 方向に対応する:
 *
 * - **direction='home'** (エディタ → ダッシュボード): エディタのホームボタンで navigate する直前に
 *   中心セル DOM の rect と border/radius/inset/font を計測 → store にセット → navigate。
 *   App 直下の `ConvergeOverlay` が初期状態 (中心セル相当) で overlay を描画し、ダッシュボード側の
 *   `[data-converge-card="<id>"]` を polling で探して、見つかった矩形に向けて寸法/枠/角丸/inset/font を
 *   並列 CSS transition で morph する (overlay → カード形状)。
 * - **direction='open'** (ダッシュボード → エディタ): ダッシュボードのカードクリックで navigate する直前に
 *   カード DOM の rect と border/radius/inset/font を計測 → store にセット → navigate。
 *   overlay は初期状態 (カード相当) で描画され、エディタ側の `[data-mandalart-id="<id>"] [data-position="4"]`
 *   を polling で探して、中心セルの矩形に向けて morph する (overlay → 中心セル形状)。
 * - **direction='stock'** (エディタ内セル → ストックエントリ): D&D で copy/move ドロップした直後に、
 *   ドラッグ元セル DOM の rect/visuals を計測 → addToStock/moveCellToStock で stockItem.id を取得 →
 *   store にセット。`[data-converge-stock="<id>"]` を polling で探して、新規ストックエントリの矩形に
 *   向けて morph (overlay → ストックエントリ形状)。「コピー/移動の格納先が視覚的に分かる」UX。
 *
 * `targetId` は方向によって意味が変わる polymorphic id (mandalart_id / mandalart_id / stock_item_id)。
 * 両端値はすべて DOM 実測なのでテーマ変更/フォント拡縮にも自動追従、html-to-image 等の重い処理は不要。
 */
type SourceRect = { left: number; top: number; width: number; height: number }

/** モーフィング元の見た目情報。「source 側 (ユーザーが直前に見ていた要素)」の値を持つ。
 * direction='home' なら editor 中心セル、'open' ならダッシュボードカード、'stock' なら editor 内のセル。 */
type CenterCell = {
  text: string
  imagePath: string | null
  color: string | null
  /** source の実フォントサイズ (px)。 */
  fontPx: number
  /** source の text wrapper top inset (px、border-box 内側起算)。
   * 中心セルで showCheckbox=ON のときのみ side より大きくなる。 */
  topInsetPx: number
  /** source の text wrapper right/bottom/left inset (px、border-box 内側起算)。 */
  sideInsetPx: number
  /** source の border-width (px)。中心セルなら 6、ダッシュボードカードなら 3。 */
  borderPx: number
  /** source の border-radius (px)。中心セルなら 8 (rounded-lg)、カードなら 4 (rounded)。 */
  radiusPx: number
}

/** モーフィング方向。
 * - `home`: エディタ中心セル → ダッシュボードカード収束
 * - `open`: ダッシュボードカード → エディタ中心セル拡大
 * - `stock`: エディタ内セル → ストックエントリ収束 (copy/move drop 時) */
export type ConvergeDirection = 'home' | 'open' | 'stock'

type ConvergeState = {
  direction: ConvergeDirection | null
  targetId: string | null
  sourceRect: SourceRect | null
  centerCell: CenterCell | null
  setConverge: (
    direction: ConvergeDirection,
    id: string,
    rect: SourceRect,
    centerCell: CenterCell,
  ) => void
  clear: () => void
}

export const useConvergeStore = create<ConvergeState>((set) => ({
  direction: null,
  targetId: null,
  sourceRect: null,
  centerCell: null,
  setConverge: (direction, id, rect, centerCell) =>
    set({ direction, targetId: id, sourceRect: rect, centerCell }),
  clear: () => set({ direction: null, targetId: null, sourceRect: null, centerCell: null }),
}))
