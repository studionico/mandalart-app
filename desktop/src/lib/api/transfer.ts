import { query, execute, generateId, now } from '@/lib/db'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/import-parser'

export { parseTextToSnapshot }

export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  async function fetchSnapshot(gId: string, sortOrder: number): Promise<GridSnapshot> {
    const grids = await query<Grid & { memo: string | null }>('SELECT * FROM grids WHERE id = ?', [gId])
    const grid = grids[0]
    if (!grid) throw new Error('Grid not found')

    const cells = await query<Cell>('SELECT * FROM cells WHERE grid_id = ?', [gId])

    const children: GridSnapshot[] = []
    for (const cell of cells) {
      const childGrids = await query<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? ORDER BY sort_order',
        [cell.id]
      )
      for (const cg of childGrids) {
        children.push(await fetchSnapshot(cg.id, cg.sort_order))
      }
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo ?? null },
      cells: cells.map((c) => ({
        position: c.position, text: c.text, image_path: c.image_path, color: c.color,
      })),
      children,
    }
  }

  const grids = await query<{ sort_order: number }>('SELECT sort_order FROM grids WHERE id = ?', [gridId])
  return fetchSnapshot(gridId, grids[0]?.sort_order ?? 0)
}

export async function exportToCSV(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  const rows: string[] = ['position,text,color,depth']

  function flatten(s: GridSnapshot, depth: number) {
    for (const cell of s.cells) {
      rows.push(`${cell.position},"${cell.text.replace(/"/g, '""')}",${cell.color ?? ''},${depth}`)
    }
    for (const child of s.children) {
      flatten(child, depth + 1)
    }
  }

  flatten(snapshot, 0)
  return rows.join('\n')
}

export async function importFromJSON(snapshot: GridSnapshot): Promise<Mandalart> {
  const id = generateId()
  const ts = now()
  const centerText = snapshot.cells.find((c) => c.position === 4)?.text ?? ''
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, centerText, ts, ts]
  )
  await importIntoGrid(snapshot, id, null, 0)
  return { id, title: centerText, created_at: ts, updated_at: ts, user_id: '' }
}

async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  parentCellId: string | null,
  sortOrder: number,
) {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [gridId, mandalartId, parentCellId, sortOrder, snapshot.grid.memo ?? null, ts, ts]
  )

  const allPositions = Array.from({ length: 9 }, (_, i) => i)
  const insertedCells: { id: string; position: number }[] = []

  for (const pos of allPositions) {
    const c = snapshot.cells.find((c) => c.position === pos)
    const cellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts]
    )
    insertedCells.push({ id: cellId, position: pos })
  }

  for (const child of snapshot.children) {
    const parentPos = child.cells.find((c) => c.position === 4)?.position
    const matchCell = insertedCells.find((c) => c.position === (parentPos ?? 4))
    if (matchCell) {
      await importIntoGrid(child, mandalartId, matchCell.id, child.grid.sort_order)
    }
  }
}

export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void> {
  const cells = await query<{ grid_id: string }>('SELECT grid_id FROM cells WHERE id = ?', [cellId])
  const cell = cells[0]
  if (!cell) throw new Error('Cell not found')

  const grids = await query<{ mandalart_id: string }>('SELECT mandalart_id FROM grids WHERE id = ?', [cell.grid_id])
  const grid = grids[0]
  if (!grid) throw new Error('Grid not found')

  await importIntoGrid(snapshot, grid.mandalart_id, cellId, 0)
}
