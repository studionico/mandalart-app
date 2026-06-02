import type { VaultFile } from './types'

/**
 * リコンシリエーションのピュア部分 (I/O なし、Vitest 100%)。
 * 実際の SQL / ファイル書き込みは後段の I/O 層が、この計画 (plan) を適用する。
 */

/** SHA-256 16 進ダイジェスト (Web Crypto、Tauri webview / Node 双方で利用可)。 */
export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export type Diffable = { id: string; hash: string }
export type DiffPlan = { upsertIds: string[]; deleteIds: string[] }

/**
 * id をキーに existing(現状) と incoming(あるべき姿) を突き合わせる純関数。
 *  - upsertIds: incoming のうち id が新規 or hash が変化したもの
 *  - deleteIds: existing のうち incoming に無い id
 * file→DB / DB→file どちらの向きでも使える (どちらを existing/incoming にするかは呼び出し側)。
 */
export function diffById(existing: Diffable[], incoming: Diffable[]): DiffPlan {
  const existingHashById = new Map(existing.map((e) => [e.id, e.hash]))
  const incomingIds = new Set<string>()
  const upsertIds: string[] = []
  for (const item of incoming) {
    incomingIds.add(item.id)
    const prevHash = existingHashById.get(item.id)
    if (prevHash === undefined || prevHash !== item.hash) upsertIds.push(item.id)
  }
  const deleteIds: string[] = []
  for (const e of existing) {
    if (!incomingIds.has(e.id)) deleteIds.push(e.id)
  }
  return { upsertIds, deleteIds }
}

export type FilePlan = {
  /** 内容が変わった / 新規のファイルだけ書く (不要な全書換えを避ける = ループ抑止にも寄与)。 */
  write: VaultFile[]
  /** desired に無くなった既存ファイルのパス。 */
  deletePaths: string[]
}

/**
 * DB→file 方向の差分書き出し計画。path をキーに content が一致するものは write から除く。
 */
export function diffFiles(existing: VaultFile[], desired: VaultFile[]): FilePlan {
  const existingByPath = new Map(existing.map((f) => [f.path, f.content]))
  const desiredPaths = new Set<string>()
  const write: VaultFile[] = []
  for (const f of desired) {
    desiredPaths.add(f.path)
    if (existingByPath.get(f.path) !== f.content) write.push(f)
  }
  const deletePaths: string[] = []
  for (const f of existing) {
    if (!desiredPaths.has(f.path)) deletePaths.push(f.path)
  }
  return { write, deletePaths }
}

/**
 * 自分が書いた直後の watcher 発火を無視するための echo skip 判定 (ループ回避 3 重防御の 1 つ)。
 * 書き出した content の hash を recentWrites に積んでおき、watcher で読んだ content の hash が
 * 一致すれば「自分の書き込みの反響」とみなして無視する。
 */
export function shouldSkipEcho(hash: string, recentWrites: ReadonlySet<string>): boolean {
  return recentWrites.has(hash)
}
