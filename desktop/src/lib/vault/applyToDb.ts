import { query, execute, generateId, now } from '@/lib/db'
import type { Mandalart, Grid, Cell } from '@/types'
import type { MandalartRows } from './types'

/**
 * file→DB 適用 (Stage 3b の核心、**実 DB 書込み**)。vault を正として DB キャッシュを再構築する。
 *
 * - upsert は `INSERT ... ON CONFLICT(id) DO UPDATE` (synced_at/remote_id は温存、deleted_at は復活)。
 * - フォルダは folder_name で ensure (vault は folder_id を持たない)。
 * - 適用した各マンダラート内で vault に無い grid/cell は削除 (canonical 反映)。
 * - `skipGridDeletionFor` に含む mandalart は intra-mandalart の grid/cell 削除をスキップする
 *   (= grid ファイルの parse 失敗があったマンダラート。破損ファイルを「vault に無い grid」と
 *   誤認して DB から消す事故=データ損失を防ぐため、その回は upsert のみ行う)。
 * - `deleteMissingMandalarts` を立てたときのみ vault に無いマンダラート全体を削除する
 *   (= 完全 rebuild。空 vault 誤適用での全消し事故を防ぐため既定 false)。
 *
 * **本番経路からは未呼び出し** (vaultMode 反転は別ステップ)。dev / テストからのみ実行される。
 */

export type ApplyOptions = {
  deleteMissingMandalarts?: boolean
  /** この mandalart id 群は intra-mandalart の grid/cell 削除をスキップ (parse 失敗時の保護)。 */
  skipGridDeletionFor?: Set<string>
}
export type ApplyReport = {
  mandalarts: number
  grids: number
  cells: number
  deletedMandalarts: number
}

async function ensureFolderByName(name: string): Promise<string> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM folders WHERE name = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
    [name],
  )
  if (rows[0]) return rows[0].id
  const id = generateId()
  const ts = now()
  const mx = await query<{ m: number | null }>(
    'SELECT MAX(sort_order) AS m FROM folders WHERE deleted_at IS NULL',
  )
  const sortOrder = (mx[0]?.m ?? -1) + 1
  await execute(
    'INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,0,?,?)',
    [id, name, sortOrder, ts, ts],
  )
  return id
}

async function upsertMandalart(m: Mandalart, folderId: string): Promise<void> {
  await execute(
    `INSERT INTO mandalarts
       (id, title, root_cell_id, folder_id, show_checkbox, last_grid_id, sort_order, pinned, locked, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, root_cell_id=excluded.root_cell_id, folder_id=excluded.folder_id,
       show_checkbox=excluded.show_checkbox, last_grid_id=excluded.last_grid_id, sort_order=excluded.sort_order,
       pinned=excluded.pinned, locked=excluded.locked, created_at=excluded.created_at,
       updated_at=excluded.updated_at, deleted_at=NULL`,
    [
      m.id, m.title, m.root_cell_id, folderId, m.show_checkbox ? 1 : 0, m.last_grid_id ?? null,
      m.sort_order ?? null, m.pinned ? 1 : 0, m.locked ? 1 : 0, m.created_at, m.updated_at,
    ],
  )
}

async function upsertGrid(g: Grid): Promise<void> {
  await execute(
    `INSERT INTO grids
       (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET
       mandalart_id=excluded.mandalart_id, center_cell_id=excluded.center_cell_id,
       parent_cell_id=excluded.parent_cell_id, sort_order=excluded.sort_order, memo=excluded.memo,
       created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=NULL`,
    [g.id, g.mandalart_id, g.center_cell_id, g.parent_cell_id, g.sort_order, g.memo, g.created_at, g.updated_at],
  )
}

async function upsertCell(c: Cell): Promise<void> {
  await execute(
    `INSERT INTO cells
       (id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET
       grid_id=excluded.grid_id, position=excluded.position, text=excluded.text,
       image_path=excluded.image_path, color=excluded.color, done=excluded.done,
       created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=NULL`,
    [c.id, c.grid_id, c.position, c.text, c.image_path, c.color, c.done ? 1 : 0, c.created_at, c.updated_at],
  )
}

/** vault 由来の行群を DB に適用する (実 DB 書込み)。 */
export async function applyVaultRowsToDb(
  all: MandalartRows[],
  opts: ApplyOptions = {},
): Promise<ApplyReport> {
  const report: ApplyReport = { mandalarts: 0, grids: 0, cells: 0, deletedMandalarts: 0 }
  const vaultMandalartIds = new Set(all.map((r) => r.mandalart.id))

  for (const rows of all) {
    const folderId = await ensureFolderByName(rows.folderName)
    await upsertMandalart(rows.mandalart, folderId)
    report.mandalarts++

    const vaultGridIds = new Set(rows.grids.map((g) => g.id))
    for (const g of rows.grids) {
      await upsertGrid(g)
      report.grids++
    }
    const vaultCellIds = new Set(rows.cells.map((c) => c.id))
    for (const c of rows.cells) {
      await upsertCell(c)
      report.cells++
    }

    // parse 失敗があったマンダラートは削除をスキップ (破損ファイルでの誤削除=データ損失を防ぐ)
    if (!opts.skipGridDeletionFor?.has(rows.mandalart.id)) {
      // vault に無い grid (とその cells) を削除
      const dbGrids = await query<{ id: string }>(
        'SELECT id FROM grids WHERE mandalart_id = ? AND deleted_at IS NULL',
        [rows.mandalart.id],
      )
      for (const g of dbGrids) {
        if (!vaultGridIds.has(g.id)) {
          await execute('DELETE FROM cells WHERE grid_id = ?', [g.id])
          await execute('DELETE FROM grids WHERE id = ?', [g.id])
        }
      }
      // 残った grid 内で vault に無い cell を削除
      const dbCells = await query<{ id: string }>(
        'SELECT c.id FROM cells c JOIN grids g ON c.grid_id = g.id WHERE g.mandalart_id = ? AND c.deleted_at IS NULL',
        [rows.mandalart.id],
      )
      for (const c of dbCells) {
        if (!vaultCellIds.has(c.id)) await execute('DELETE FROM cells WHERE id = ?', [c.id])
      }
    }
  }

  if (opts.deleteMissingMandalarts) {
    const dbM = await query<{ id: string }>('SELECT id FROM mandalarts WHERE deleted_at IS NULL')
    for (const m of dbM) {
      if (!vaultMandalartIds.has(m.id)) {
        await execute(
          'DELETE FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)',
          [m.id],
        )
        await execute('DELETE FROM grids WHERE mandalart_id = ?', [m.id])
        await execute('DELETE FROM mandalarts WHERE id = ?', [m.id])
        report.deletedMandalarts++
      }
    }
  }

  return report
}
