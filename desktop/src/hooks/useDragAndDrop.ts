import { useState, useCallback, useRef } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction, type DndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, isCenterPosition } from '@/constants/grid'
import { swapCellSubtree, upsertCellAt } from '@/lib/api/cells'
import { query } from '@/lib/db'
import type { UndoOperation } from '@/store/undoStore'

/** D&D 中に表示する 4 アクションアイコン (DragActionPanel) の種別 */
export type ActionDropType = 'shred' | 'move' | 'copy' | 'export'

/**
 * ストック / D&D の drop 先 slot として有効かを (grid_id, position) ベースで判定する。
 *
 * Phase A 後の仕様:
 * - 中心 slot (position=4) は drop ターゲットになれない (どんな source からも禁止)
 * - 周辺 slot:
 *   - cell-to-cell drop: target に既存 cell があれば SWAP_SUBTREE (resolveDndAction で判定)、
 *     空 slot は新規 INSERT 後に SWAP 扱い
 *   - stock-to-cell drop: target が空 / 入力ありどちらも droppable (入力ありは置換確認フローへ)
 * - 周辺 slot は同 grid の中心 cell が populated でないと NG (中心が空のグリッドへの貼付禁止)
 */
function isDroppableSlot(
  gridId: string,
  position: number,
  _existingCell: Cell | undefined,
  allCells: Cell[],
): boolean {
  // 中心 slot は drop 不可 (rule 2)
  if (isCenterPosition(position)) return false
  // peripheral slot: 同 grid の center cell が populated か確認
  // child grid の merged center は grid_id が親 grid のままなので grid_id 一致では拾えないため、
  // fallback として「allCells 内の position=4 を center とみなす」 (3x3 view では 1 つだけ存在)
  const center =
    allCells.find((c) => c.grid_id === gridId && c.position === CENTER_POSITION) ??
    allCells.find((c) => c.position === CENTER_POSITION)
  return center != null && !isCellEmpty(center)
}

export type DndUndoable = UndoOperation & { description: string }

/**
 * D&D アクションを実行し、Undo/Redo 用のクロージャを返す。
 *
 * Phase A 後は SWAP_SUBTREE のみが到達可能 (中心セル絡みは resolveDndAction で NOOP)。
 */
async function executeAction(action: DndAction): Promise<DndUndoable | null> {
  switch (action.type) {
    case 'SWAP_SUBTREE': {
      await swapCellSubtree(action.cellIdA, action.cellIdB)
      const run = () => swapCellSubtree(action.cellIdA, action.cellIdB)
      return { description: 'セルのサブツリー入れ替え', undo: run, redo: run }
    }
    case 'NOOP':
      return null
  }
}

type DragSource =
  | { kind: 'cell'; cell: Cell }
  | { kind: 'stock'; itemId: string }

/**
 * HTML5 DnD の代わりに mousedown/mousemove/mouseup で D&D を実装。
 * Tauri の WebKit では HTML5 DnD の drop イベントが信頼できないため。
 *
 * サポートするソース:
 *  - セル → セル（同一 / 跨ぎ） / 4 アクションアイコン (shred / move / copy / export)
 *  - ストックアイテム → セル (空 → 直接ペースト / 入力あり → 置換確認フロー)
 */
