import { query, execute } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'

async function tryInsert(label: string, sql: string, params: unknown[]) {
  try {
    await execute(sql, params)
  } catch (e) {
    console.error(`[pull] ${label} INSERT failed:`, params, e)
    throw e
  }
}

async function tryUpdate(label: string, sql: string, params: unknown[]) {
  try {
    await execute(sql, params)
  } catch (e) {
    console.error(`[pull] ${label} UPDATE failed:`, params, e)
    throw e
  }
}

type CloudMandalart = {
  id: string
  title: string
  root_cell_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}
type CloudGrid = {
  id: string
  mandalart_id: string
  center_cell_id: string
  parent_cell_id: string | null
  sort_order: number
  memo: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
type CloudCell = {
  id: string
  grid_id: string
  position: number
  text: string
  image_path: string | null
  color: string | null
  done: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/**
 * 現在ユーザーの全データを Supabase から取得し、ローカルに反映する。
 */
export async function pullAll(): Promise<{ mandalarts: number; grids: number; cells: number }> {
  let mCount = 0
  let gCount = 0
  let cCount = 0

  const [m, g, c] = await Promise.all([
    supabase.from('mandalarts').select('id, title, root_cell_id, created_at, updated_at, deleted_at'),
    supabase.from('grids').select('id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at'),
    supabase.from('cells').select('id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at'),
  ])
  if (m.error) throw m.error
  if (g.error) throw g.error
  if (c.error) throw c.error
  const cloudMandalarts = (m.data ?? []) as CloudMandalart[]
  const cloudGrids      = (g.data ?? []) as CloudGrid[]
  const cloudCells      = (c.data ?? []) as CloudCell[]

  // 1. mandalarts
  for (const cm of cloudMandalarts) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM mandalarts WHERE id = ?', [cm.id],
    )
    if (local.length === 0) {
      await tryInsert('mandalarts',
        'INSERT INTO mandalarts (id, title, root_cell_id, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?)',
        [cm.id, cm.title, cm.root_cell_id, cm.created_at, cm.updated_at, cm.deleted_at, cm.updated_at],
      )
      mCount++
    } else if (cm.updated_at > local[0].updated_at) {
      await tryUpdate('mandalarts',
        'UPDATE mandalarts SET title=?, root_cell_id=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cm.title, cm.root_cell_id, cm.updated_at, cm.deleted_at, cm.updated_at, cm.id],
      )
      mCount++
    }
  }

  // 2. grids
  for (const cg of cloudGrids) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM grids WHERE id = ?', [cg.id],
    )
    if (local.length === 0) {
      await tryInsert('grids',
        'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [cg.id, cg.mandalart_id, cg.center_cell_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.created_at, cg.updated_at, cg.deleted_at, cg.updated_at],
      )
      gCount++
    } else if (cg.updated_at > local[0].updated_at) {
      await tryUpdate('grids',
        'UPDATE grids SET mandalart_id=?, center_cell_id=?, parent_cell_id=?, sort_order=?, memo=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cg.mandalart_id, cg.center_cell_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.updated_at, cg.deleted_at, cg.updated_at, cg.id],
      )
      gCount++
    }
  }

  // 3. cells
  for (const cc of cloudCells) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM cells WHERE id = ?', [cc.id],
    )
    if (local.length === 0) {
      await tryInsert('cells',
        'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [cc.id, cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.done ? 1 : 0, cc.created_at, cc.updated_at, cc.deleted_at, cc.updated_at],
      )
      cCount++
    } else if (cc.updated_at > local[0].updated_at) {
      await tryUpdate('cells',
        'UPDATE cells SET grid_id=?, position=?, text=?, image_path=?, color=?, done=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.done ? 1 : 0, cc.updated_at, cc.deleted_at, cc.updated_at, cc.id],
      )
      cCount++
    }
  }

  return { mandalarts: mCount, grids: gCount, cells: cCount }
}
