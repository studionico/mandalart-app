import { supabase } from '@/lib/supabase/client'
import { execute, query } from '@/lib/db'
import type { Cell, Grid } from '@/types'

type CloudCell = Cell
type CloudGrid = Grid

/**
 * Supabase Realtime: 別デバイスでの変更を購読する
 *
 * RLS により、自分の所有するレコードの変更だけが届く（postgres_changes）。
 * 受信したペイロードを直接ローカル DB に upsert し、UI 側に変更を通知する。
 */
export function subscribeRemoteChanges(
  onChange: () => void,
): () => void {
  const channel = supabase.channel('mandalart-sync')

  // Supabase realtime の table フィルターが実測で discriminator として
  // 効かないケースがあり、mandalarts ハンドラに cells ペイロードが届くなどの
  // 混線が発生する。各ハンドラの冒頭で payload.table を検証し、対象外ならスキップする。

  // mandalarts は今のところ delete だけで自動削除がないので、UI のリストの整合性のために購読する
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'mandalarts' },
    async (payload) => {
      if (payload.table !== 'mandalarts') return
      try {
        await applyMandalartChange(payload)
        onChange()
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
        await applyGridChange(payload)
        onChange()
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
        await applyCellChange(payload)
        onChange()
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

async function applyMandalartChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (id) {
      // cloud 側は FK CASCADE で grids / cells も連動削除されるが、realtime の DELETE
      // イベントは個別テーブルごとに届き、しかも「まだ cloud に push されていない子行」
      // に対する DELETE は発行されない。ここで明示的に cascade しないと local に
      // 孤立 cells / grids が残って後続の push で RLS 拒否の原因になる。
      await execute(
        'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
        [id],
      )
      await execute('DELETE FROM grids WHERE mandalart_id = ?', [id])
      await execute('DELETE FROM mandalarts WHERE id = ?', [id])
    }
    return
  }
  const m = payload.new as { id: string; title: string; created_at: string; updated_at: string; deleted_at: string | null }
  if (!m.id) return
  const local = await query<{ updated_at: string }>('SELECT updated_at FROM mandalarts WHERE id = ?', [m.id])
  if (local.length === 0) {
    await execute(
      'INSERT INTO mandalarts (id, title, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?)',
      [m.id, m.title, m.created_at, m.updated_at, m.deleted_at, m.updated_at],
    )
  } else if (m.updated_at > local[0].updated_at) {
    await execute(
      'UPDATE mandalarts SET title=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
      [m.title, m.updated_at, m.deleted_at, m.updated_at, m.id],
    )
  }
}

async function applyGridChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (id) {
      // 上記と同じ理由で cells も cascade 削除
      await execute('DELETE FROM cells WHERE grid_id = ?', [id])
      await execute('DELETE FROM grids WHERE id = ?', [id])
    }
    return
  }
  const g = payload.new as CloudGrid & { deleted_at: string | null }
  if (!g.id) return
  const local = await query<{ updated_at: string }>('SELECT updated_at FROM grids WHERE id = ?', [g.id])
  if (local.length === 0) {
    await execute(
      'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [g.id, g.mandalart_id, g.parent_cell_id, g.sort_order, g.memo, g.created_at, g.updated_at, g.deleted_at, g.updated_at],
    )
  } else if (g.updated_at > local[0].updated_at) {
    await execute(
      'UPDATE grids SET mandalart_id=?, parent_cell_id=?, sort_order=?, memo=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
      [g.mandalart_id, g.parent_cell_id, g.sort_order, g.memo, g.updated_at, g.deleted_at, g.updated_at, g.id],
    )
  }
}

async function applyCellChange(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id as string
    if (id) await execute('DELETE FROM cells WHERE id = ?', [id])
    return
  }
  const c = payload.new as CloudCell & { deleted_at: string | null }
  if (!c.id) return
  const local = await query<{ updated_at: string }>('SELECT updated_at FROM cells WHERE id = ?', [c.id])
  if (local.length === 0) {
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [c.id, c.grid_id, c.position, c.text, c.image_path, c.color, c.created_at, c.updated_at, c.deleted_at, c.updated_at],
    )
  } else if (c.updated_at > local[0].updated_at) {
    await execute(
      'UPDATE cells SET grid_id=?, position=?, text=?, image_path=?, color=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
      [c.grid_id, c.position, c.text, c.image_path, c.color, c.updated_at, c.deleted_at, c.updated_at, c.id],
    )
  }
}
