import { join } from '@tauri-apps/api/path'
import { query } from '@/lib/db'
import { scanVault, scanMandalartDir, ensureDir, writeVaultFile, removeVaultFile, removeDir } from './io'
import { mandalartToVaultFiles, vaultFilesToRows, MANDALART_DOC_NAME } from './vaultModel'
import { docContentEquivalent } from './vaultFormat'
import { diffFiles, hashContent } from './reconcile'
import { writeLedger } from './vaultWriteLedger'
import { loadMandalartRows, loadAllMandalartIds } from './dbRows'
import { applyVaultRowsToDb, type ApplyOptions, type ApplyReport } from './applyToDb'
import { flushImagesToVault, restoreImagesFromVault } from './imageVault'
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

export type ExportReport = { mandalartCount: number; fileCount: number; imagesCopied: number }

/**
 * DB 全マンダラートを vault フォルダへ一方向書き出しする (.md + 画像、DB 無改変)。
 * 既存ファイルの削除は行わない (非破壊)。「DB を空 vault に移行」の安全な前半。
 */
export async function exportAllToVault(vaultRoot: string): Promise<ExportReport> {
  await ensureDir(vaultRoot)
  const ids = await loadAllMandalartIds()
  let fileCount = 0
  let imagesCopied = 0
  for (const id of ids) {
    const rows = await loadMandalartRows(id)
    if (!rows) continue
    const { dirName, files } = mandalartToVaultFiles(rows)
    const dirAbs = await join(vaultRoot, dirName)
    await ensureDir(dirAbs)
    for (const f of files) {
      const absPath = await join(dirAbs, f.path)
      await writeVaultFile(absPath, f.content)
      writeLedger.record(absPath, await hashContent(f.content)) // baseline を「既知」にし watcher が外部扱いしない
      fileCount++
    }
    try {
      imagesCopied += await flushImagesToVault(vaultRoot, rows.cells)
    } catch (e) {
      console.error('[vault] 画像コピー失敗 (export, 続行):', e)
    }
  }
  const report: ExportReport = { mandalartCount: ids.length, fileCount, imagesCopied }
  console.info('[vault] export DB→vault (.md + 画像、DB 無改変):', report)
  return report
}

export type FlushReport = {
  mandalartCount: number
  written: number
  deleted: number
  deletedDirs: number
  imagesCopied: number
}

/**
 * DB→vault の差分 flush (ファイルのみ書込み)。各 DB マンダラートについて、既存 vault フォルダ
 * (mandalart id 一致で探す。無ければ新規 dirName) 内のファイルと desired を diff し、変化分だけ
 * 書き、不要になった `.md` を削除する。フォルダ名は cosmetic なので既存があればそれを再利用
 * (title 変更で dir が乱立しない)。
 *
 * **DB live に存在しないマンダラートの vault フォルダは削除する** (= アプリ削除を vault に反映)。
 * ただし `loadAllMandalartIds` が 0 件 (DB が空/壊れている) のときはフォルダ削除を**一切しない**
 * (空 DB 誤適用で vault を全消しする事故を防ぐ)。ゴミ箱 (soft-delete) も deleted_at IS NULL で
 * live から外れるためフォルダが消えるが、復元すれば次の flush で再生成され往復する。
 *
 * dev のドッグフードで「アプリ編集/削除 → flush → ファイル反映」を回すのに使う。
 */
