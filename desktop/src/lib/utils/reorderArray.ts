/**
 * 配列内の要素を src 位置から target 位置に移動した新配列を返す (pure function)。
 *
 * Drag-and-drop の典型 UX を再現する semantics: **drop した位置に source が居座り、
 * 他の要素は前後にシフトする**。例: `[A, B, C]` で A を B の位置 (target=1) に drop
 * → `[B, A, C]` (隣接 swap)。
 *
 * 計算式は `splice(src, 1)` で source を取り出した後の配列に対して `splice(target, 0, moved)`
 * を適用するだけのシンプル形。`src < target` のときに `target - 1` 補正をかけると隣接
 * swap が no-op になるため補正なし。
 *
 * - `srcIdx === targetIdx`: no-op (元配列のコピーを返す)
 * - `srcIdx` 範囲外: no-op
 * - `targetIdx >= length`: 末尾 append (JS splice の自然挙動)
 *
 * 用途: ダッシュボードの card-to-card D&D で `sort_order` を入れ替える前段の配列計算。
 */
export function reorderArray<T>(
  arr: readonly T[],
  srcIdx: number,
  targetIdx: number,
): T[] {
  if (srcIdx < 0 || srcIdx >= arr.length) return [...arr]
  if (srcIdx === targetIdx) return [...arr]
  const next = [...arr]
  const [moved] = next.splice(srcIdx, 1)
  next.splice(targetIdx, 0, moved)
  return next
}
