import { join } from '@tauri-apps/api/path'
import type { Cell } from '@/types'
import { attachmentName } from './vaultFormat'
import {
  ensureDir,
  pathExists,
  appDataExists,
  readAppDataBytes,
  writeAppDataBytes,
  readBytesAbs,
  writeBytesAbs,
} from './io'

/**
 * セル画像の vault attachments 化 (vaultMode を cloud 非依存にする)。
 *
 * 画像バイトはアプリ内では `$APPDATA/images/<basename>` にあり、`cell.image_path` は
 * `images/<basename>` (DB の正)。本モジュールは flush 時に vault ルート直下 `attachments/<basename>`
 * へコピーし、rebuild 時に vault→AppData へ書き戻す。**image_path の意味は変えない**ので、アプリの
 * 画像表示経路 (storage.ts: AppData/images を読む) は無改変で動く。
 */

export const ATTACHMENTS_DIR = 'attachments'

/** image_path を持つセルだけを抽出 (型を絞る)。 */
function withImage(cells: Cell[]): Array<Cell & { image_path: string }> {
  return cells.filter((c): c is Cell & { image_path: string } => !!c.image_path)
}

/**
 * AppData/images → vault `attachments/` へ画像をコピー (コピー先が無いものだけ、best-effort)。
 * ファイル名は `<cellId>-<ts>.jpg` で内容不変なので「無ければ書く」で済む。コピー数を返す。
 */
export async function flushImagesToVault(vaultRoot: string, cells: Cell[]): Promise<number> {
  const targets = withImage(cells)
  if (targets.length === 0) return 0
  const dir = await join(vaultRoot, ATTACHMENTS_DIR)
  let ensured = false
  let copied = 0
  for (const cell of targets) {
    const name = attachmentName(cell.image_path)
    const dest = await join(dir, name)
    if (await pathExists(dest)) continue
    const bytes = await readAppDataBytes(cell.image_path)
    if (!bytes) continue // ローカルに無ければ skip (cloud 由来未 download 等)
    if (!ensured) {
      await ensureDir(dir)
      ensured = true
    }
    await writeBytesAbs(dest, bytes)
    copied++
  }
  return copied
}

/**
 * vault `attachments/` → AppData/images へ画像を復元 (ローカルに無いものだけ、best-effort)。
 * 別マシンに vault フォルダだけ持ってきた場合に画像を戻す。復元数を返す。
 */
export async function restoreImagesFromVault(vaultRoot: string, cells: Cell[]): Promise<number> {
  const targets = withImage(cells)
  if (targets.length === 0) return 0
  const dir = await join(vaultRoot, ATTACHMENTS_DIR)
  let restored = 0
  for (const cell of targets) {
    if (await appDataExists(cell.image_path)) continue // 既にローカルにある
    const name = attachmentName(cell.image_path)
    const bytes = await readBytesAbs(await join(dir, name))
    if (!bytes) continue
    await writeAppDataBytes(cell.image_path, bytes)
    restored++
  }
  return restored
}
