// Tab 移動順（position ベース、0-indexed）
// ラベル表記: 5→8→7→4→1→2→3→6→9 （1-indexed）
// position: 4→7→6→3→0→1→2→5→8 （0-indexed）
export const TAB_ORDER: number[] = [4, 7, 6, 3, 0, 1, 2, 5, 8]

// Shift+Tab の逆順
export const TAB_ORDER_REVERSE: number[] = [...TAB_ORDER].reverse()

// position から次の Tab 先 position を返す
export function nextTabPosition(current: number, reverse = false): number {
  const order = reverse ? TAB_ORDER_REVERSE : TAB_ORDER
  const idx = order.indexOf(current)
  return order[(idx + 1) % order.length]
}
