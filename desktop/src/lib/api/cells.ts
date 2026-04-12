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
  // 一時IDを使わず、子グリッドIDを先に取得してから付け替える（FK制約回避）
  const gridsOfA = await query<{ id: string }>('SELECT id FROM grids WHERE parent_cell_id = ?', [cellIdA])
  const gridsOfB = await query<{ id: string }>('SELECT id FROM grids WHERE parent_cell_id = ?', [cellIdB])
  const ts = now()
  for (const g of gridsOfA) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdB, ts, g.id])
  }
  for (const g of gridsOfB) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdA, ts, g.id])
  }
  await swapCellContent(cellIdA, cellIdB)
}

/**
 * クリップボード（カット/コピー）からのペースト。
 * copyCellSubtree で内容と子グリッドを複製し、mode='cut' のときは source を空にする。
 */
export async function pasteCell(
  sourceCellId: string,
  targetCellId: string,
  mode: 'cut' | 'copy',
): Promise<void> {
  if (sourceCellId === targetCellId) return
  await copyCellSubtree(sourceCellId, targetCellId)

  if (mode === 'cut') {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      ['', null, null, ts, sourceCellId],
    )
    await execute('DELETE FROM grids WHERE parent_cell_id = ?', [sourceCellId])
  }
}

export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const srcs = await query<Cell>('SELECT * FROM cells WHERE id = ?', [sourceCellId])
  const src = srcs[0]
  if (!src) return

  // 1) ソース側の子グリッドを複製（ターゲット更新より前に実行して
  //    スナップショットがターゲットの空状態を含むようにする）
  const childGrids = await query<{ id: string; sort_order: number }>(
    'SELECT id, sort_order FROM grids WHERE parent_cell_id = ?', [sourceCellId]
  )
  for (const cg of childGrids) {
    await copyGridRecursive(cg.id, targetCellId, cg.sort_order)
  }

  // 2) 中心セルで子グリッドを持たない場合、
  //    「その中心セルがテーマとしているグリッド自体」を subtree として複製する。
  //    （中央セルの階層 = このグリッドの 8 周辺セル + それ以下、という UX 解釈）
  if (src.position === 4 && childGrids.length === 0) {
    await copyGridRecursive(src.grid_id, targetCellId, 0)
  }

  // 3) 最後にターゲットのコンテンツを上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [src.text, src.image_path, src.color, now(), targetCellId]
  )
}

async function copyGridRecursive(
  sourceGridId: string,
  newParentCellId: string,
  sortOrder: number
): Promise<string> {
  // ソース側の状態を INSERT 前にスナップショットする。
  // （新しく作ったグリッドを子として拾ってしまう無限再帰を防ぐため）
  const grids = await query<{ mandalart_id: string; memo: string | null }>(
    'SELECT mandalart_id, memo FROM grids WHERE id = ?', [sourceGridId]
  )
  const sg = grids[0]
  const sourceCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? ORDER BY position', [sourceGridId]
  )
  const childGridsPerCell = new Map<string, { id: string; sort_order: number }[]>()
  for (const sc of sourceCells) {
    const cgs = await query<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM grids WHERE parent_cell_id = ?', [sc.id]
    )
    childGridsPerCell.set(sc.id, cgs)
  }

  // 新しいグリッドとセルを挿入
  const newGridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [newGridId, sg.mandalart_id, newParentCellId, sortOrder, sg.memo, ts, ts]
  )
  for (const sc of sourceCells) {
    const newCellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, sc.position, sc.text, sc.image_path, sc.color, ts, ts]
    )
    const cgs = childGridsPerCell.get(sc.id) ?? []
    for (const cg of cgs) {
      await copyGridRecursive(cg.id, newCellId, cg.sort_order)
    }
  }
  return newGridId
}
