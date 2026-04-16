import { query, execute, generateId, now } from '@/lib/db'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/import-parser'
import { CENTER_POSITION } from '@/constants/grid'

export { parseTextToSnapshot }

/**
 * グリッドとその配下の全ての子孫を GridSnapshot 形式でエクスポートする。
 * 各子グリッドには `parentPosition` (親グリッドのどのセルから生えているか) を
 * 記録するので、インポート時に正しい位置に復元できる。
 */
export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  async function fetchSnapshot(
    gId: string,
    sortOrder: number,
    parentPosition: number | undefined,
  ): Promise<GridSnapshot> {
    const grids = await query<Grid & { memo: string | null }>(
      'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
      [gId],
    )
    const grid = grids[0]
    if (!grid) throw new Error('Grid not found')

    const cells = await query<Cell>(
      'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
      [gId],
    )

    const children: GridSnapshot[] = []
    for (const cell of cells) {
      const childGrids = await query<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
        [cell.id],
      )
      for (const cg of childGrids) {
        children.push(await fetchSnapshot(cg.id, cg.sort_order, cell.position))
      }
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo ?? null },
      parentPosition,
      cells: cells.map((c) => ({
        position: c.position, text: c.text, image_path: c.image_path, color: c.color,
      })),
      children,
    }
  }

  const grids = await query<{ sort_order: number }>(
    'SELECT sort_order FROM grids WHERE id = ? AND deleted_at IS NULL',
    [gridId],
  )
  return fetchSnapshot(gridId, grids[0]?.sort_order ?? 0, undefined)
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
  const centerText = snapshot.cells.find((c) => c.position === CENTER_POSITION)?.text ?? ''
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, centerText, ts, ts],
  )
  await importIntoGrid(snapshot, id, null, 0)
  return { id, title: centerText, created_at: ts, updated_at: ts, user_id: '' }
}

/**
 * GridSnapshot をローカル DB に挿入する。
 * `snapshot.children` の各子は `parentPosition` を見て attach 先を決める:
 *  - 0..8: このグリッドの該当位置セルの下にぶら下がるサブグリッド
 *  - undefined: このグリッドと同階層の並列グリッド (parent_cell_id を共有)
 */
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
    [gridId, mandalartId, parentCellId, sortOrder, snapshot.grid.memo ?? null, ts, ts],
  )

  const insertedCells: { id: string; position: number }[] = []
  for (let pos = 0; pos < 9; pos++) {
    const c = snapshot.cells.find((c) => c.position === pos)
    const cellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
    insertedCells.push({ id: cellId, position: pos })
  }

  for (const child of snapshot.children) {
    if (child.parentPosition !== undefined) {
      // このグリッドのセル配下にサブグリッドとして挿入
      const parentCell = insertedCells.find((c) => c.position === child.parentPosition)
      if (!parentCell) continue
      await importIntoGrid(child, mandalartId, parentCell.id, child.grid.sort_order)
    } else {
      // このグリッドと並列な兄弟グリッドとして挿入 (parent_cell_id を共有)
      await importIntoGrid(child, mandalartId, parentCellId, child.grid.sort_order)
    }
  }
}

export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void> {
  const cells = await query<{ grid_id: string }>(
    'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cells[0]
  if (!cell) throw new Error('Cell not found')

  const grids = await query<{ mandalart_id: string }>(
    'SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [cell.grid_id],
  )
  const grid = grids[0]
  if (!grid) throw new Error('Grid not found')

  // インポート先セルの内容を、スナップショットのルート (position 4) と同期させる。
  // 「親セルの text = 子グリッドの中心セルの text」というマンダラートの規約を
  // インポート時にも保つため。ルートが空のときは target を上書きしない。
  const root = snapshot.cells.find((c) => c.position === CENTER_POSITION)
  if (root && (root.text.trim() || root.image_path || root.color)) {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [root.text, root.image_path, root.color, ts, cellId],
    )
  }

  await importIntoGrid(snapshot, grid.mandalart_id, cellId, 0)
}
