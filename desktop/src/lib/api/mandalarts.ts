import { query, execute, generateId, now } from '../db'
import type { Mandalart, Cell } from '../../types'

export async function getMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    'SELECT * FROM mandalarts WHERE deleted_at IS NULL ORDER BY updated_at DESC'
  )
}

export async function getMandalart(id: string): Promise<Mandalart | null> {
  const rows = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
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

/**
 * ソフトデリート: deleted_at にタイムスタンプをセットし、updated_at も更新して
 * 同期で cloud に反映されるようにする。配下の grids / cells も同じ処理で
 * 論理削除する（別デバイスがこれらを参照したときに見えないように）。
 */
export async function deleteMandalart(id: string): Promise<void> {
  const ts = now()
  await execute(
    'UPDATE cells SET deleted_at = ?, updated_at = ? WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
    [ts, ts, id],
  )
  await execute(
    'UPDATE grids SET deleted_at = ?, updated_at = ? WHERE mandalart_id = ?',
    [ts, ts, id],
  )
  await execute(
    'UPDATE mandalarts SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [ts, ts, id],
  )
}

/**
 * ソフトデリートされているマンダラートの一覧を取得する。
 * 削除日時の新しい順。
 */
export async function getDeletedMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    'SELECT * FROM mandalarts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  )
}

/**
 * ゴミ箱からの復元: deleted_at を NULL に戻し、配下の grids / cells も同時に復元する。
 * updated_at を更新して同期で cloud に反映されるようにする。
 */
export async function restoreMandalart(id: string): Promise<void> {
  const ts = now()
  await execute(
    'UPDATE cells SET deleted_at = NULL, updated_at = ? WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
    [ts, id],
  )
  await execute(
    'UPDATE grids SET deleted_at = NULL, updated_at = ? WHERE mandalart_id = ?',
    [ts, id],
  )
  await execute(
    'UPDATE mandalarts SET deleted_at = NULL, updated_at = ? WHERE id = ?',
    [ts, id],
  )
}

/**
 * 完全削除（物理削除）。ゴミ箱から元に戻せなくなる。
 * ローカル DB から cells / grids / mandalarts を順に実際の DELETE で消す。
 */
export async function permanentDeleteMandalart(id: string): Promise<void> {
  await execute(
    'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
    [id],
  )
  await execute('DELETE FROM grids WHERE mandalart_id = ?', [id])
  await execute('DELETE FROM mandalarts WHERE id = ?', [id])
}

/**
 * タイトルおよびセル本文を対象とした全文検索。
 * マンダラートのタイトル、もしくは配下のいずれかのセルの text に一致するものを返す。
 * LIKE の特殊文字 (%, _, \) はエスケープする。
 */
export async function searchMandalarts(q: string): Promise<Mandalart[]> {
  const trimmed = q.trim()
  if (!trimmed) {
    return getMandalarts()
  }
  // バックスラッシュ → %, _ の順でエスケープ
  const escaped = trimmed
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  const like = `%${escaped}%`
  return query<Mandalart>(
    `SELECT DISTINCT m.* FROM mandalarts m
     LEFT JOIN grids g ON g.mandalart_id = m.id AND g.deleted_at IS NULL
     LEFT JOIN cells c ON c.grid_id = g.id AND c.deleted_at IS NULL
     WHERE m.deleted_at IS NULL
       AND (m.title LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\')
     ORDER BY m.updated_at DESC`,
    [like, like],
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
    'SELECT id, sort_order, memo FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL AND deleted_at IS NULL ORDER BY sort_order',
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
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [sourceGridId],
  )
  const childrenBySourceCellId = new Map<string, { id: string; sort_order: number; memo: string | null }[]>()
  for (const sc of sourceCells) {
    const cgs = await query<{ id: string; sort_order: number; memo: string | null }>(
      'SELECT id, sort_order, memo FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
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
