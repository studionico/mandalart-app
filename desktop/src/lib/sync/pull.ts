import { query, execute } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'

type CloudMandalart = {
  id: string
  title: string
  created_at: string
  updated_at: string
}
type CloudGrid = {
  id: string
  mandalart_id: string
  parent_cell_id: string | null
  sort_order: number
  memo: string | null
  created_at: string
  updated_at: string
}
type CloudCell = {
  id: string
  grid_id: string
  position: number
  text: string
  image_path: string | null
  color: string | null
  created_at: string
  updated_at: string
}

/**
 * 現在ユーザーの全データを Supabase から取得し、ローカルに反映する。
 * 競合解決: updated_at last-write-wins
 *  - クラウド > ローカル → ローカルを上書き、synced_at を新しい updated_at に
 *  - ローカル >= クラウド → 何もしない（次回 push 時に解決される）
 *  - ローカルに無い → INSERT、synced_at = updated_at
 */
export async function pullAll(): Promise<{ mandalarts: number; grids: number; cells: number }> {
  let mCount = 0
  let gCount = 0
  let cCount = 0

  // 1. mandalarts
  const { data: cloudMandalarts, error: e1 } = await supabase
    .from('mandalarts')
    .select('id, title, created_at, updated_at')
  if (e1) throw e1

  for (const cm of (cloudMandalarts ?? []) as CloudMandalart[]) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM mandalarts WHERE id = ?', [cm.id],
    )
    if (local.length === 0) {
      await execute(
        'INSERT INTO mandalarts (id, title, created_at, updated_at, synced_at) VALUES (?,?,?,?,?)',
        [cm.id, cm.title, cm.created_at, cm.updated_at, cm.updated_at],
      )
      mCount++
    } else if (cm.updated_at > local[0].updated_at) {
      await execute(
        'UPDATE mandalarts SET title=?, updated_at=?, synced_at=? WHERE id=?',
        [cm.title, cm.updated_at, cm.updated_at, cm.id],
      )
      mCount++
    }
  }

  // 2. grids
  const { data: cloudGrids, error: e2 } = await supabase
    .from('grids')
    .select('id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at')
  if (e2) throw e2

  for (const cg of (cloudGrids ?? []) as CloudGrid[]) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM grids WHERE id = ?', [cg.id],
    )
    if (local.length === 0) {
      await execute(
        'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at, synced_at) VALUES (?,?,?,?,?,?,?,?)',
        [cg.id, cg.mandalart_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.created_at, cg.updated_at, cg.updated_at],
      )
      gCount++
    } else if (cg.updated_at > local[0].updated_at) {
      await execute(
        'UPDATE grids SET mandalart_id=?, parent_cell_id=?, sort_order=?, memo=?, updated_at=?, synced_at=? WHERE id=?',
        [cg.mandalart_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.updated_at, cg.updated_at, cg.id],
      )
      gCount++
    }
  }

  // 3. cells
  const { data: cloudCells, error: e3 } = await supabase
    .from('cells')
    .select('id, grid_id, position, text, image_path, color, created_at, updated_at')
  if (e3) throw e3

  for (const cc of (cloudCells ?? []) as CloudCell[]) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM cells WHERE id = ?', [cc.id],
    )
    if (local.length === 0) {
      await execute(
        'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [cc.id, cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.created_at, cc.updated_at, cc.updated_at],
      )
      cCount++
    } else if (cc.updated_at > local[0].updated_at) {
      await execute(
        'UPDATE cells SET grid_id=?, position=?, text=?, image_path=?, color=?, updated_at=?, synced_at=? WHERE id=?',
        [cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.updated_at, cc.updated_at, cc.id],
      )
      cCount++
    }
  }

  return { mandalarts: mCount, grids: gCount, cells: cCount }
}
