import { useState, useCallback, useRef } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction, type DndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, isCenterPosition } from '@/constants/grid'
import { swapCellContent, swapCellSubtree, copyCellSubtree } from '@/lib/api/cells'
import { query, execute, now } from '@/lib/db'
import type { UndoOperation } from '@/store/undoStore'

/**
 * ストックからのドロップ先として有効かどうかを判定する。
 * - セルが空でなければ不可 (既存ルール: 空セルのみ受け入れ)
 * - 中心セル (position 4) 自体は常に OK
 * - 周辺セルは、同一グリッドの中心セルが非空の場合のみ OK
 *   (中心セルが空 → 周辺は disabled、という入力バリデーションルール)
 */
function isDroppableTarget(cell: Cell, allCells: Cell[]): boolean {
  if (!isCellEmpty(cell)) return false
  if (isCenterPosition(cell.position)) return true
  const center = allCells.find(
    (c) => c.grid_id === cell.grid_id && c.position === CENTER_POSITION,
  )
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
        'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      )
      const beforeIds = new Set(gridsBefore.map((g) => g.id))

      await copyCellSubtree(action.sourceCellId, action.targetCellId)

      const gridsAfter = await query<{ id: string }>(
        'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
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

    function onMouseMove(e: MouseEvent) {
      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const cellEl  = el?.closest('[data-cell-id]') as HTMLElement | null
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null
      let overCellId: string | null = cellEl?.dataset.cellId ?? null

      // ストック → セル: 空セル + 中心セルが非空の場合のみ有効なドロップ先としてハイライト
      if (sourceRef.current?.kind === 'stock' && overCellId) {
        const t = cellsRef.current.find((c) => c.id === overCellId)
        if (!t || !isDroppableTarget(t, cellsRef.current)) overCellId = null
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
      const cellEl  = el?.closest('[data-cell-id]') as HTMLElement | null
      const targetId = cellEl?.dataset.cellId ?? null

      if (src.kind === 'cell') {
        // ストックドロップゾーン
        if (stockEl) {
          onStockDrop?.(src.cell.id)
          return
        }
        // セル間 D&D
        if (!targetId || targetId === src.cell.id) return
        const target = cellsRef.current.find((c) => c.id === targetId)
        if (!target) return
        const action = resolveDndAction(src.cell, target)
        if (action.type !== 'NOOP') {
          executeAction(action)
            .then((undoable) => {
              if (undoable && pushUndo) pushUndo(undoable)
              onComplete()
            })
            .catch(console.error)
        }
      } else {
        // ストック → セル: 空セル + 中心セルが非空の場合のみ許可（入れ替えなし）
        if (!targetId) return
        const target = cellsRef.current.find((c) => c.id === targetId)
        if (!target || !isDroppableTarget(target, cellsRef.current)) return
        onStockPaste?.(src.itemId, targetId)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockDrop, onStockPaste, pushUndo])

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
