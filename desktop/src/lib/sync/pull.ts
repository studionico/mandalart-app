import { query, execute } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'
import { withSyncLock } from './lock'
import { idsToDelete } from './reconcileDeletions'

/**
 * PostgREST のデフォルト max-rows。cloud fetch がこの件数ちょうどだと truncation
 * (= cloud 行を取りこぼしている) の疑いがあるため、その種別の reconcile を skip する。
 */
const POSTGREST_ROW_LIMIT = 1000

/**
 * per-row INSERT。1 行失敗しても **throw せず log して続行** する (落とし穴 #24 Realtime 復帰)。
 * 従来は rethrow して pull パス全体を中断していたが、1 行の衝突 (スロット分岐など) で残り行が
 * 次回まで未取込になる部分同期を招いていた。レース自体は withSyncLock で根絶し、ここはレース後も
 * 残りうる真の乖離 (= スロット分岐) に対する耐性として log+continue にする。
 * @returns 成功なら true
 */
async function tryInsert(label: string, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await execute(sql, params)
    return true
  } catch (e) {
    console.error(`[pull] ${label} INSERT failed:`, params, e)
    return false
  }
}

async function tryUpdate(label: string, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await execute(sql, params)
    return true
  } catch (e) {
    console.error(`[pull] ${label} UPDATE failed:`, params, e)
    return false
  }
}

type CloudMandalart = {
  id: string
  title: string
  root_cell_id: string
  show_checkbox: boolean
  last_grid_id: string | null
  sort_order: number | null
  pinned: boolean
  folder_id: string | null
  locked: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}
type CloudFolder = {
  id: string
  name: string
  sort_order: number
  is_system: boolean
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
  // 書き込みを withSyncLock で直列化し、realtime apply / 並行 pullAll との read-then-write レースを
  // 根絶する (落とし穴 #24)。ロックは fetch も含めて囲い、操作全体を atomic にする。
  return withSyncLock(async () => {
  let mCount = 0
  let gCount = 0
  let cCount = 0

  const [f, m, g, c] = await Promise.all([
    supabase.from('folders').select('id, name, sort_order, is_system, created_at, updated_at, deleted_at'),
    supabase.from('mandalarts').select('id, title, root_cell_id, show_checkbox, last_grid_id, sort_order, pinned, folder_id, locked, created_at, updated_at, deleted_at'),
    supabase.from('grids').select('id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at'),
    supabase.from('cells').select('id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at'),
  ])
  if (f.error) throw f.error
  if (m.error) throw m.error
  if (g.error) throw g.error
  if (c.error) throw c.error
  const cloudFolders    = (f.data ?? []) as CloudFolder[]
  const cloudMandalarts = (m.data ?? []) as CloudMandalart[]
  const cloudGrids      = (g.data ?? []) as CloudGrid[]
  const cloudCells      = (c.data ?? []) as CloudCell[]

  // 0. folders (mandalarts.folder_id が参照するため最初に)
  for (const cf of cloudFolders) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM folders WHERE id = ?', [cf.id],
    )
    if (local.length === 0) {
      await tryInsert('folders',
        'INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?)',
        [cf.id, cf.name, cf.sort_order, cf.is_system ? 1 : 0, cf.created_at, cf.updated_at, cf.deleted_at, cf.updated_at],
      )
    } else if (cf.updated_at > local[0].updated_at) {
      await tryUpdate('folders',
        'UPDATE folders SET name=?, sort_order=?, is_system=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cf.name, cf.sort_order, cf.is_system ? 1 : 0, cf.updated_at, cf.deleted_at, cf.updated_at, cf.id],
      )
    }
  }

  // 1. mandalarts
  for (const cm of cloudMandalarts) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM mandalarts WHERE id = ?', [cm.id],
    )
    if (local.length === 0) {
      if (await tryInsert('mandalarts',
        'INSERT INTO mandalarts (id, title, root_cell_id, show_checkbox, last_grid_id, sort_order, pinned, folder_id, locked, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [cm.id, cm.title, cm.root_cell_id, cm.show_checkbox ? 1 : 0, cm.last_grid_id ?? null, cm.sort_order ?? null, cm.pinned ? 1 : 0, cm.folder_id ?? null, cm.locked ? 1 : 0, cm.created_at, cm.updated_at, cm.deleted_at, cm.updated_at],
      )) mCount++
    } else if (cm.updated_at > local[0].updated_at) {
      if (await tryUpdate('mandalarts',
        'UPDATE mandalarts SET title=?, root_cell_id=?, show_checkbox=?, last_grid_id=?, sort_order=?, pinned=?, folder_id=?, locked=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cm.title, cm.root_cell_id, cm.show_checkbox ? 1 : 0, cm.last_grid_id ?? null, cm.sort_order ?? null, cm.pinned ? 1 : 0, cm.folder_id ?? null, cm.locked ? 1 : 0, cm.updated_at, cm.deleted_at, cm.updated_at, cm.id],
      )) mCount++
    }
  }

  // 2. grids
  for (const cg of cloudGrids) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM grids WHERE id = ?', [cg.id],
    )
    if (local.length === 0) {
      if (await tryInsert('grids',
        'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [cg.id, cg.mandalart_id, cg.center_cell_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.created_at, cg.updated_at, cg.deleted_at, cg.updated_at],
      )) gCount++
    } else if (cg.updated_at > local[0].updated_at) {
      if (await tryUpdate('grids',
        'UPDATE grids SET mandalart_id=?, center_cell_id=?, parent_cell_id=?, sort_order=?, memo=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cg.mandalart_id, cg.center_cell_id, cg.parent_cell_id, cg.sort_order, cg.memo, cg.updated_at, cg.deleted_at, cg.updated_at, cg.id],
      )) gCount++
    }
  }

  // 3. cells
  for (const cc of cloudCells) {
    const local = await query<{ updated_at: string }>(
      'SELECT updated_at FROM cells WHERE id = ?', [cc.id],
    )
    if (local.length === 0) {
      // cells は id PK と (grid_id, position) UNIQUE の 2 制約を持つ。後者の衝突 (= 同スロットに
      // 別 id セルが既にある乖離) でも pull 全体を止めないよう tryInsert で log+continue する。
      if (await tryInsert('cells',
        'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [cc.id, cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.done ? 1 : 0, cc.created_at, cc.updated_at, cc.deleted_at, cc.updated_at],
      )) cCount++
    } else if (cc.updated_at > local[0].updated_at) {
      if (await tryUpdate('cells',
        'UPDATE cells SET grid_id=?, position=?, text=?, image_path=?, color=?, done=?, updated_at=?, deleted_at=?, synced_at=? WHERE id=?',
        [cc.grid_id, cc.position, cc.text, cc.image_path, cc.color, cc.done ? 1 : 0, cc.updated_at, cc.deleted_at, cc.updated_at, cc.id],
      )) cCount++
    }
  }

  // 4. reconcile: cloud から物理 hard delete された mandalart / grid をローカルからも消す。
  //    upsert は「cloud にあって local に無い行」を取り込むだけで「cloud から消えた行」を
  //    検知できないため、対向デバイスの permanentDelete* (cloud DELETE) がここで初めて伝播する。
  //    synced_at IS NOT NULL (= 過去に push 済) の行だけを対象にし、未 push の local-only 行
  //    (synced_at IS NULL) は絶対に消さない。cell 単体の物理削除経路は無い (必ず grid/mandalart
  //    の cascade) ので reconcile 対象は mandalart + grid のみ。配下 cell は cascade で消す。
  await reconcileRemoteDeletions(
    new Set(cloudMandalarts.map((cm) => cm.id)),
    new Set(cloudGrids.map((cg) => cg.id)),
    cloudMandalarts.length >= POSTGREST_ROW_LIMIT,
    cloudGrids.length >= POSTGREST_ROW_LIMIT,
  )

  return { mandalarts: mCount, grids: gCount, cells: cCount }
  })
}

