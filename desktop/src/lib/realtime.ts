import { supabase } from '@/lib/supabase/client'
import { execute, query } from '@/lib/db'
import type { Cell, Grid } from '@/types'

type CloudCell = Cell
type CloudGrid = Grid

/**
 * タイムスタンプを epoch ミリ秒に正規化して比較する。
 * local (JS `toISOString()` の `Z` サフィックス) と cloud (Postgres の `+00:00` サフィックス)
 * は同じ瞬間でも文字列が違うため、純粋な `===` / `>` だと別物扱いされる。
 * NaN (パース失敗) や null は 0 扱いで安全側に倒す。
 */
function tsMs(ts: string | null | undefined): number {
  if (!ts) return 0
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? 0 : n
}
function tsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = a == null
  const nb = b == null
  if (na && nb) return true
  if (na !== nb) return false
  return tsMs(a) === tsMs(b)
}
function tsNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  return tsMs(a) > tsMs(b)
}

/**
 * Supabase Realtime: 別デバイスでの変更を購読する
 *
 * RLS により、自分の所有するレコードの変更だけが届く（postgres_changes）。
 * 受信したペイロードを直接ローカル DB に upsert し、UI 側に変更を通知する。
 *
 * 重要: Supabase 側には `BEFORE UPDATE` トリガーが設定されており、upsert のたびに
 * `updated_at = NOW()` で書き換えられる。そのため自分の push でも cloud.updated_at は
 * local.updated_at より新しくなり、echo が永久に "cloud 新しい" と判定されて reload が
 * ループする。対策として、ローカル DB に書き戻す際に **content (text, memo 等) が同じ**
 * なら timestamp のみを更新して onChange を呼ばない。content が実際に変わっている場合
 * (= 他デバイスの編集) のみ UI reload をトリガする。
 */
export function subscribeRemoteChanges(
  onChange: () => void,
): () => void {
  const channel = supabase.channel('mandalart-sync')

  // Supabase realtime の table フィルターが実測で discriminator として
  // 効かないケースがあり、mandalarts ハンドラに cells ペイロードが届くなどの
  // 混線が発生する。各ハンドラの冒頭で payload.table を検証し、対象外ならスキップする。

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'mandalarts' },
    async (payload) => {
      if (payload.table !== 'mandalarts') return
      try {
        const changed = await applyMandalartChange(payload)
        if (changed) onChange()
      } catch (e) {
        console.error('[realtime] applyMandalartChange failed:', e, payload)
      }
    },
  )

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'grids' },
    async (payload) => {
      if (payload.table !== 'grids') return
      try {
        const changed = await applyGridChange(payload)
        if (changed) onChange()
      } catch (e) {
        console.error('[realtime] applyGridChange failed:', e, payload)
      }
    },
  )

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'cells' },
    async (payload) => {
      if (payload.table !== 'cells') return
      try {
        const changed = await applyCellChange(payload)
        if (changed) onChange()
      } catch (e) {
        console.error('[realtime] applyCellChange failed:', e, payload)
      }
    },
  )

  channel.subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * 自分の push のエコーか、他デバイスからの実更新かを content 比較で判定する。
 * @returns true なら UI reload が必要 (content が実際に変わっている)
 */
async function applyMandalartChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }): Promise<boolean> {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (!id) return false
    await execute(
      'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
      [id],
    )
    await execute('DELETE FROM grids WHERE mandalart_id = ?', [id])
    await execute('DELETE FROM mandalarts WHERE id = ?', [id])
    return true
  }
  const m = payload.new as { id: string; title: string; root_cell_id: string; show_checkbox?: boolean; last_grid_id?: string | null; created_at: string; updated_at: string; deleted_at: string | null }
  if (!m.id) return false
  const local = await query<{ title: string; root_cell_id: string; show_checkbox: number; last_grid_id: string | null; deleted_at: string | null; updated_at: string }>(
    'SELECT title, root_cell_id, show_checkbox, last_grid_id, deleted_at, updated_at FROM mandalarts WHERE id = ?',
    [m.id],
  )
  const showCheckboxInt = m.show_checkbox ? 1 : 0
  const lastGridId = m.last_grid_id ?? null
  if (local.length === 0) {
    await execute(
      'INSERT INTO mandalarts (id, title, root_cell_id, show_checkbox, last_grid_id, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [m.id, m.title, m.root_cell_id, showCheckboxInt, lastGridId, m.created_at, m.updated_at, m.deleted_at, m.updated_at],
    )
    return true
  }
  if (!tsNewer(m.updated_at, local[0].updated_at)) return false
  const contentSame =
    local[0].title === m.title &&
    local[0].root_cell_id === m.root_cell_id &&
    !!local[0].show_checkbox === !!m.show_checkbox &&
    (local[0].last_grid_id ?? null) === lastGridId &&
    tsEqual(local[0].deleted_at, m.deleted_at)
  if (contentSame) {
    // echo: timestamp だけ揃えて UI reload はスキップ
    await execute(
      'UPDATE mandalarts SET updated_at=?, synced_at=? WHERE id=?',
      [m.updated_at, m.updated_at, m.id],
    )
    return false
  }
  await execute(
    'UPDATE mandalarts SET title=?, root_cell_id=?, show_checkbox=?, last_grid_id=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
    [m.title, m.root_cell_id, showCheckboxInt, lastGridId, m.updated_at, m.deleted_at, m.updated_at, m.id],
  )
  return true
}

