import type { Cell } from '@/types'
import { isCenterPosition } from '@/constants/grid'

export type DndAction =
  | { type: 'SWAP_SUBTREE'; cellIdA: string; cellIdB: string }
  | { type: 'NOOP' }

/**
 * D&D ルール判定 (Phase A: drop policy 厳格化後)
 *
 * source: ドラッグ元セル
 * target: ドロップ先セル
 *
 * ルール:
 * - 中心セルは drop ターゲットになれない (どんな source からも) → NOOP
 * - 中心セルからの cell-to-cell drop は禁止 (4 アクションアイコン経由のみ) → NOOP
 * - 周辺 → 周辺 のみ SWAP_SUBTREE で許可
 *
 * 旧来の SWAP_CONTENT / COPY_SUBTREE 経路 (中心セル絡み) は本ポリシーで全面廃止し、
 * 中心セルへの操作は「アクションアイコン (シュレッダー/移動/コピー/エクスポート)」に集約する。
 */
export function resolveDndAction(source: Cell, target: Cell): DndAction {
  if (source.id === target.id) return { type: 'NOOP' }
  if (isCenterPosition(source.position)) return { type: 'NOOP' }
  if (isCenterPosition(target.position)) return { type: 'NOOP' }
  return { type: 'SWAP_SUBTREE', cellIdA: source.id, cellIdB: target.id }
}
