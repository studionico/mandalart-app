import { query, execute, generateId, now } from '../db'
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { CENTER_POSITION } from '@/constants/grid'
import type { Mandalart, Cell } from '../../types'

// ルート中心セル (= mandalarts.root_cell_id が指す cell) の image_path を取得する共通式。
// 新モデルでは root_cell_id を直接参照するだけで済むため、旧 JOIN ベースより単純。
const ROOT_IMAGE_PATH_SUBQUERY = `(
  SELECT c.image_path FROM cells c
  WHERE c.id = m.root_cell_id AND c.deleted_at IS NULL
  LIMIT 1
)`

export async function getMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    `SELECT m.*, ${ROOT_IMAGE_PATH_SUBQUERY} AS image_path
     FROM mandalarts m
     WHERE m.deleted_at IS NULL
     ORDER BY m.updated_at DESC`,
  )
}

export async function getMandalart(id: string): Promise<Mandalart | null> {
  const rows = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  return rows[0] ?? null
}

/**
 * マンダラートを新規作成する。
 *
 * lazy cell creation 設計 (commit 7668c5c〜) では peripheral cell は user が書込んだ瞬間に
 * upsertCellAt で初めて INSERT される。ここで作るのは:
 *   - mandalarts 1 行
 *   - root grid 1 行
 *   - root center cell 1 行 (mandalarts.root_cell_id 参照のため必須)
 * peripheral cells は作らない (旧版では 8 cells INSERT していた)。
 */
export async function createMandalart(title = ''): Promise<Mandalart> {
  const mandalartId = generateId()
  const rootGridId = generateId()
  const rootCenterCellId = generateId()
  const ts = now()

  await execute(
    'INSERT INTO mandalarts (id, title, root_cell_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [mandalartId, title, rootCenterCellId, ts, ts],
  )
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [rootGridId, mandalartId, rootCenterCellId, null, 0, ts, ts],
  )
  await execute(
    'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [rootCenterCellId, rootGridId, CENTER_POSITION, '', ts, ts],
  )

  return {
    id: mandalartId,
    title,
    root_cell_id: rootCenterCellId,
    created_at: ts,
    updated_at: ts,
    user_id: '',
  }
}

export async function updateMandalartTitle(id: string, title: string): Promise<void> {
  await execute(
    'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
    [title, now(), id],
  )
}

/**
 * マンダラートとその配下 (grids / cells) を削除する。
 *
 * - **未同期行 (synced_at IS NULL)**: hard delete (物理削除)。cloud に存在しないので
 *   soft-delete で残すと push で RLS 403 を誘発する orphan 行になる
 * - **同期済み行 (synced_at IS NOT NULL)**: soft-delete。push で cloud に deleted_at を伝播
 *   (別デバイスがこれらを参照したときに見えないように)
 */