/**
 * cloud に存在しない (= 他デバイスで hard delete された) ローカルの mandalart / grid を
 * 配下ごと hard delete する。`pullAll` の withSyncLock 内から呼ばれる。
 */
async function reconcileRemoteDeletions(
  cloudMandalartIds: Set<string>,
  cloudGridIds: Set<string>,
  mandalartTruncated: boolean,
  gridTruncated: boolean,
): Promise<void> {
  // 1. mandalart reconcile (+ 配下 grid/cell を cascade)
  if (!mandalartTruncated) {
    const localMandalarts = await query<{ id: string; synced_at: string | null }>(
      'SELECT id, synced_at FROM mandalarts',
    )
    const toDelete = idsToDelete(
      localMandalarts.map((m) => ({ id: m.id, synced: m.synced_at != null })),
      cloudMandalartIds,
      false,
    )
    for (const id of toDelete) {
      await execute(
        'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
        [id],
      )
      await execute('DELETE FROM grids WHERE mandalart_id = ?', [id])
      await execute('DELETE FROM mandalarts WHERE id = ?', [id])
    }
    if (toDelete.size > 0) {
      console.log('[pull] reconciled remote-deleted mandalarts:', toDelete.size)
    }
  }

  // 2. grid reconcile (mandalart 健在で並列グリッド等だけ permanentDeleteGrid されたケース)
  if (!gridTruncated) {
    const localGrids = await query<{ id: string; synced_at: string | null }>(
      'SELECT id, synced_at FROM grids',
    )
    const toDelete = idsToDelete(
      localGrids.map((g) => ({ id: g.id, synced: g.synced_at != null })),
      cloudGridIds,
      false,
    )
    for (const id of toDelete) {
      await execute('DELETE FROM cells WHERE grid_id = ?', [id])
      await execute('DELETE FROM grids WHERE id = ?', [id])
    }
    if (toDelete.size > 0) {
      console.log('[pull] reconciled remote-deleted grids:', toDelete.size)
    }
  }
}
