import {
  readDir,
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  remove,
  watch,
  type UnwatchFn,
} from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { VaultFile, MandalartVaultFiles } from './types'
import { MANDALART_DOC_NAME } from './vaultModel'

/**
 * vault モード (Phase 2) の I/O アダプタ層 — plugin-fs の薄いラッパ (ロジックは持たない)。
 *
 * watcher は **plugin-fs の `watch`** を使う (Rust の notify は不要)。読み書きするパスは
 * fs:scope (capabilities/default.json の `$HOME/**` 等) 内である必要がある。
 * Stage 2 では呼び出し側が dev フラグ越しに read-only スキャンのみ行う (DB 無改変)。
 */

/** vault 内の 1 マンダラートフォルダを読み、VaultFile[] (path はフォルダ相対) を返す。 */
export async function scanMandalartDir(dirAbsPath: string): Promise<VaultFile[]> {
  const entries = await readDir(dirAbsPath)
  const files: VaultFile[] = []
  for (const e of entries) {
    if (!e.isFile || !e.name.endsWith('.md')) continue
    const content = await readTextFile(await join(dirAbsPath, e.name))
    files.push({ path: e.name, content })
  }
  return files
}

/**
 * vault ルート直下の各サブフォルダ (= 1 マンダラート) を走査する。
 * `_mandalart.md` を持つフォルダだけを対象にし、`.` 始まり (.mandalart 等) は無視する。
 */
export async function scanVault(vaultRoot: string): Promise<MandalartVaultFiles[]> {
  const entries = await readDir(vaultRoot)
  const result: MandalartVaultFiles[] = []
  for (const e of entries) {
    if (!e.isDirectory || e.name.startsWith('.')) continue
    const files = await scanMandalartDir(await join(vaultRoot, e.name))
    if (files.some((f) => f.path === MANDALART_DOC_NAME)) {
      result.push({ dirName: e.name, files })
    }
  }
  return result
}

/** フォルダが無ければ作る。 */
export async function ensureDir(absPath: string): Promise<void> {
  if (!(await exists(absPath))) await mkdir(absPath, { recursive: true })
}

/** 1 ファイルを書く (親フォルダは事前に ensureDir すること)。 */
export async function writeVaultFile(absPath: string, content: string): Promise<void> {
  await writeTextFile(absPath, content)
}

/** 1 ファイルを削除する (flush の差分削除で使用)。 */
export async function removeVaultFile(absPath: string): Promise<void> {
  await remove(absPath)
}

/** フォルダを再帰削除する (flush で DB から消えたマンダラートの dir を消すのに使用)。 */
export async function removeDir(absPath: string): Promise<void> {
  await remove(absPath, { recursive: true })
}

/**
 * vault ルートを再帰 watch する。変更があったパス配列を onChange に渡す。返り値で停止。
 * delayMs でデバウンスし、自分の書き込みの反響は呼び出し側が echo-skip で弾く。
 */
export async function watchVault(
  vaultRoot: string,
  onChange: (paths: string[]) => void,
  delayMs = 500,
): Promise<UnwatchFn> {
  return watch(
    vaultRoot,
    (event) => {
      if (Array.isArray(event.paths) && event.paths.length > 0) onChange(event.paths)
    },
    { recursive: true, delayMs },
  )
}
