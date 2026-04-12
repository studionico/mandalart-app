
import { useEffect } from 'react'
import { subscribeToCells, subscribeToGrids, unsubscribe } from '@/lib/realtime'
import type { Cell, Grid } from '@/types'

export function useRealtime(
  mandalartId: string | null,
  onCellUpdate: (cell: Cell) => void,
  onCellInsert: (cell: Cell) => void,
  _onCellDelete: (cellId: string) => void,
  onGridChange: (grid: Grid) => void,
) {
  useEffect(() => {
    if (!mandalartId) return

    const cellChannel = subscribeToCells(mandalartId, onCellInsert, onCellUpdate)
    const gridChannel = subscribeToGrids(mandalartId, onGridChange, onGridChange)

    return () => {
      unsubscribe(cellChannel)
      unsubscribe(gridChannel)
    }
  }, [mandalartId]) // eslint-disable-line react-hooks/exhaustive-deps
}
