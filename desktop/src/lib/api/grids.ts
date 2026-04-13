import { query, execute, generateId, now } from '../db'
import type { Grid, Cell } from '../../types'

export async function getRootGrids(mandalartId: string): Promise<Grid[]> {
  return query<Grid>(
    'SELECT * FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL AND deleted_at IS NULL ORDER BY sort_order',
    [mandalartId]
  )
}

export async function getChildGrids(parentCellId: string): Promise<Grid[]> {
  return query<Grid>(
    'SELECT * FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
    [parentCellId]
  )
}

export async function getGrid(id: string): Promise<Grid & { cells: Cell[] }> {
  const grids = await query<Grid>(
    'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  const grid = grids[0]
  if (!grid) throw new Error(`Grid not found: ${id}`)
  const cells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [id],
  )
  return { ...grid, cells }
}

export async function createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }> {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [gridId, params.mandalartId, params.parentCellId, params.sortOrder, ts, ts]
  )

  const cellInserts = Array.from({ length: 9 }).map((_, i) => ({
    id: generateId(), grid_id: gridId, position: i, ts,
  }))
  for (const c of cellInserts) {
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [c.id, c.grid_id, c.position, '', c.ts, c.ts]
    )
  }

  const cells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [gridId],
  )
  const grid: Grid = {
    id: gridId,
    mandalart_id: params.mandalartId,
    parent_cell_id: params.parentCellId,
    sort_order: params.sortOrder,
    memo: null,
    created_at: ts,
    updated_at: ts,
  }
  return { ...grid, cells }
}

export async function updateGridMemo(id: string, memo: string): Promise<void> {
  await execute('UPDATE grids SET memo = ?, updated_at = ? WHERE id = ?', [memo, now(), id])
}

/**
 * ソフトデリート: grid とその配下のセル・サブグリッドを再帰的に論理削除する。
 */
export async function deleteGrid(id: string): Promise<void> {
  const ts = now()
  // まず子孫の grids / cells を再帰的に論理削除してから自分自身を消す
  const cells = await query<{ id: string }>(
    'SELECT id FROM cells WHERE grid_id = ? AND deleted_at IS NULL',
    [id],
  )
  for (const c of cells) {
    const subGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
      [c.id],
    )
    for (const sg of subGrids) {
      await deleteGrid(sg.id)
    }
  }
  await execute(
    'UPDATE cells SET deleted_at = ?, updated_at = ? WHERE grid_id = ?',
    [ts, ts, id],
  )
  await execute(
    'UPDATE grids SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [ts, ts, id],
  )
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<void> {
  await execute('UPDATE grids SET sort_order = ?, updated_at = ? WHERE id = ?', [sortOrder, now(), id])
}
