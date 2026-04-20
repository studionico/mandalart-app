import { useState, useCallback, useRef } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction, type DndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, isCenterPosition } from '@/constants/grid'
import { swapCellContent, swapCellSubtree, copyCellSubtree, upsertCellAt } from '@/lib/api/cells'
import { query, execute, now } from '@/lib/db'
import type { UndoOperation } from '@/store/undoStore'

/**
 * ストック / D&D の drop 先 slot として有効かを (grid_id, position) ベースで判定する。
 *
 * 新設計: 空 slot は cell 行が存在しない可能性がある。
 * - target slot に既存 cell がある → そのセルが空である必要 (populated cell は drop 先不可)
 * - target slot に cell が無い (= 完全に空 slot) → 常に空扱いで OK
 * - 中心 slot (position 4) 自体は常に OK
 * - 周辺 slot は、同 grid の中心 cell が populated でないと NG
 */
function isDroppableSlot(
  gridId: string,
  position: number,
  existingCell: Cell | undefined,
  allCells: Cell[],
): boolean {
  // 既存 cell がある場合: populated なら drop 不可
  if (existingCell && !isCellEmpty(existingCell)) return false
  // center slot は常に OK
  if (isCenterPosition(position)) return true
  // peripheral slot: 同 grid の center cell が populated か確認。
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
 * - SWAP_SUBTREE / SWAP_CONTENT は対称操作なので undo = redo = 同じ呼び出し。
 * - COPY_SUBTREE は target の事前状態 + 新規作成された grid ID を記録し、
 *   undo でそれらを削除・復元する。
 */
async function executeAction(action: DndAction): Promise<DndUndoable | null> {
  switch (action.type) {
    case 'SWAP_SUBTREE': {
      await swapCellSubtree(action.cellIdA, action.cellIdB)
      const run = () => swapCellSubtree(action.cellIdA, action.cellIdB)
      return { description: 'セルのサブツリー入れ替え', undo: run, redo: run }
    }
    case 'SWAP_CONTENT': {
      await swapCellContent(action.cellIdA, action.cellIdB)
      const run = () => swapCellContent(action.cellIdA, action.cellIdB)
      return { description: 'セル内容の入れ替え', undo: run, redo: run }
    }
    case 'COPY_SUBTREE': {
      const targetBefore = (await query<{ text: string; image_path: string | null; color: string | null }>(
        'SELECT text, image_path, color FROM cells WHERE id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      ))[0]
      const gridsBefore = await query<{ id: string }>(
        'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      )
      const beforeIds = new Set(gridsBefore.map((g) => g.id))

      await copyCellSubtree(action.sourceCellId, action.targetCellId)

      const gridsAfter = await query<{ id: string }>(
        'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      )
      const newGridIds = gridsAfter.filter((g) => !beforeIds.has(g.id)).map((g) => g.id)

      return {
        description: 'セル階層のコピー',
        undo: async () => {
          await execute(
            'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
            [targetBefore?.text ?? '', targetBefore?.image_path ?? null, targetBefore?.color ?? null, now(), action.targetCellId],
          )
          for (const id of newGridIds) {
            await execute('DELETE FROM grids WHERE id = ?', [id])
          }
        },
        redo: async () => {
          await copyCellSubtree(action.sourceCellId, action.targetCellId)
        },
      }
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
 *  - セル → セル（同一 / 跨ぎ） / ストック
 *  - ストックアイテム → セル
 */
export function useDragAndDrop(
  cells: Cell[],
  onComplete: () => void,
  onStockDrop?: (cellId: string) => void,
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
) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId]     = useState<string | null>(null)
  const [isOverStock, setIsOverStock]   = useState(false)
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

    function onMouseMove(e: MouseEvent) {
      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null

      const slot = resolveTargetSlot(e)
      let overCellId: string | null = null
      if (slot) {
        // 既存 cell があるならハイライトはその id
        if (slot.existingCell) {
          overCellId = slot.existingCell.id
        } else {
          // 空 slot ハイライト用: 仮 id (grid_id:position)
          overCellId = `slot:${slot.gridId}:${slot.position}`
        }
      }

      // ストック → スロット: 空 + 中心セルが非空の場合のみ有効なドロップ先としてハイライト
      if (sourceRef.current?.kind === 'stock' && slot) {
        if (!isDroppableSlot(slot.gridId, slot.position, slot.existingCell ?? undefined, cellsRef.current)) {
          overCellId = null
        }
      }

      setDragOverId(overCellId)
      setIsOverStock(!!stockEl)
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''

      const src = sourceRef.current
      sourceRef.current = null
      setDragSourceId(null)
      setDragOverId(null)
      setIsOverStock(false)

      if (!src) return

      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null
      const slot    = resolveTargetSlot(e)

      if (src.kind === 'cell') {
        // ストックドロップゾーン
        if (stockEl) {
          onStockDrop?.(src.cell.id)
          return
        }
        // セル間 D&D
        if (!slot) return
        if (slot.existingCell?.id === src.cell.id) return  // 自分自身

        // target cell が無ければ INSERT して確保 (空 slot に drop されたケース)
        ;(async () => {
          let target = slot.existingCell
          if (!target) {
            target = await upsertCellAt(slot.gridId, slot.position, {})
          }
          const action = resolveDndAction(src.cell, target)
          if (action.type === 'NOOP') return
          const undoable = await executeAction(action)
          if (undoable && pushUndo) pushUndo(undoable)
          if (onCellsUpdated) {
            const affectedIds: string[] =
              action.type === 'COPY_SUBTREE'
                ? [action.targetCellId]
                : [action.cellIdA, action.cellIdB]
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
        // ストック → セル: 空セル + 中心セルが非空の場合のみ許可（入れ替えなし）
        if (!slot) return
        if (!isDroppableSlot(slot.gridId, slot.position, slot.existingCell ?? undefined, cellsRef.current)) return
        ;(async () => {
          let target = slot.existingCell
          if (!target) {
            target = await upsertCellAt(slot.gridId, slot.position, {})
          }
          onStockPaste?.(src.itemId, target.id)
        })().catch(console.error)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockDrop, onStockPaste, pushUndo, onCellsUpdated])

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
    isOverStock,
    isDragging: dragSourceId !== null,
    handleDragStart,
    handleStockItemDragStart,
  }
}