export async function flushDbToVault(
  vaultRoot: string,
  opts: { onlyMandalartIds?: Set<string> } = {},
): Promise<FlushReport> {
  await ensureDir(vaultRoot)
  const dirs = await scanVault(vaultRoot)
  const existingById = new Map<string, { dirName: string; files: VaultFile[] }>()
  for (const d of dirs) {
    const rows = vaultFilesToRows(d.files)
    if (rows) existingById.set(rows.mandalart.id, { dirName: d.dirName, files: d.files })
  }

  // スコープ指定 (watcher の reconcile 直後の確実な書き戻し用) のときは対象マンダラートだけ flush。
  const allIds = await loadAllMandalartIds()
  const ids = opts.onlyMandalartIds ? allIds.filter((id) => opts.onlyMandalartIds!.has(id)) : allIds
  let written = 0
  let deleted = 0
  let imagesCopied = 0
  for (const id of ids) {
    const rows = await loadMandalartRows(id)
    if (!rows) continue
    const desired = mandalartToVaultFiles(rows)
    const existing = existingById.get(id)

    // stale な `untitled-*` フォルダ (作成直後に title 列が空だったため) は、実タイトルが入った今
    // 正しいフォルダ名へリネームする。リネーム時は新フォルダに全 .md を書いて旧フォルダを削除する。
    const renameFrom =
      existing && existing.dirName !== desired.dirName && existing.dirName.startsWith('untitled-')
        ? existing.dirName
        : null
    const dirAbs = await join(vaultRoot, renameFrom ? desired.dirName : (existing?.dirName ?? desired.dirName))
    await ensureDir(dirAbs)

    if (renameFrom) {
      for (const f of desired.files) {
        const absPath = await join(dirAbs, f.path)
        await writeVaultFile(absPath, f.content)
        writeLedger.record(absPath, await hashContent(f.content))
        written++
      }
      await removeDir(await join(vaultRoot, renameFrom))
    } else {
      // churn 回避: 既存と desired が `updated_at` だけの差のファイル (grid / mandalart 共通) は
      // desired の内容を既存のものに差し替えて書き換えを抑止する。ナビゲーション等で grid/mandalart の
      // updated_at が bump されても、content が同じならファイルを書き換えない。
      const exMap = new Map((existing?.files ?? []).map((f) => [f.path, f.content]))
      for (let i = 0; i < desired.files.length; i++) {
        const ex = exMap.get(desired.files[i].path)
        if (ex !== undefined && ex !== desired.files[i].content && docContentEquivalent(ex, desired.files[i].content)) {
          desired.files[i] = { ...desired.files[i], content: ex }
        }
      }

      const plan = diffFiles(existing?.files ?? [], desired.files)
      for (const f of plan.write) {
        const absPath = await join(dirAbs, f.path)
        const ex = exMap.get(f.path)
        // clobber ガード: 既存 disk が前回同期以降に外部編集されていたら上書きしない (watcher→reconcile
        // が取り込む)。新規 file (ex undefined) はガード対象外。
        if (ex !== undefined && writeLedger.isExternallyModified(absPath, await hashContent(ex))) {
          console.info('[vault] flush skip (外部編集を保護):', f.path)
          continue
        }
        await writeVaultFile(absPath, f.content)
        writeLedger.record(absPath, await hashContent(f.content))
        written++
      }
      for (const p of plan.deletePaths) {
        await removeVaultFile(await join(dirAbs, p))
        deleted++
      }
    }
    try {
      imagesCopied += await flushImagesToVault(vaultRoot, rows.cells)
    } catch (e) {
      console.error('[vault] 画像コピー失敗 (flush, 続行):', e)
    }
  }

  // DB live に無くなったマンダラートの vault フォルダを削除 (アプリ削除を反映)。
  // 空 DB ガード: live が 0 件のときは何も消さない (誤適用での全消し防止)。
  // スコープ flush (onlyMandalartIds) のときは**フォルダ削除をしない** (対象外マンダラートを誤って
  // 全消ししないため。全体 flush=auto-flush のときだけ削除反映する)。
  let deletedDirs = 0
  if (!opts.onlyMandalartIds && ids.length > 0) {
    const dbIdSet = new Set(ids)
    for (const [mid, info] of existingById) {
      if (!dbIdSet.has(mid)) {
        await removeDir(await join(vaultRoot, info.dirName))
        deletedDirs++
      }
    }
  }

  const report: FlushReport = { mandalartCount: ids.length, written, deleted, deletedDirs, imagesCopied }
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
  const all: MandalartRows[] = []
  // grid ファイルの parse 失敗があったマンダラートは「vault に無い grid」を消さない (データ損失防止)。
  // 検知: フォルダ内の grid .md 数 (= _mandalart.md 以外) より parse できた grid 数が少なければ失敗あり。
  const skipGridDeletionFor = new Set<string>()
  for (const d of dirs) {
    // 取り込んだ disk 状態を台帳に記録 (続く auto-flush の正準化書き戻しが clobber ガードを通過でき、
    // watcher の echo-skip 基準にもなる)。parse 成否に関わらず全 file を記録する。
    for (const f of d.files) {
      writeLedger.record(await join(vaultRoot, d.dirName, f.path), await hashContent(f.content))
    }
    // applyBody:true = 本文 (人間可読ビュー) の編集を frontmatter にマージして DB へ反映 (本文ラウンドトリップ)。
    const rows = vaultFilesToRows(d.files, true)
    if (!rows) continue
    all.push(rows)
    const gridFileCount = d.files.filter(
      (f) => f.path !== MANDALART_DOC_NAME && f.path.endsWith('.md'),
    ).length
    if (rows.grids.length < gridFileCount) skipGridDeletionFor.add(rows.mandalart.id)
  }
  const report = await applyVaultRowsToDb(all, { ...opts, skipGridDeletionFor })
  // vault attachments → AppData/images へ画像を復元 (ローカルに無い分だけ)。失敗は rebuild を止めない。
  let imagesRestored = 0
  try {
    imagesRestored = await restoreImagesFromVault(vaultRoot, all.flatMap((r) => r.cells))
  } catch (e) {
    console.error('[vault] 画像復元失敗 (reconcile, 続行):', e)
  }
  console.warn('[vault] file→DB 再構築 (実 DB 書込み):', report, {
    skippedGridDeletion: [...skipGridDeletionFor],
    imagesRestored,
  })
  return report
}

