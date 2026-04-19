
import { useState, useEffect, useCallback } from 'react'
import { query } from '@/lib/db'
import { CENTER_POSITION } from '@/constants/grid'
import type { Cell, Grid } from '@/types'

export type SubGridData = {
  grid: Grid
  cells: Cell[]
  parentPosition: number
}

/**
 * ルートグリッドの各セルの子グリッドを一括取得する。9×9 表示 / orbit アニメ等で使用。
 *
 * 以前は per-cell で `getChildGrids` → `getGrid` を呼び出していた (Promise.all だが中身は
 * 逐次 await なので実質 N+1)。root 9 cells すべてに subGrid がある場合 ~27 往復。
 * この load は refreshCell / reload の度に rootCells 参照が変わって発火するため、
 * D&D drop 直後の体感遅延の主因となっていた。
 *
 * ここでは下記 2 クエリに集約して **27 往復 → 2 往復** に削減する:
 * 1. 全 rootCells を center とする grids を一括 SELECT (先頭 = first child = sort_order 最小)
 * 2. 各 "first child grid" に属する cells を `grid_id IN (...)` で一括 SELECT
 * 子 grid は自身に center 行を持たないため、親 (rootCells) から merge して 9 要素にする。
 */
export function useSubGrids(rootCells: Cell[]) {
  const [subGrids, setSubGrids] = useState<Map<string, SubGridData>>(new Map())

  const load = useCallback(async () => {
    if (rootCells.length === 0) {
      setSubGrids(new Map())
      return
    }

    const rootCellIds = rootCells.map((c) => c.id)
    const cellPh = rootCellIds.map(() => '?').join(',')

    // 1. 全 rootCells を center とする grids を一括取得 (自己参照 = その grid 自身の center が
    //    同じ grid に属するケース = root grid の中心セル行 を除外するために id != parent_grid_id)
    const allChildGrids = await query<Grid & { parent_grid_id: string }>(
      `SELECT g.*, c.grid_id AS parent_grid_id
       FROM grids g
       JOIN cells c ON c.id = g.center_cell_id
       WHERE g.center_cell_id IN (${cellPh})
         AND c.deleted_at IS NULL
         AND g.deleted_at IS NULL
         AND g.id != c.grid_id
       ORDER BY g.center_cell_id, g.sort_order`,
      rootCellIds,
    )

    // 各 rootCell に対する「最初の子グリッド」(sort_order 最小) を選出
    const firstChildByCellId = new Map<string, Grid>()
    for (const g of allChildGrids) {
      if (!firstChildByCellId.has(g.center_cell_id)) {
        // parent_grid_id は JOIN で取っただけの補助カラムなので Grid 型には含めない
        const { parent_grid_id: _ignored, ...grid } = g
        void _ignored
        firstChildByCellId.set(g.center_cell_id, grid as Grid)
      }
    }

    if (firstChildByCellId.size === 0) {
      setSubGrids(new Map())
      return
    }

    // 2. 各 first child grid の cells を一括取得
    const firstChildIds = Array.from(firstChildByCellId.values()).map((g) => g.id)
    const gridPh = firstChildIds.map(() => '?').join(',')
    const allSubCells = await query<Cell>(
      `SELECT * FROM cells WHERE grid_id IN (${gridPh}) AND deleted_at IS NULL ORDER BY grid_id, position`,
      firstChildIds,
    )
    const cellsByGridId = new Map<string, Cell[]>()
    for (const c of allSubCells) {
      const arr = cellsByGridId.get(c.grid_id) ?? []
      arr.push(c)
      cellsByGridId.set(c.grid_id, arr)
    }

    // 3. 子 grid で center が ownCells に居ない場合は rootCell (= 親 cell) を merge
    //    merged center は UI 用に position = CENTER_POSITION に上書きする (grids.ts の
    //    withCenterPosition 相当)
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
