import { useState, useCallback, useRef } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction } from '@/lib/utils/dnd'
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

/**
 * HTML5 DnD の代わりに mousedown/mousemove/mouseup で D&D を実装。
 * Tauri の WebKit では HTML5 DnD の drop イベントが信頼できないため。
 */
export function useDragAndDrop(
  cells: Cell[],
  onComplete: () => void,
  onStockDrop?: (cellId: string) => void,
) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId]     = useState<string | null>(null)
  const [isOverStock, setIsOverStock]   = useState(false)
  const dragSourceRef = useRef<Cell | null>(null)
  const cellsRef      = useRef<Cell[]>(cells)
  cellsRef.current = cells

  /**
   * Cell の onMouseDown から呼ばれる。
   * ドラッグ開始後、グローバルの mousemove / mouseup を監視して
   * ドロップ先を elementFromPoint で特定する。
   */
  const handleDragStart = useCallback((cell: Cell) => {
    dragSourceRef.current = cell
    setDragSourceId(cell.id)
    document.body.style.cursor = 'grabbing'

    function onMouseMove(e: MouseEvent) {
      const el       = document.elementFromPoint(e.clientX, e.clientY)
      const cellEl   = el?.closest('[data-cell-id]') as HTMLElement | null
      const stockEl  = el?.closest('[data-stock-drop]') as HTMLElement | null
      setDragOverId(cellEl?.dataset.cellId ?? null)
      setIsOverStock(!!stockEl)
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''

      const source = dragSourceRef.current
      dragSourceRef.current = null
      setDragSourceId(null)
      setDragOverId(null)
      setIsOverStock(false)

      if (!source) return

      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null
      if (stockEl) {
        onStockDrop?.(source.id)
        return
      }

      const cellEl   = el?.closest('[data-cell-id]') as HTMLElement | null
      const targetId = cellEl?.dataset.cellId
      if (!targetId || targetId === source.id) return

      const target = cellsRef.current.find(c => c.id === targetId)
      if (!target) return

      const action = resolveDndAction(source, target)
      if (action.type !== 'NOOP') {
        executeAction(action).then(() => onComplete()).catch(console.error)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockDrop])

  return {
    dragSourceId,
    dragOverId,
    isOverStock,
    isDragging: dragSourceId !== null,
    handleDragStart,
  }
}
