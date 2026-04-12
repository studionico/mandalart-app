import { query, execute, generateId, now } from '../db'
import type { Cell } from '../../types'

export async function updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell> {
  const fields: string[] = []
  const values: unknown[] = []
  if (params.text !== undefined) { fields.push('text = ?'); values.push(params.text) }
  if (params.image_path !== undefined) { fields.push('image_path = ?'); values.push(params.image_path) }
  if (params.color !== undefined) { fields.push('color = ?'); values.push(params.color) }
  fields.push('updated_at = ?'); values.push(now())
  values.push(id)
  await execute(`UPDATE cells SET ${fields.join(', ')} WHERE id = ?`, values)
  const rows = await query<Cell>('SELECT * FROM cells WHERE id = ?', [id])
  return rows[0]
}

export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void> {
  const [a, b] = await Promise.all([
    query<Cell>('SELECT * FROM cells WHERE id = ?', [cellIdA]),
    query<Cell>('SELECT * FROM cells WHERE id = ?', [cellIdB]),
  ])
  const ca = a[0]; const cb = b[0]
  const ts = now()
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [cb.text, cb.image_path, cb.color, ts, cellIdA])
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [ca.text, ca.image_path, ca.color, ts, cellIdB])
}

export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  const tempId = '00000000-0000-0000-0000-000000000000'
  const ts = now()
  await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE parent_cell_id=?', [tempId, ts, cellIdA])
  await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE parent_cell_id=?', [cellIdA, ts, cellIdB])
  await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE parent_cell_id=?', [cellIdB, ts, tempId])
  await swapCellContent(cellIdA, cellIdB)
}

export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const sourceGrids = await query<{ id: string; memo: string | null; sort_order: number }>(
    'SELECT id, memo, sort_order FROM grids WHERE parent_cell_id = ?', [sourceCellId]
  )
  for (const sg of sourceGrids) {
    await copyGridRecursive(sg.id, targetCellId, sg.sort_order)
  }
}

async function copyGridRecursive(
  sourceGridId: string,
  newParentCellId: string,
  sortOrder: number
): Promise<string> {
  const grids = await query<{ mandalart_id: string; memo: string | null }>(
    'SELECT mandalart_id, memo FROM grids WHERE id = ?', [sourceGridId]
  )
  const sg = grids[0]
  const newGridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [newGridId, sg.mandalart_id, newParentCellId, sortOrder, sg.memo, ts, ts]
  )
  const sourceCells = await query<Cell>('SELECT * FROM cells WHERE grid_id = ? ORDER BY position', [sourceGridId])
  for (const sc of sourceCells) {
    const newCellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, sc.position, sc.text, sc.image_path, sc.color, ts, ts]
    )
    const childGrids = await query<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM grids WHERE parent_cell_id = ?', [sc.id]
    )
    for (const cg of childGrids) {
      await copyGridRecursive(cg.id, newCellId, cg.sort_order)
    }
  }
  return newGridId
}
