import { query } from '@/lib/db'
import type { Mandalart, Grid, Cell } from '@/types'
import type { MandalartRows } from './types'
import { scanVault } from './io'
import { mandalartToVaultFiles, vaultFilesToRows } from './vaultModel'
import { diffFiles } from './reconcile'

/**
 * Stage 2 の read-only リコンシリエーション (DB 無改変)。
 *
 * DB を正としたまま「もし vault に書き出したら何が変わるか」を計算してログするだけの dry-run。
 * 実際の upsert / ファイル書き込み (双方向 flush) は Stage 3 で本配線する。
 * dev フラグ越しにのみ呼ばれる ([dev.ts](./dev.ts))。
 */

/** SQLite の INTEGER 0/1 を boolean に正規化する (tauri-plugin-sql は INTEGER を number で返す)。 */
function bool(v: unknown): boolean {
  return v === true || v === 1
}

/** 1 マンダラート分の DB 行を読み込む (read-only)。 */
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

export type DryRunReport = {
  vaultRoot: string
  dbMandalartCount: number
  vaultMandalartCount: number
  /** vault に存在せず DB のみ (flush なら新規書き出し対象)。 */
  onlyInDbIds: string[]
  /** DB に存在せず vault のみ (取り込みなら新規 import 対象)。 */
  onlyInVaultIds: string[]
  /** 両方に存在するマンダラートで、DB→vault flush 時に書換/削除されるファイル。 */
  perMandalart: { id: string; title: string; filesToWrite: string[]; filesToDelete: string[] }[]
}

/**
 * vault と DB を突き合わせて差分を計算しログする (DB 無改変)。返り値で内訳を確認できる。
 */
export async function dryRunCompareVaultToDb(vaultRoot: string): Promise<DryRunReport> {
  // vault 側: 各フォルダを parse して mandalart id → ファイル群 に対応付け
  const vaultDirs = await scanVault(vaultRoot)
  const vaultById = new Map<string, { files: { path: string; content: string }[] }>()
  for (const dir of vaultDirs) {
    const rows = vaultFilesToRows(dir.files)
    if (rows) vaultById.set(rows.mandalart.id, { files: dir.files })
  }

  // DB 側: 全マンダラート
  const dbMandalarts = await query<{ id: string }>(
    'SELECT id FROM mandalarts WHERE deleted_at IS NULL',
  )
  const dbIds = new Set(dbMandalarts.map((m) => m.id))

  const report: DryRunReport = {
    vaultRoot,
    dbMandalartCount: dbIds.size,
    vaultMandalartCount: vaultById.size,
    onlyInDbIds: [...dbIds].filter((id) => !vaultById.has(id)),
    onlyInVaultIds: [...vaultById.keys()].filter((id) => !dbIds.has(id)),
    perMandalart: [],
  }

  // 両方にあるものは DB→vault flush の差分を計算
  for (const id of dbIds) {
    const vault = vaultById.get(id)
    if (!vault) continue
    const rows = await loadMandalartRows(id)
    if (!rows) continue
    const desired = mandalartToVaultFiles(rows)
    const plan = diffFiles(vault.files, desired.files)
    report.perMandalart.push({
      id,
      title: rows.mandalart.title,
      filesToWrite: plan.write.map((f) => f.path),
      filesToDelete: plan.deletePaths,
    })
  }

  console.info('[vault] dry-run compare (DB 無改変):', report)
  return report
}
