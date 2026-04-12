import { query, execute, generateId, now } from '../db'
import type { Mandalart, Cell } from '../../types'

export async function getMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    'SELECT * FROM mandalarts ORDER BY updated_at DESC'
  )
}

export async function getMandalart(id: string): Promise<Mandalart | null> {
  const rows = await query<Mandalart>('SELECT * FROM mandalarts WHERE id = ?', [id])
  return rows[0] ?? null
}

export async function createMandalart(title = ''): Promise<Mandalart> {
  const id = generateId()
  const ts = now()
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, title, ts, ts]
  )
  return { id, title, created_at: ts, updated_at: ts, user_id: '' }
}

export async function updateMandalartTitle(id: string, title: string): Promise<void> {
  await execute(
    'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
    [title, now(), id]
  )
}

export async function deleteMandalart(id: string): Promise<void> {
  // migration 002 で循環 FK を解消済み。
  // mandalarts → grids → cells は ON DELETE CASCADE で自動削除される。
  await execute('DELETE FROM mandalarts WHERE id = ?', [id])
}

export async function searchMandalarts(q: string): Promise<Mandalart[]> {
  const like = `%${q}%`
  return query<Mandalart>(
    'SELECT * FROM mandalarts WHERE title LIKE ? ORDER BY updated_at DESC',
    [like]
  )
}

/**
 * マンダラートを丸ごと複製する。
 * タイトルには「 のコピー」を付加し、全グリッド・セルを新しい ID で再帰的に複製する。
 */
export async function duplicateMandalart(sourceId: string): Promise<Mandalart> {
  const src = await getMandalart(sourceId)
  if (!src) throw new Error(`Mandalart not found: ${sourceId}`)

  const newId = generateId()
  const ts = now()
  const newTitle = src.title ? `${src.title} のコピー` : 'コピー'
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [newId, newTitle, ts, ts],
  )

  // ルートグリッドを複製（parent_cell_id IS NULL）
  const rootGrids = await query<{ id: string; sort_order: number; memo: string | null }>(
    'SELECT id, sort_order, memo FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL ORDER BY sort_order',
    [sourceId],
  )
  for (const g of rootGrids) {
    await cloneGridRecursive(g.id, newId, null, g.sort_order, g.memo)
  }

  return { id: newId, title: newTitle, created_at: ts, updated_at: ts, user_id: '' }
}

/**
 * 単一のグリッド + セル + 子孫を新しい mandalart_id へ再帰複製する。
 */
async function cloneGridRecursive(
  sourceGridId: string,
  newMandalartId: string,
  newParentCellId: string | null,
  sortOrder: number,
  memo: string | null,
): Promise<void> {
  // 先にソース側の状態をスナップショット（INSERT 後の再帰で自分自身を拾わないため）
  const sourceCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? ORDER BY position',
    [sourceGridId],
  )
  const childrenBySourceCellId = new Map<string, { id: string; sort_order: number; memo: string | null }[]>()
  for (const sc of sourceCells) {
    const cgs = await query<{ id: string; sort_order: number; memo: string | null }>(
      'SELECT id, sort_order, memo FROM grids WHERE parent_cell_id = ? ORDER BY sort_order',
      [sc.id],
    )
    childrenBySourceCellId.set(sc.id, cgs)
  }

  const newGridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [newGridId, newMandalartId, newParentCellId, sortOrder, memo, ts, ts],
  )

  for (const sc of sourceCells) {
    const newCellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, sc.position, sc.text, sc.image_path, sc.color, ts, ts],
    )
    const childGrids = childrenBySourceCellId.get(sc.id) ?? []
    for (const cg of childGrids) {
      await cloneGridRecursive(cg.id, newMandalartId, newCellId, cg.sort_order, cg.memo)
    }
  }
}
