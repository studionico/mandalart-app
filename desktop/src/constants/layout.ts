/**
 * レイアウト関連の定数 (px)。Tailwind の任意値クラス (`w-[130px]` 等) と JS 側の
 * 計算が意味のある同じ値を指すときに、片方だけ変更して整合性を崩さないために集約する。
 *
 * Tailwind のプリセット (gap-2 / p-3 等) と対応している数値には注釈で元クラスを記載する。
 */

// --- エディタのグリッドエリア ---

/** エディタ 3×3 / 9×9 のアウターグリッドの gap (px、Tailwind `gap-2`)。
 *
 * **重要**: [`index.css`](../index.css) の CSS 変数 `--outer-grid-gap` と一致させること。
 * 片方だけ変更するとアニメーション keyframes の「1 セル移動量」計算がずれる。 */
export const OUTER_GRID_GAP_PX = 8

/** グリッドエリア 全体のパディング + 並列ナビボタンまでの gap (px、Tailwind `gap-4`)。 */
export const GRID_AREA_GAP_PX = 16

/** 並列ナビボタン (`<` `>` `+`) の 1 辺 (px、Tailwind `w-12 h-12`)。 */
export const PARALLEL_NAV_BUTTON_PX = 48

/**
 * グリッド描画エリアの幅から差し引く「左右の並列ナビボタン分」(px)。
 * 2 * (ボタン幅 + 左右それぞれの gap)。
 */
export const SIDE_BUTTON_RESERVE_PX =
  2 * (PARALLEL_NAV_BUTTON_PX + GRID_AREA_GAP_PX)

// --- セルのタイポグラフィ・余白 ---

/** セルの基準フォントサイズ (px、3×3 モード = `size='normal'`)。
 * 9×9 モード (`size='small'`) ではこの 1/3 をベースに `fontScale` を掛ける。 */
export const CELL_BASE_FONT_PX = 28

/** セル外縁からテキストまでの目標余白 (px) — 3×3 モード */
export const CELL_TEXT_INSET_NORMAL_PX = 18
/** セル外縁からテキストまでの目標余白 (px) — 9×9 モード */
export const CELL_TEXT_INSET_SMALL_PX = 6

// --- ResizeObserver の微振動吸収 ---

/**
 * ResizeObserver が返す幅/高さの変化を無視する閾値 (px)。
 * scrollbar の出し入れや breadcrumb 高さのわずかな変動を拾って gridSize が
 * 1〜3px ずれるのを防ぐため、この値未満の差分はスキップする。
 */
export const GRID_SIZE_CHANGE_THRESHOLD_PX = 4

// --- ダッシュボード ---

/** ダッシュボードカードの 1 辺 (px)。
 *
 * カードは「中心セル (3×3 normal、~278px 角) を縮小したもの」として設計しており、
 * スケール比 ≈ 130/278 ≈ 0.47 をベースに以下の値が決まっている。 */
export const DASHBOARD_CARD_SIZE_PX = 130

/** ダッシュボードカードのタイトル表示のフォントサイズ (px)。
 * 中心セル `CELL_BASE_FONT_PX = 28` を ~0.47 縮小した 13.2 → 14 に丸めた値。 */
export const DASHBOARD_CARD_FONT_PX = 14

/** ダッシュボードカードの黒枠の太さ (px)。
 * 中心セル `border-[6px]` を ~0.47 縮小した 2.8 → 3 に丸めた値。 */
export const DASHBOARD_CARD_BORDER_PX = 3

/** ダッシュボードカード外縁からテキストまでの余白 (px、border-box 内側起算)。
 * 中心セルの実 inset (`CELL_TEXT_INSET_NORMAL_PX - border 6px = 12px`) を
 * ~0.47 縮小した 5.6 → 6 に丸めた値。 */
export const DASHBOARD_CARD_INSET_PX = 6