/**
 * vault→DB 再構築の **スコープ版** (ライブ watcher 用、実 DB 書込み)。指定した dirName のフォルダ
 * だけを scan→取り込む。`applyVaultRowsToDb` の grid/cell 削除はマンダラート単位 (`WHERE mandalart_id`)
 * なので、渡したマンダラートだけが同期され他は無改変。`deleteMissingMandalarts:false` 固定で
 * 他マンダラート削除もしない。1 セル編集で vault 全体を再構築するコストを避けるための最適化。
 *
 * **echo-skip (per-dir)**: フォルダ内 .md が全て [writeLedger] と一致 (= 自分の書込みの反響) なら、
 * その dir は取り込まない。1 つでも外部編集があれば ledger 更新 + 取り込み。返り値の `mandalartIds`
 * が取り込んだマンダラート (空なら全 echo)。caller はこの id で DB→vault の確実な書き戻しに使える。
 */
export async function reconcileVaultDirs(
  vaultRoot: string,
  dirNames: string[],
): Promise<{ report: ApplyReport; mandalartIds: string[] }> {
  const all: MandalartRows[] = []
  const skipGridDeletionFor = new Set<string>()
  for (const dirName of dirNames) {
    let files: VaultFile[]
    try {
      files = await scanMandalartDir(await join(vaultRoot, dirName))
    } catch {
      continue // フォルダ消失など (削除は full reconcile / 再起動に委ねる)
    }
    if (!files.some((f) => f.path === MANDALART_DOC_NAME)) continue // 不完全フォルダは skip

    // 各 .md の hash を 1 回計算し、外部変更の有無を判定する。
    const hashes: { abs: string; hash: string }[] = []
    let external = false
    for (const f of files) {
      const abs = await join(vaultRoot, dirName, f.path)
      const hash = await hashContent(f.content)
      hashes.push({ abs, hash })
      if (writeLedger.isExternallyModified(abs, hash)) external = true
    }
    if (!external) continue // 全て自分の書込みの反響 (echo) → 取り込まない

    for (const { abs, hash } of hashes) writeLedger.record(abs, hash)
    const rows = vaultFilesToRows(files, true)
    if (!rows) continue
    all.push(rows)
    const gridFileCount = files.filter(
      (f) => f.path !== MANDALART_DOC_NAME && f.path.endsWith('.md'),
    ).length
    if (rows.grids.length < gridFileCount) skipGridDeletionFor.add(rows.mandalart.id)
  }

  const report = await applyVaultRowsToDb(all, { skipGridDeletionFor, deleteMissingMandalarts: false })
  try {
    await restoreImagesFromVault(vaultRoot, all.flatMap((r) => r.cells))
  } catch (e) {
    console.error('[vault] 画像復元失敗 (scoped reconcile, 続行):', e)
  }
  if (report.mandalarts > 0) {
    console.info('[vault] watcher import vault→DB (scoped):', report, { dirs: all.length })
  }
  return { report, mandalartIds: all.map((r) => r.mandalart.id) }
}
