import type { Cell } from '@/types'
import { isCellEmpty } from './grid'

export type DndAction =
  | { type: 'SWAP_SUBTREE'; cellIdA: string; cellIdB: string }
  | { type: 'SWAP_CONTENT'; cellIdA: string; cellIdB: string }
  | { type: 'COPY_SUBTREE'; sourceCellId: string; targetCellId: string }
  | { type: 'NOOP' }

/**
 * D&D ルール判定
 * source: ドラッグ元セル
 * target: ドロップ先セル
 */
export function resolveDndAction(source: Cell, target: Cell): DndAction {
  if (source.id === target.id) return { type: 'NOOP' }

  const sourceIsCenter = source.position === 4
  const targetIsCenter = target.position === 4
  const sourceEmpty = isCellEmpty(source)
  const targetEmpty = isCellEmpty(target)

  // 周辺 → 周辺: サブツリーごと入れ替え
  if (!sourceIsCenter && !targetIsCenter) {
    return { type: 'SWAP_SUBTREE', cellIdA: source.id, cellIdB: target.id }
  }

  // 中心 → 入力ある周辺: 内容のみ入れ替え
  if (sourceIsCenter && !targetIsCenter && !targetEmpty) {
    return { type: 'SWAP_CONTENT', cellIdA: source.id, cellIdB: target.id }
  }

  // 中心 → 空の周辺: 階層全体をコピー
  if (sourceIsCenter && !targetIsCenter && targetEmpty) {
    return { type: 'COPY_SUBTREE', sourceCellId: source.id, targetCellId: target.id }
  }

  // 入力ある周辺 → 中心: 内容のみ入れ替え
  if (!sourceIsCenter && targetIsCenter && !sourceEmpty) {
    return { type: 'SWAP_CONTENT', cellIdA: source.id, cellIdB: target.id }
  }

  // 空の周辺 → 中心: 何もしない
  if (!sourceIsCenter && targetIsCenter && sourceEmpty) {
    return { type: 'NOOP' }
  }

  return { type: 'NOOP' }
}
