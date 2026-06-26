
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { CENTER_POSITION } from '@/constants/grid'
import type { Cell, Grid } from '@/types'

export type SubGridData = {
  grid: Grid
  cells: Cell[]
  parentPosition: number
}

/**
 * ルートグリッドの各セルの子グリッドを一括取得する。9×9 表示 / orbit アニメ等で使用。
 * web 版: SQLite の JOIN クエリを Supabase 2 クエリに置き換え。
 */
export function useSubGrids(rootCells: Cell[]) {
  const [subGrids, setSubGrids] = useState<Map<string, SubGridData>>(new Map())

  const load = useCallback(async () => {
    if (rootCells.length === 0) {
      setSubGrids(new Map())
      return
    }

    const rootCellIds = rootCells.map((c) => c.id)

    // 1. 各 rootCell を parent_cell_id に持つ子グリッドを一括取得
    const { data: allChildGridsData } = await supabase
      .from('grids')
      .select('*')
      .in('parent_cell_id', rootCellIds)
      .is('deleted_at', null)
      .order('sort_order')

    const allChildGrids = (allChildGridsData ?? []) as Grid[]

    // 各 rootCell に対する「最初の子グリッド」(sort_order 最小) を選出
    const firstChildByCellId = new Map<string, Grid>()
    for (const g of allChildGrids) {
      const key = g.center_cell_id
      if (!firstChildByCellId.has(key)) {
        firstChildByCellId.set(key, g)
      }
    }

    if (firstChildByCellId.size === 0) {
      setSubGrids(new Map())
      return
    }

    // 2. 各 first child grid の cells を一括取得
    const firstChildIds = Array.from(firstChildByCellId.values()).map((g) => g.id)
    const { data: allSubCellsData } = await supabase
      .from('cells')
      .select('*')
      .in('grid_id', firstChildIds)
      .is('deleted_at', null)
      .order('position')

    const allSubCells = (allSubCellsData ?? []) as Cell[]
    const cellsByGridId = new Map<string, Cell[]>()
    for (const c of allSubCells) {
      const arr = cellsByGridId.get(c.grid_id) ?? []
      arr.push(c)
      cellsByGridId.set(c.grid_id, arr)
    }

    // 3. center cell が ownCells に居ない場合は rootCell を merge (position=CENTER_POSITION に上書き)
    const map = new Map<string, SubGridData>()
    for (const [cellId, grid] of firstChildByCellId.entries()) {
      const parentCell = rootCells.find((c) => c.id === cellId)
      if (!parentCell) continue
      const ownCells = cellsByGridId.get(grid.id) ?? []
      const hasOwnCenter = ownCells.some((c) => c.position === CENTER_POSITION)
      const merged = hasOwnCenter
        ? ownCells
        : [...ownCells, { ...parentCell, position: CENTER_POSITION }]
      merged.sort((a, b) => a.position - b.position)
      map.set(cellId, {
        grid,
        cells: merged,
        parentPosition: parentCell.position,
      })
    }
    setSubGrids(map)
  }, [rootCells])

  useEffect(() => {
    if (rootCells.length > 0) load()
  }, [load, rootCells])

  return { subGrids, reload: load, setSubGrids }
}
