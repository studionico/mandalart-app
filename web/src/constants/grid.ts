/**
 * マンダラートの 3×3 グリッド構造に関する定数。
 *
 * セルナンバリング (`cells.position`、0-indexed):
 * ```
 *   0 | 1 | 2
 *   3 | 4 | 5    ← 4 = 中央 (テーマセル)
 *   6 | 7 | 8
 * ```
 *
 * 「中心 position = 4」「9 セルのうち 1 つが中心」等の仕様はプロジェクト全体で共通のため、
 * 裸の数値ではなくこのファイルの定数を参照する。
 */

/** 3×3 グリッドの 1 辺のセル数 */
export const GRID_SIDE = 3

/** 3×3 グリッドの総セル数 */
export const GRID_CELL_COUNT = 9

/** 中央セルの position (0-indexed) */
export const CENTER_POSITION = 4

/** 周辺セルの position 一覧 (position 0〜8 から中央 4 を除外、小さい順) */
export const PERIPHERAL_POSITIONS: readonly number[] = [0, 1, 2, 3, 5, 6, 7, 8]

/**
 * Orbit 系アニメーションの登場順 (0-indexed の position)。
 * 「左下 (7) 始まりで時計回りに外周を一周」という規則で統一している:
 *  - 7 (下中) → 6 (左下) → 3 (左中) → 0 (左上) → 1 (上中) → 2 (右上) → 5 (右中) → 8 (右下)
 *
 * 3 バリエーション:
 *  - PERIPHERAL: 周辺 8 のみ。drill-down / to-9x9 の周辺 fade-in で使う (中心は別扱い)
 *  - PERIPHERAL_THEN_CENTER: 周辺 8 → 中央。drill-up / to-3x3 で使う (中心は最後)
 *  - CENTER_THEN_PERIPHERAL: 中央 → 周辺 8。initial (ダッシュボードから開いた直後) で使う
 *
 * `readonly number[]` にしているのは `arr.indexOf(pos: number)` を自然に通すため
 * (`as const` だと厳密 literal union になって indexOf が通らない)。
 */
export const ORBIT_ORDER_PERIPHERAL: readonly number[] = [7, 6, 3, 0, 1, 2, 5, 8]
export const ORBIT_ORDER_PERIPHERAL_THEN_CENTER: readonly number[] = [7, 6, 3, 0, 1, 2, 5, 8, 4]
export const ORBIT_ORDER_CENTER_THEN_PERIPHERAL: readonly number[] = [4, 7, 6, 3, 0, 1, 2, 5, 8]

/** position が中央かどうか */
export function isCenterPosition(position: number): boolean {
  return position === CENTER_POSITION
}