export async function deleteMandalart(id: string): Promise<void> {
  const ts = now()
  // cells: 未同期 hard / 同期済み soft
  await execute(
    'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?) AND synced_at IS NULL',
    [id],
  )
  await execute(
    'UPDATE cells SET deleted_at = ?, updated_at = ? WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?) AND synced_at IS NOT NULL',
    [ts, ts, id],
  )
  // grids: 同上
  await execute('DELETE FROM grids WHERE mandalart_id = ? AND synced_at IS NULL', [id])
  await execute(
    'UPDATE grids SET deleted_at = ?, updated_at = ? WHERE mandalart_id = ? AND synced_at IS NOT NULL',
    [ts, ts, id],
  )
  // mandalart 本体: 同上
  await execute('DELETE FROM mandalarts WHERE id = ? AND synced_at IS NULL', [id])
  await execute(
    'UPDATE mandalarts SET deleted_at = ?, updated_at = ? WHERE id = ? AND synced_at IS NOT NULL',
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
 * ローカル DB から cells / grids / mandalarts を順に実際の DELETE で消し、
 * サインインしていれば cloud からも同じ順で物理削除する。
 *
 * cloud からも消さないと、次回 pullAll で deleted_at 付きの行が再挿入されて
 * ゴミ箱に復活してしまう（「完全削除したはずが同期で戻ってきた」問題の原因）。
 */
export async function permanentDeleteMandalart(id: string): Promise<void> {
  // 1. ローカル
  await execute(
    'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
    [id],
  )
  await execute('DELETE FROM grids WHERE mandalart_id = ?', [id])
  await execute('DELETE FROM mandalarts WHERE id = ?', [id])

  // 2. クラウド (任意)。未サインイン / Supabase 未設定なら何もしない
  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  try {
    // FK CASCADE に頼らず、cells → grids → mandalarts の順で明示削除する。
    const { data: cloudGrids } = await supabase
      .from('grids')
      .select('id')
      .eq('mandalart_id', id)
    const gridIds = ((cloudGrids ?? []) as { id: string }[]).map((g) => g.id)
    if (gridIds.length > 0) {
      await supabase.from('cells').delete().in('grid_id', gridIds)
    }
    await supabase.from('grids').delete().eq('mandalart_id', id)
    await supabase.from('mandalarts').delete().eq('id', id)
  } catch (e) {
    console.warn('[permanentDelete] cloud delete failed (local delete already succeeded):', e)
  }
}

/**
 * タイトルおよびセル本文を対象とした全文検索。
 */
export async function searchMandalarts(q: string): Promise<Mandalart[]> {
  const trimmed = q.trim()
  if (!trimmed) {
    return getMandalarts()
  }
  const escaped = trimmed
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  const like = `%${escaped}%`
  return query<Mandalart>(
    `SELECT DISTINCT m.*, ${ROOT_IMAGE_PATH_SUBQUERY} AS image_path
     FROM mandalarts m
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
 * 全グリッド・セルを新しい ID で再帰的に複製する。
 *
 * 新モデル対応:
 * - 各セル / グリッドに対し old→new id の map を構築
 * - grids.center_cell_id は map[old_center] で置換
 * - 子グリッドの center_cell_id は親グリッド側の新 cell id を指すため、親→子の順で INSERT する
 */
export async function duplicateMandalart(sourceId: string): Promise<Mandalart> {
  const src = await getMandalart(sourceId)
  if (!src) throw new Error(`Mandalart not found: ${sourceId}`)

  const newMandalartId = generateId()
  const ts = now()

  // Old id → new id mapping (cells と grids の両方)
  const cellIdMap = new Map<string, string>()
  const gridIdMap = new Map<string, string>()

  // 全 grids / cells を収集
  const allGrids = await query<{ id: string; mandalart_id: string; center_cell_id: string; parent_cell_id: string | null; sort_order: number; memo: string | null }>(
    'SELECT id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo FROM grids WHERE mandalart_id = ? AND deleted_at IS NULL',
    [sourceId],
  )
  const allCells = await query<Cell>(
    'SELECT c.* FROM cells c JOIN grids g ON g.id = c.grid_id WHERE g.mandalart_id = ? AND c.deleted_at IS NULL',
    [sourceId],
  )

  for (const c of allCells) cellIdMap.set(c.id, generateId())
  for (const g of allGrids) gridIdMap.set(g.id, generateId())

  // mandalart 作成 (root_cell_id は src のマッピング後)
  const newRootCellId = cellIdMap.get(src.root_cell_id)
  if (!newRootCellId) throw new Error(`root_cell_id not found in source cells: ${src.root_cell_id}`)

  await execute(
    'INSERT INTO mandalarts (id, title, root_cell_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [newMandalartId, src.title, newRootCellId, ts, ts],
  )

  for (const g of allGrids) {
    const newGridId = gridIdMap.get(g.id)!
    const newCenterCellId = cellIdMap.get(g.center_cell_id)
    if (!newCenterCellId) throw new Error(`Grid ${g.id} has orphan center_cell_id ${g.center_cell_id}`)
    const newParentCellId = g.parent_cell_id == null ? null : cellIdMap.get(g.parent_cell_id) ?? null
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [newGridId, newMandalartId, newCenterCellId, newParentCellId, g.sort_order, g.memo, ts, ts],
    )
  }

  // 新設計: 空 source cell は新 mandalart にも INSERT しない (lazy)。
  // ただし新 grids.center_cell_id として参照される cell は (text 空でも) 整合性のため INSERT する
  // (例: root center cell は mandalarts.root_cell_id 参照のため必須)。
  const newCenterCellIdSet = new Set(
    allGrids.map((g) => cellIdMap.get(g.center_cell_id)).filter((v): v is string => v != null),
  )
  for (const c of allCells) {
    const newCellId = cellIdMap.get(c.id)!
    const newGridId = gridIdMap.get(c.grid_id)!
    const isPopulated = c.text !== '' || c.image_path !== null || c.color !== null
    const isReferenced = newCenterCellIdSet.has(newCellId)
    if (!isPopulated && !isReferenced) continue
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, c.position, c.text, c.image_path, c.color, c.done ? 1 : 0, ts, ts],
    )
  }

  return {
    id: newMandalartId,
    title: src.title,
    root_cell_id: newRootCellId,
    created_at: ts,
    updated_at: ts,
    user_id: '',
  }
}