export function useDragAndDrop(
  cells: Cell[],
  onComplete: () => void,
  onStockPaste?: (stockItemId: string, targetCellId: string) => void,
  pushUndo?: (op: DndUndoable) => void,
  /**
   * D&D アクション成功直後に、DB から最新値を取り直した「影響を受けたセル群」を受け取る callback。
   * 既存の `onComplete` (= reloadAll で全体再フェッチ) とは別に、EditorLayout 側で
   * `refreshCell` による局所更新を行うためのフック。
   * reloadAll の全体 re-fetch が reflect されないケース (原因未特定) でも、
   * target セルだけは確実に UI 反映できるようになる。
   */
  onCellsUpdated?: (updated: Cell[]) => void,
  /**
   * ストックアイテムを **入力ありの周辺セル** にドロップしたとき呼ばれる。
   * 呼び出し側で置換確認 dialog を表示し、確認後に既存サブグリッドを破棄して新スナップショットを上書きする。
   */
  onStockReplaceDrop?: (stockItemId: string, targetCellId: string) => void,
  /**
   * セルを 4 アクションアイコン (DragActionPanel) にドロップしたとき呼ばれる。
   * action 別に EditorLayout 側で:
   *  - shred: 確認 dialog → shredCellSubtree
   *  - move: moveCellToStock + (中心セルなら navigate up)
   *  - copy: addToStock
   *  - export: 形式 picker → 各形式で書き出し
   */
  onActionDrop?: (action: ActionDropType, cellId: string) => void,
) {
  const [dragSourceId, setDragSourceId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId]         = useState<string | null>(null)
  const [hoveredAction, setHoveredAction]   = useState<ActionDropType | null>(null)
  const sourceRef = useRef<DragSource | null>(null)
  const cellsRef  = useRef<Cell[]>(cells)
  cellsRef.current = cells

  const beginDrag = useCallback((source: DragSource) => {
    sourceRef.current = source
    setDragSourceId(source.kind === 'cell' ? source.cell.id : `stock:${source.itemId}`)
    document.body.style.cursor = 'grabbing'

    /**
     * mouse 位置から target slot の (gridId, position) を解決する。
     * - 既存 cell の上 (data-cell-id がある) → そこから cell.grid_id, cell.position
     * - 空 placeholder の上 (data-grid-id + data-position) → 直接取得
     * - 該当なし → null
     */
    function resolveTargetSlot(e: MouseEvent): { gridId: string; position: number; existingCell: Cell | null } | null {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      // 既存 cell 優先
      const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null
      if (cellEl?.dataset.cellId) {
        const c = cellsRef.current.find((cc) => cc.id === cellEl.dataset.cellId)
        if (c) return { gridId: c.grid_id, position: c.position, existingCell: c }
      }
      // 空 slot
      const slotEl = el?.closest('[data-grid-id][data-position]') as HTMLElement | null
      if (slotEl?.dataset.gridId && slotEl.dataset.position != null) {
        const gridId = slotEl.dataset.gridId
        const position = Number(slotEl.dataset.position)
        // 念のため: 同 (gridId, position) に既存 cell があるなら拾う
        const existing = cellsRef.current.find((c) => c.grid_id === gridId && c.position === position) ?? null
        return { gridId, position, existingCell: existing }
      }
      return null
    }

    /** mouse 位置から DragActionPanel のアイコン (data-action-drop) を解決する */
    function resolveActionTarget(e: MouseEvent): ActionDropType | null {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const actionEl = el?.closest('[data-action-drop]') as HTMLElement | null
      const v = actionEl?.dataset.actionDrop
      if (v === 'shred' || v === 'move' || v === 'copy' || v === 'export') return v
      return null
    }

    function onMouseMove(e: MouseEvent) {
      const action = resolveActionTarget(e)
      const slot = resolveTargetSlot(e)

      let overCellId: string | null = null
      if (slot) {
        if (slot.existingCell) {
          overCellId = slot.existingCell.id
        } else {
          overCellId = `slot:${slot.gridId}:${slot.position}`
        }
      }

      // ハイライトの drop 可否ゲート
      const src = sourceRef.current
      if (src && slot) {
        if (src.kind === 'cell') {
          // cell-to-cell: 中心セル絡みは無効 (Phase A drop policy)
          if (isCenterPosition(src.cell.position) || isCenterPosition(slot.position)) {
            overCellId = null
          }
        } else {
          // stock-to-cell: isDroppableSlot で中心 / 中心が空のグリッドを除外
          if (!isDroppableSlot(slot.gridId, slot.position, slot.existingCell ?? undefined, cellsRef.current)) {
            overCellId = null
          }
        }
      }

      // アクションアイコン上にいるときはセル側のハイライトをクリア
      if (action) overCellId = null

      setDragOverId(overCellId)
      // アクションは cell ソース時のみ有効 (stock ソースはアイコン非対応)
      setHoveredAction(src?.kind === 'cell' ? action : null)
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''

      const src = sourceRef.current
      sourceRef.current = null
      setDragSourceId(null)
      setDragOverId(null)
      setHoveredAction(null)

      if (!src) return

      const action = resolveActionTarget(e)
      const slot   = resolveTargetSlot(e)

      if (src.kind === 'cell') {
        // 4 アクションアイコンへの drop が最優先
        if (action) {
          onActionDrop?.(action, src.cell.id)
          return
        }
        // セル間 D&D
        if (!slot) return
        if (slot.existingCell?.id === src.cell.id) return  // 自分自身

        // Phase A drop policy: 中心セル絡みの cell-to-cell は禁止
        if (isCenterPosition(src.cell.position) || isCenterPosition(slot.position)) return

        // target cell が無ければ INSERT して確保 (空 slot に drop されたケース)
        ;(async () => {
          let target = slot.existingCell
          if (!target) {
            target = await upsertCellAt(slot.gridId, slot.position, {})
          }
          const dndAction = resolveDndAction(src.cell, target)
          if (dndAction.type === 'NOOP') return
          const undoable = await executeAction(dndAction)
          if (undoable && pushUndo) pushUndo(undoable)
          if (onCellsUpdated) {
            const affectedIds: string[] = [dndAction.cellIdA, dndAction.cellIdB]
            const ph = affectedIds.map(() => '?').join(',')
            const updated = await query<Cell>(
              `SELECT * FROM cells WHERE id IN (${ph}) AND deleted_at IS NULL`,
              affectedIds,
            )
            onCellsUpdated(updated)
          } else {
            onComplete()
          }
        })().catch(console.error)
      } else {
        // ストック → セル: 中心 / 中心が空のグリッドを除外。入力ありは置換確認フロー。
        if (!slot) return
        if (!isDroppableSlot(slot.gridId, slot.position, slot.existingCell ?? undefined, cellsRef.current)) return
        ;(async () => {
          const existing = slot.existingCell
          if (existing && !isCellEmpty(existing)) {
            // 入力ありの周辺セル: 置換確認フローを呼ぶ
            onStockReplaceDrop?.(src.itemId, existing.id)
            return
          }
          let target = existing
          if (!target) {
            target = await upsertCellAt(slot.gridId, slot.position, {})
          }
          onStockPaste?.(src.itemId, target.id)
        })().catch(console.error)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockPaste, pushUndo, onCellsUpdated, onStockReplaceDrop, onActionDrop])

  const handleDragStart = useCallback(
    (cell: Cell) => beginDrag({ kind: 'cell', cell }),
    [beginDrag],
  )
  const handleStockItemDragStart = useCallback(
    (itemId: string) => beginDrag({ kind: 'stock', itemId }),
    [beginDrag],
  )

  return {
    dragSourceId,
    dragOverId,
    hoveredAction,
    isDragging: dragSourceId !== null,
    handleDragStart,
    handleStockItemDragStart,
  }
}
