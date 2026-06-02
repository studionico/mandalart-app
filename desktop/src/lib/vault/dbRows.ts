import { query } from '@/lib/db'
import type { Mandalart, Grid, Cell } from '@/types'
import type { MandalartRows } from './types'

/**
 * DB から 1 マンダラート分の行を読む read-only ローダ (plugin-fs に依存しない = setupTestDb で
 * 単体テスト可能)。vault の flush / dry-run / 起動時再構築が共通で使う。
 */

/** SQLite の INTEGER 0/1 を boolean に正規化する (tauri-plugin-sql は INTEGER を number で返す)。 */
export function bool(v: unknown): boolean {
  return v === true || v === 1
}

/** 非削除の全マンダラート id。 */
export async function loadAllMandalartIds(): Promise<string[]> {
  const rows = await query<{ id: string }>('SELECT id FROM mandalarts WHERE deleted_at IS NULL')
  return rows.map((r) => r.id)
}

/** 1 マンダラート分の DB 行 (mandalart + folderName + grids + cells) を読む。無ければ null。 */
export async function loadMandalartRows(mandalartId: string): Promise<MandalartRows | null> {
  const ms = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE id = ? AND deleted_at IS NULL',
    [mandalartId],
  )
  const m = ms[0]
  if (!m) return null
  const mandalart: Mandalart = {
    ...m,
    show_checkbox: bool(m.show_checkbox),
    pinned: bool(m.pinned),
    locked: bool(m.locked),
  }

  let folderName = 'Inbox'
  if (m.folder_id) {
    const fs = await query<{ name: string }>('SELECT name FROM folders WHERE id = ?', [m.folder_id])
    if (fs[0]) folderName = fs[0].name
  }

  const grids = await query<Grid>(
    'SELECT * FROM grids WHERE mandalart_id = ? AND deleted_at IS NULL',
    [mandalartId],
  )
  const gridIds = grids.map((g) => g.id)
  let cells: Cell[] = []
  if (gridIds.length > 0) {
    const placeholders = gridIds.map(() => '?').join(',')
    const rows = await query<Cell>(
      `SELECT * FROM cells WHERE grid_id IN (${placeholders}) AND deleted_at IS NULL`,
      gridIds,
    )
    cells = rows.map((c) => ({ ...c, done: bool(c.done) }))
  }

  return { mandalart, folderName, grids, cells }
}
