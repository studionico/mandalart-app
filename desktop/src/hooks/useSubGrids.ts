
import { useState, useEffect, useCallback } from 'react'
import { getChildGrids, getGrid } from '@/lib/api/grids'
import type { Cell, Grid } from '@/types'

export type SubGridData = {
  grid: Grid
  cells: Cell[]
  parentPosition: number
}

/**
 * ルートグリッドの各セルの子グリッドを一括取得する。
 * 9×9 表示に使用。
 */
export function useSubGrids(rootCells: Cell[]) {
  const [subGrids, setSubGrids] = useState<Map<string, SubGridData>>(new Map())

  const load = useCallback(async () => {
    const map = new Map<string, SubGridData>()
    await Promise.all(
      rootCells.map(async (cell) => {
        const children = await getChildGrids(cell.id)
        if (children.length > 0) {
          const first = await getGrid(children[0].id)
          map.set(cell.id, {
            grid: first,
            cells: first.cells,
            parentPosition: cell.position,
          })
        }
      }),
    )
    setSubGrids(map)
  }, [rootCells])

  useEffect(() => {
    if (rootCells.length > 0) load()
  }, [load, rootCells])

  return { subGrids, reload: load }
}
