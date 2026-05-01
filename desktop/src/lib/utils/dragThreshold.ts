/**
 * Tauri WebKit の HTML5 D&D 不能対策 (落とし穴 #1) として mousedown ベースで自前 D&D を
 * 組むときの「動いたら drag 確定 / 動かなければ click」判定を共通化する utility。
 *
 * Cell.tsx / StockTab.tsx / useDashboardDnd.ts の 3 箇所で hand-roll されていた
 * 「mousedown 時に startX/Y 記録 → document mousemove で 5px 超過判定 → 確定で onStart」
 * の listener 配線を集約。計算式も `dx² + dy² >= threshold²` (平方根回避) に統一。
 */

/** 自前 D&D の drag 確定距離 (px)。これ未満の移動は click と判定。 */
export const DRAG_THRESHOLD_PX = 5

/**
 * mousedown ハンドラ内から呼び、document に mousemove / mouseup を一時登録する。
 *
 * - 移動距離が threshold を超えたら listener を解除して `onStart` を呼ぶ
 * - mouseup まで届かなかったら listener を解除して `onCancel` を呼ぶ (= click だった)
 *
 * @example
 * ```ts
 * function handleMouseDown(e: React.MouseEvent) {
 *   if (e.button !== 0) return
 *   trackDragThreshold(e, () => onDragStart?.(item))
 * }
 * ```
 */
export function trackDragThreshold(
  e: { clientX: number; clientY: number },
  onStart: () => void,
  options?: { onCancel?: () => void; threshold?: number },
): void {
  const startX = e.clientX
  const startY = e.clientY
  const threshold = options?.threshold ?? DRAG_THRESHOLD_PX
  const thresholdSq = threshold * threshold

  function cleanup() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  function onMove(ev: MouseEvent) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (dx * dx + dy * dy >= thresholdSq) {
      cleanup()
      onStart()
    }
  }
  function onUp() {
    cleanup()
    options?.onCancel?.()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
