import { join } from '@tauri-apps/api/path'
import { query } from '@/lib/db'
import { scanVault, ensureDir, writeVaultFile, removeVaultFile } from './io'
import { mandalartToVaultFiles, vaultFilesToRows } from './vaultModel'
import { diffFiles } from './reconcile'
import { loadMandalartRows, loadAllMandalartIds } from './dbRows'
import { applyVaultRowsToDb, type ApplyOptions, type ApplyReport } from './applyToDb'
import type { MandalartRows, VaultFile } from './types'

/**
 * Stage 2/3a の vault リコンシリエーション。
 *
 * - `dryRunCompareVaultToDb`: DB を正としたまま「vault に書き出したら何が変わるか」を計算してログ
 *   するだけ (DB / ファイル無改変)。
 * - `exportAllToVault`: DB→vault の **一方向書き出し** (ファイルのみ作成/上書き、DB は無改変、既存
 *   ファイルの削除もしない非破壊)。危険な file→DB 再構築・双方向 flush は次ステップで本配線する。
 */

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

/** vault と DB を突き合わせて差分を計算しログする (DB / ファイル無改変)。返り値で内訳を確認できる。 */
export async function dryRunCompareVaultToDb(vaultRoot: string): Promise<DryRunReport> {
  const vaultDirs = await scanVault(vaultRoot)
  const vaultById = new Map<string, { files: { path: string; content: string }[] }>()
  for (const dir of vaultDirs) {
    const rows = vaultFilesToRows(dir.files)
    if (rows) vaultById.set(rows.mandalart.id, { files: dir.files })
  }

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

export type ExportReport = { mandalartCount: number; fileCount: number }

/**
 * DB 全マンダラートを vault フォルダへ一方向書き出しする (ファイルのみ、DB 無改変)。
 * 既存ファイルの削除は行わない (非破壊)。「DB を空 vault に移行」の安全な前半。
 */
export async function exportAllToVault(vaultRoot: string): Promise<ExportReport> {
  await ensureDir(vaultRoot)
  const ids = await loadAllMandalartIds()
  let fileCount = 0
  for (const id of ids) {
    const rows = await loadMandalartRows(id)
    if (!rows) continue
    const { dirName, files } = mandalartToVaultFiles(rows)
    const dirAbs = await join(vaultRoot, dirName)
    await ensureDir(dirAbs)
    for (const f of files) {
      await writeVaultFile(await join(dirAbs, f.path), f.content)
      fileCount++
    }
  }
  const report: ExportReport = { mandalartCount: ids.length, fileCount }
  console.info('[vault] export DB→vault (ファイルのみ、DB 無改変):', report)
  return report
}

export type FlushReport = { mandalartCount: number; written: number; deleted: number }

/**
 * DB→vault の差分 flush (ファイルのみ書込み)。各 DB マンダラートについて、既存 vault フォルダ
 * (mandalart id 一致で探す。無ければ新規 dirName) 内のファイルと desired を diff し、変化分だけ
 * 書き、不要になった `.md` を削除する。フォルダ名は cosmetic なので既存があればそれを再利用
 * (title 変更で dir が乱立しない)。DB で消えたマンダラートのフォルダは**削除しない** (非破壊、
 * 別途レビュー)。dev のドッグフードで「アプリ編集 → flush → ファイル反映」を回すのに使う。
 */
export async function flushDbToVault(vaultRoot: string): Promise<FlushReport> {
  await ensureDir(vaultRoot)
  const dirs = await scanVault(vaultRoot)
  const existingById = new Map<string, { dirName: string; files: VaultFile[] }>()
  for (const d of dirs) {
    const rows = vaultFilesToRows(d.files)
    if (rows) existingById.set(rows.mandalart.id, { dirName: d.dirName, files: d.files })
  }

  const ids = await loadAllMandalartIds()
  let written = 0
  let deleted = 0
  for (const id of ids) {
    const rows = await loadMandalartRows(id)
    if (!rows) continue
    const desired = mandalartToVaultFiles(rows)
    const existing = existingById.get(id)
    const dirAbs = await join(vaultRoot, existing?.dirName ?? desired.dirName)
    await ensureDir(dirAbs)
    const plan = diffFiles(existing?.files ?? [], desired.files)
    for (const f of plan.write) {
      await writeVaultFile(await join(dirAbs, f.path), f.content)
      written++
    }
    for (const p of plan.deletePaths) {
      await removeVaultFile(await join(dirAbs, p))
      deleted++
    }
  }

  const report: FlushReport = { mandalartCount: ids.length, written, deleted }
  console.info('[vault] flush DB→vault (差分書き出し):', report)
  return report
}

/**
 * vault→DB 再構築 (**実 DB 書込み**)。vault をスキャン → parse → applyVaultRowsToDb。
 * 本番経路からは未呼び出し (vaultMode 反転は別ステップ)。dev / Stage 3b-final の起動時再構築で使う。
 * `deleteMissingMandalarts` は既定 false (空 vault 誤適用での全消し防止)。
 */
export async function reconcileVaultToDb(
  vaultRoot: string,
  opts: ApplyOptions = {},
): Promise<ApplyReport> {
  const dirs = await scanVault(vaultRoot)
  const all = dirs
    .map((d) => vaultFilesToRows(d.files))
    .filter((r): r is MandalartRows => r !== null)
  const report = await applyVaultRowsToDb(all, opts)
  console.warn('[vault] file→DB 再構築 (実 DB 書込み):', report)
  return report
}
