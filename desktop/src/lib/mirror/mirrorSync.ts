import {
  readDir,
  readTextFile,
  writeTextFile,
  remove,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { query, now } from '@/lib/db'
import { exportToJSON } from '@/lib/api/transfer'
import type { GridSnapshot } from '@/types'
import { mirrorFilename } from './mirrorFilename'

/**
 * ローカル JSON ミラー (一方向 DB→ファイル) の中核。
 *
 * 各 live マンダラートを `<slug>-<id>.json` として選択フォルダへ書き出し、自分が書いた
 * 過去のファイルで現行ファイル名に無いもの (rename / 削除/ゴミ箱) を掃除する。冪等。
 * **DB は一切書き換えない**ので auto-flush のフィードバックループは発生しない。
 *
 * fs 層は注入可能 ({@link MirrorFs})。デフォルトは plugin-fs。テストは in-memory adapter を渡す。
 */

export const MIRROR_FORMAT_VERSION = 1

/** ミラーファイル 1 件の内容。snapshot に加えマンダラートメタを包み自己記述的にする。 */
export type MirrorEnvelope = {
  version: number
  id: string
  title: string
  locked: boolean
  pinned: boolean
  folderId: string | null
  exportedAt: string
  snapshot: GridSnapshot
}

/** ミラーが使う最小限のファイル操作。dir+name の結合は adapter 内に閉じる。 */
export type MirrorFs = {
  ensureDir(dir: string): Promise<void>
  writeFile(dir: string, name: string, content: string): Promise<void>
  removeFile(dir: string, name: string): Promise<void>
  /** dir 直下の `.json` ファイル名一覧 (ディレクトリは含めない)。 */
  listJsonFiles(dir: string): Promise<string[]>
  readFile(dir: string, name: string): Promise<string | null>
}

const defaultFs: MirrorFs = {
  async ensureDir(dir) {
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  },
  async writeFile(dir, name, content) {
    await writeTextFile(await join(dir, name), content)
  },
  async removeFile(dir, name) {
    await remove(await join(dir, name))
  },
  async listJsonFiles(dir) {
    const entries = await readDir(dir)
    return entries.filter((e) => e.isFile && e.name.endsWith('.json')).map((e) => e.name)
  },
  async readFile(dir, name) {
    try {
      const p = await join(dir, name)
      if (!(await exists(p))) return null
      return await readTextFile(p)
    } catch {
      return null
    }
  },
}

type LiveMandalart = {
  id: string
  title: string
  locked: boolean
  pinned: boolean
  folderId: string | null
  rootGridId: string | null
}

/** SQLite の INTEGER 0/1 を boolean に正規化。 */
function bool(v: unknown): boolean {
  return v === true || v === 1
}

/** live マンダラートと、その primary root grid id を読む (read-only)。 */
async function loadLiveMandalarts(): Promise<LiveMandalart[]> {
  const rows = await query<{
    id: string
    title: string
    locked: number | boolean
    pinned: number | boolean
    folder_id: string | null
    root_cell_id: string
  }>(
    'SELECT id, title, locked, pinned, folder_id, root_cell_id FROM mandalarts WHERE deleted_at IS NULL',
  )

  const result: LiveMandalart[] = []
  for (const r of rows) {
    // primary root grid: 自身の center が root_cell_id を指すグリッド。
    // exportToJSON はそこから並列ルート・全子孫まで辿る。
    let rootGridId: string | null = null
    const primary = await query<{ id: string }>(
      'SELECT id FROM grids WHERE mandalart_id = ? AND center_cell_id = ? AND deleted_at IS NULL LIMIT 1',
      [r.id, r.root_cell_id],
    )
    if (primary[0]) {
      rootGridId = primary[0].id
    } else {
      // フォールバック: center_cell_id 不整合時は parent_cell_id IS NULL の先頭ルートを使う。
      const fallback = await query<{ id: string }>(
        'SELECT id FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL AND deleted_at IS NULL ORDER BY sort_order LIMIT 1',
        [r.id],
      )
      rootGridId = fallback[0]?.id ?? null
    }
    result.push({
      id: r.id,
      title: r.title,
      locked: bool(r.locked),
      pinned: bool(r.pinned),
      folderId: r.folder_id,
      rootGridId,
    })
  }
  return result
}

/** ファイル内容を mirror envelope として読み id を返す。自分のファイルでなければ null。 */
function parseEnvelopeId(content: string | null): string | null {
  if (content == null) return null
  try {
    const parsed = JSON.parse(content) as Partial<MirrorEnvelope>
    if (typeof parsed.version === 'number' && typeof parsed.id === 'string') return parsed.id
    return null
  } catch {
    return null
  }
}

/**
 * 全 live マンダラートを folderPath へミラーし、不要になった自分の過去ファイルを削除する。
 * @returns 書込み件数 / 削除件数。
 */
export async function mirrorAllToFolder(
  folderPath: string,
  fs: MirrorFs = defaultFs,
): Promise<{ written: number; deleted: number }> {
  await fs.ensureDir(folderPath)

  const live = await loadLiveMandalarts()
  const expected = new Set<string>()
  let written = 0

  for (const m of live) {
    if (!m.rootGridId) continue
    const snapshot = await exportToJSON(m.rootGridId)
    const envelope: MirrorEnvelope = {
      version: MIRROR_FORMAT_VERSION,
      id: m.id,
      title: m.title,
      locked: m.locked,
      pinned: m.pinned,
      folderId: m.folderId,
      exportedAt: now(),
      snapshot,
    }
    const name = mirrorFilename(m.title, m.id)
    expected.add(name)
    await fs.writeFile(folderPath, name, JSON.stringify(envelope, null, 2))
    written++
  }

  // 差分削除: 自分が書いた envelope ファイルのうち、現行ファイル名集合に無いものを消す
  // (= id がもう live でない or タイトル変更で別名になった)。parse できない外部ファイルは触らない。
  let deleted = 0
  for (const name of await fs.listJsonFiles(folderPath)) {
    if (expected.has(name)) continue
    const id = parseEnvelopeId(await fs.readFile(folderPath, name))
    if (id == null) continue // 外部ファイル / 壊れたファイルは残す (安全側)
    await fs.removeFile(folderPath, name)
    deleted++
  }

  return { written, deleted }
}
