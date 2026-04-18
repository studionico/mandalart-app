import { query, execute, generateId, now } from '@/lib/db'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/import-parser'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'

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

    // 自 grid に属する cells を取得。child grid の場合は center 行を含まないので、
    // export は center_cell_id の cell を別途読み込んで 9 cells 化する (import 側との
    // 後方互換のため)。
    // child grid では親の cell を position=CENTER_POSITION として merge する
    // (DB 上の position は親内位置だが、snapshot としては中心 = 4 にしないと import
    //  で position=4 の位置に復元されない)。
    const ownCells = await query<Cell>(
      'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
      [gId],
    )
    const hasCenter = ownCells.some((c) => c.id === grid.center_cell_id)
    const allCells = [...ownCells]
    if (!hasCenter) {
      const centers = await query<Cell>(
        'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
        [grid.center_cell_id],
      )
      if (centers[0]) allCells.push({ ...centers[0], position: CENTER_POSITION })
    }
    allCells.sort((a, b) => a.position - b.position)

    const children: GridSnapshot[] = []
    for (const cell of allCells) {
      // このセルを center として指す他の grids (drilled + 並列), 自 grid 除く
      const childGrids = await query<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
        [cell.id, gId],
      )
      for (const cg of childGrids) {
        children.push(await fetchSnapshot(cg.id, cg.sort_order, cell.position))
      }
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo ?? null },
      parentPosition,
      cells: allCells.map((c) => ({
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
  const mandalartId = generateId()
  const ts = now()
  const centerText = snapshot.cells.find((c) => c.position === CENTER_POSITION)?.text ?? ''

  // root 中心セルの id を先に決めて mandalart を作る
  const rootCenterCellId = generateId()
  await execute(
    'INSERT INTO mandalarts (id, title, root_cell_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [mandalartId, centerText, rootCenterCellId, ts, ts],
  )
  // root grid を作成 (center_cell_id = rootCenterCellId)
  await importIntoGrid(snapshot, mandalartId, rootCenterCellId, 0, /* isRoot */ true)
  return { id: mandalartId, title: centerText, root_cell_id: rootCenterCellId, created_at: ts, updated_at: ts, user_id: '' }
}

/**
 * GridSnapshot をローカル DB に挿入する。
 *
 * 新モデル:
 *  - isRoot = true: 9 cells (position=4 を含む) を grid に INSERT。center = position=4 の cell (id = centerCellId)
 *  - isRoot = false: 8 peripherals のみ INSERT (position=4 は skip)。center = 呼び出し側から渡された既存 cell id
 */
async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  centerCellId: string,
  sortOrder: number,
  isRoot = false,
) {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [gridId, mandalartId, centerCellId, sortOrder, snapshot.grid.memo ?? null, ts, ts],
  )

  const insertedCellIdByPosition = new Map<number, string>()
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    const c = snapshot.cells.find((cc) => cc.position === pos)
    if (pos === CENTER_POSITION) {
      if (isRoot) {
        // root 中心セルは事前に決めた id を使う
        await execute(
          'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [centerCellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
        )
        insertedCellIdByPosition.set(pos, centerCellId)
      }
      // child grid の場合は position=4 の行を作らない (insertedCellIdByPosition にも入れない)
      continue
    }
    const cellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
    insertedCellIdByPosition.set(pos, cellId)
  }

  for (const child of snapshot.children) {
    const parentPos = child.parentPosition
    if (parentPos === undefined) {
      // 並列グリッド: 同じ center を共有
      await importIntoGrid(child, mandalartId, centerCellId, child.grid.sort_order, /* isRoot */ false)
      continue
    }
    if (parentPos === CENTER_POSITION) {
      // center 経由でぶら下がるグリッド (並列と同等)
      await importIntoGrid(child, mandalartId, centerCellId, child.grid.sort_order, false)
      continue
    }
    const parentCellId = insertedCellIdByPosition.get(parentPos)
    if (!parentCellId) continue
    // drilled: 新グリッドの center = 親の peripheral cell id
    await importIntoGrid(child, mandalartId, parentCellId, child.grid.sort_order, false)
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

  // インポート先セルの内容を snapshot の root (position=4) と同期
  const root = snapshot.cells.find((c) => c.position === CENTER_POSITION)
  if (root && (root.text.trim() || root.image_path || root.color)) {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [root.text, root.image_path, root.color, ts, cellId],
    )
  }

  // 新しい子グリッドとして cellId を center にして挿入
  await importIntoGrid(snapshot, grid.mandalart_id, cellId, 0, false)
}
