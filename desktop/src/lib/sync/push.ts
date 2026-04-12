import { query, execute, now } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'
import type { Cell, Grid, Mandalart } from '@/types'

/**
 * 未同期 (synced_at が NULL or updated_at < synced_at) のローカル行を Supabase にアップサートする。
 * 一方向 (ローカル → クラウド)。削除は MVP では対象外。
 *
 * 戻り値: 同期した行数
 */
export async function pushAll(userId: string): Promise<{ mandalarts: number; grids: number; cells: number }> {
  if (!userId) throw new Error('Not signed in')

  let mCount = 0
  let gCount = 0
  let cCount = 0

  // 1. mandalarts
  const dirtyMandalarts = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  if (dirtyMandalarts.length > 0) {
    const rows = dirtyMandalarts.map((m) => ({
      id: m.id,
      user_id: userId,
      title: m.title,
      created_at: m.created_at,
      updated_at: m.updated_at,
    }))
    const { error } = await supabase.from('mandalarts').upsert(rows)
    if (error) throw error
    for (const m of dirtyMandalarts) {
      await execute('UPDATE mandalarts SET synced_at = ? WHERE id = ?', [m.updated_at, m.id])
    }
    mCount = dirtyMandalarts.length
  }

  // 2. grids
  const dirtyGrids = await query<Grid>(
    'SELECT * FROM grids WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  if (dirtyGrids.length > 0) {
    const rows = dirtyGrids.map((g) => ({
      id: g.id,
      mandalart_id: g.mandalart_id,
      parent_cell_id: g.parent_cell_id,
      sort_order: g.sort_order,
      memo: g.memo,
      created_at: g.created_at,
      updated_at: g.updated_at,
    }))
    const { error } = await supabase.from('grids').upsert(rows)
    if (error) throw error
    for (const g of dirtyGrids) {
      await execute('UPDATE grids SET synced_at = ? WHERE id = ?', [g.updated_at, g.id])
    }
    gCount = dirtyGrids.length
  }

  // 3. cells
  const dirtyCells = await query<Cell>(
    'SELECT * FROM cells WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  if (dirtyCells.length > 0) {
    const rows = dirtyCells.map((c) => ({
      id: c.id,
      grid_id: c.grid_id,
      position: c.position,
      text: c.text,
      image_path: c.image_path,
      color: c.color,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }))
    const { error } = await supabase.from('cells').upsert(rows)
    if (error) throw error
    for (const c of dirtyCells) {
      await execute('UPDATE cells SET synced_at = ? WHERE id = ?', [c.updated_at, c.id])
    }
    cCount = dirtyCells.length
  }

  // updated_at が古いままだと差分検出のたびに同じ行を push してしまうので、
  // 何も dirty が無かった場合の noop も含めて呼び出し元で活用しやすいよう
  // 戻り値で件数を返す
  void now
  return { mandalarts: mCount, grids: gCount, cells: cCount }
}
