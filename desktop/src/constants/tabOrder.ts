import { ORBIT_ORDER_CENTER_THEN_PERIPHERAL } from './grid'

// Tab 移動順 (0-indexed、DB の cells.position と一致)
// 中心 4 から時計回りに外周を一周して 4 に戻る。
//   4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4
// 中央セル (4) が空のときは peripherals が disabled なので Tab は留まる。
// インポート時の周辺セル配置順もこの列から中心を抜いたものを使用する。
//
// Orbit 系アニメの `initial` 順 (中央 → 周辺時計回り) と同じ並びなので
// `ORBIT_ORDER_CENTER_THEN_PERIPHERAL` を再利用する。
export const TAB_ORDER: readonly number[] = ORBIT_ORDER_CENTER_THEN_PERIPHERAL

// Shift+Tab の逆順
export const TAB_ORDER_REVERSE: readonly number[] = [...TAB_ORDER].reverse()

// position から次の Tab 先 position を返す
export function nextTabPosition(current: number, reverse = false): number {
  const order = reverse ? TAB_ORDER_REVERSE : TAB_ORDER
  const idx = order.indexOf(current)
  return order[(idx + 1) % order.length]
}
