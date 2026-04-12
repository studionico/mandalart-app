'use client'

import { useState, useCallback } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction } from '@/lib/utils/dnd'
import { swapCellContent, swapCellSubtree, copyCellSubtree } from '@/lib/api/cells'

export function useDragAndDrop(onComplete: () => void) {
  const [dragSource, setDragSource] = useState<Cell | null>(null)

  const handleDragStart = useCallback((cell: Cell) => {
    setDragSource(cell)
  }, [])

  const handleDrop = useCallback(
    async (target: Cell) => {
      if (!dragSource) return
      setDragSource(null)

      const action = resolveDndAction(dragSource, target)
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
          return
      }

      onComplete()
    },
    [dragSource, onComplete],
  )

  return { dragSource, handleDragStart, handleDrop }
}
