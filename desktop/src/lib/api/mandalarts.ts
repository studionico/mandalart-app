import { query, execute, generateId, now } from '../db'
import { supabase, isSupabaseConfigured } from '../supabase/client'
import type { Mandalart, Cell } from '../../types'

// ルート中心セル (position=4) の image_path を相関サブクエリで取得する共通式。
// mandalarts テーブル自体には image_path を保存していないので、都度 JOIN して引き出す。
const ROOT_IMAGE_PATH_SUBQUERY = `(
  SELECT c.image_path FROM cells c
  WHERE c.grid_id = (
    SELECT g.id FROM grids g
    WHERE g.mandalart_id = m.id AND g.parent_cell_id IS NULL AND g.sort_order = 0 AND g.deleted_at IS NULL
    LIMIT 1
  )
  AND c.position = 4 AND c.deleted_at IS NULL
  LIMIT 1
)`

export async function getMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    `SELECT m.*, ${ROOT_IMAGE_PATH_SUBQUERY} AS image_path
     FROM mandalarts m
     WHERE m.deleted_at IS NULL
     ORDER BY m.updated_at DESC`
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
    // 循環 FK 問題で parent_cell_id の制約は外している運用なので、
    // 順序を守れば制約違反は起きない。
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
    // ネットワーク断 / RLS 等で失敗した場合: ローカルは既に消えている。
    // 次回オンライン時に再度完全削除を実行すれば cloud も消える。
    console.warn('[permanentDelete] cloud delete failed (local delete already succeeded):', e)
  }
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
 * タイトルはソースのまま (updateCell 経由の auto-sync に任せる)。
 */
export async function duplicateMandalart(sourceId: string): Promise<Mandalart> {
  const src = await getMandalart(sourceId)
  if (!src) throw new Error(`Mandalart not found: ${sourceId}`)

  const newId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [newId, src.title, ts, ts],
  )

  // ルートグリッドを複製（parent_cell_id IS NULL）
  const rootGrids = await query<{ id: string; sort_order: number; memo: string | null }>(
    'SELECT id, sort_order, memo FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL AND deleted_at IS NULL ORDER BY sort_order',
    [sourceId],
  )
  for (const g of rootGrids) {
    await cloneGridRecursive(g.id, newId, null, g.sort_order, g.memo)
  }

  return { id: newId, title: src.title, created_at: ts, updated_at: ts, user_id: '' }
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