async function applyGridChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }): Promise<boolean> {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (!id) return false
    await execute('DELETE FROM cells WHERE grid_id = ?', [id])
    await execute('DELETE FROM grids WHERE id = ?', [id])
    return true
  }
  const g = payload.new as CloudGrid & { deleted_at: string | null }
  if (!g.id) return false
  const local = await query<{
    mandalart_id: string; center_cell_id: string; parent_cell_id: string | null;
    sort_order: number; memo: string | null; deleted_at: string | null; updated_at: string;
  }>(
    'SELECT mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, deleted_at, updated_at FROM grids WHERE id = ?',
    [g.id],
  )
  if (local.length === 0) {
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [g.id, g.mandalart_id, g.center_cell_id, g.parent_cell_id ?? null, g.sort_order, g.memo, g.created_at, g.updated_at, g.deleted_at, g.updated_at],
    )
    return true
  }
  if (!tsNewer(g.updated_at, local[0].updated_at)) return false
  const contentSame =
    local[0].mandalart_id === g.mandalart_id &&
    local[0].center_cell_id === g.center_cell_id &&
    (local[0].parent_cell_id ?? null) === (g.parent_cell_id ?? null) &&
    local[0].sort_order === g.sort_order &&
    (local[0].memo ?? null) === (g.memo ?? null) &&
    tsEqual(local[0].deleted_at, g.deleted_at)
  if (contentSame) {
    await execute(
      'UPDATE grids SET updated_at=?, synced_at=? WHERE id=?',
      [g.updated_at, g.updated_at, g.id],
    )
    return false
  }
  await execute(
    'UPDATE grids SET mandalart_id=?, center_cell_id=?, parent_cell_id=?, sort_order=?, memo=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
    [g.mandalart_id, g.center_cell_id, g.parent_cell_id ?? null, g.sort_order, g.memo, g.updated_at, g.deleted_at, g.updated_at, g.id],
  )
  return true
}

async function applyCellChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }): Promise<boolean> {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (!id) return false
    await execute('DELETE FROM cells WHERE id = ?', [id])
    return true
  }
  const c = payload.new as CloudCell & { deleted_at: string | null; done?: boolean }
  if (!c.id) return false
  const doneFlag = c.done ? 1 : 0
  const local = await query<{
    grid_id: string; position: number; text: string;
    image_path: string | null; color: string | null; done: number;
    deleted_at: string | null; updated_at: string;
  }>(
    'SELECT grid_id, position, text, image_path, color, done, deleted_at, updated_at FROM cells WHERE id = ?',
    [c.id],
  )
  if (local.length === 0) {
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [c.id, c.grid_id, c.position, c.text, c.image_path, c.color, doneFlag, c.created_at, c.updated_at, c.deleted_at, c.updated_at],
    )
    return true
  }
  if (!tsNewer(c.updated_at, local[0].updated_at)) return false
  const contentSame =
    local[0].grid_id === c.grid_id &&
    local[0].position === c.position &&
    local[0].text === c.text &&
    (local[0].image_path ?? null) === (c.image_path ?? null) &&
    (local[0].color ?? null) === (c.color ?? null) &&
    Number(local[0].done) === doneFlag &&
    tsEqual(local[0].deleted_at, c.deleted_at)
  if (contentSame) {
    await execute(
      'UPDATE cells SET updated_at=?, synced_at=? WHERE id=?',
      [c.updated_at, c.updated_at, c.id],
    )
    return false
  }
  await execute(
    'UPDATE cells SET grid_id=?, position=?, text=?, image_path=?, color=?, done=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
    [c.grid_id, c.position, c.text, c.image_path, c.color, doneFlag, c.updated_at, c.deleted_at, c.updated_at, c.id],
  )
  return true
}
