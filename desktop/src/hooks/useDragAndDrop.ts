import { useState, useCallback, useRef } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { swapCellContent, swapCellSubtree, copyCellSubtree } from '@/lib/api/cells'

async function executeAction(action: ReturnType<typeof resolveDndAction>) {
  switch (action.type) {
    case 'SWAP_SUBTREE':
      await swapCellSubtree(action.cellIdA, action.cellIdB)
      break
    case 'SWAP_CONTENT':
      await swapCellContent(action.cellIdA, action.cellIdB)
      break
    case 'COPY_SUBTREE':
      await copyCellSubtree(action.sourceCellId, action.targetCellId)
      break
    case 'NOOP':
      break
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

      // ストック → セル: 空セルのみ有効なドロップ先としてハイライト
      if (sourceRef.current?.kind === 'stock' && overCellId) {
        const t = cellsRef.current.find((c) => c.id === overCellId)
        if (!t || !isCellEmpty(t)) overCellId = null
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
          executeAction(action).then(() => onComplete()).catch(console.error)
        }
      } else {
        // ストック → セル: 空セルのみ許可（入れ替えなし）
        if (!targetId) return
        const target = cellsRef.current.find((c) => c.id === targetId)
        if (!target || !isCellEmpty(target)) return
        onStockPaste?.(src.itemId, targetId)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockDrop, onStockPaste])

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
