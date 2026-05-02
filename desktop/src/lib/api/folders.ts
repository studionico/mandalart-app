import { query, execute, generateId, now } from '../db'
import { supabase, isSupabaseConfigured } from '../supabase/client'
import type { Folder } from '../../types'

/**
 * ダッシュボードのフォルダタブ操作 API (migration 010 以降)。
 *
 * すべてのマンダラートは必ず 1 つの folder に所属する。Inbox は system folder
 * (`is_system=1`、削除不可) として `ensureInboxFolder` の冪等呼び出しで自動生成される。
 * それ以外はユーザーが「+」タブから任意の名前で追加できる。
 */

type RawFolder = {
  id: string
  name: string
  sort_order: number
  is_system: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

function toFolder(row: RawFolder): Folder {
  return {
    id: row.id,
    name: row.name,
    sort_order: row.sort_order,
    is_system: row.is_system === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }
}

/** deleted_at IS NULL の folder を sort_order 順に返す。 */
export async function getFolders(): Promise<Folder[]> {
  const rows = await query<RawFolder>(
    'SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC',
  )
  return rows.map(toFolder)
}

/**
 * ユーザー定義フォルダを新規作成する (is_system=0)。sort_order は既存 folder の最大値 + 1。
 */
export async function createFolder(name: string): Promise<Folder> {
  const id = generateId()
  const ts = now()
  const maxRows = await query<{ max_sort: number | null }>(
    'SELECT MAX(sort_order) AS max_sort FROM folders WHERE deleted_at IS NULL',
  )
  const sortOrder = (maxRows[0]?.max_sort ?? -1) + 1
  await execute(
    'INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, name, sortOrder, 0, ts, ts],
  )
  return {
    id, name, sort_order: sortOrder, is_system: false,
    created_at: ts, updated_at: ts, deleted_at: null,
  }
}

/** フォルダ名を更新する。Inbox など system folder にも適用可 (i18n 等のため)。 */
export async function updateFolderName(id: string, name: string): Promise<void> {
  await execute('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?', [name, now(), id])
}

/** sort_order を直接設定する (タブの並び替え用)。 */
export async function updateFolderSortOrder(id: string, sortOrder: number): Promise<void> {
  await execute(
    'UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?',
    [sortOrder, now(), id],
  )
}

/**
 * フォルダを削除する (local + cloud 両方から物理削除)。
 *
 * - **is_system=1 (Inbox 等)**: 削除不可 (Error throw)
 * - それ以外: 所属マンダラートの `folder_id` を Inbox に reset した上で
 *   folder 自身を **両側で hard delete** する。
 *
 * フォルダにはゴミ箱 / 復元 UI が無いので soft delete (deleted_at セット) する意義が
 * 無く、`syncAwareDelete` 経由だと cloud 側に deleted_at 付きの行が滞留してしまう。
 * `permanentDeleteMandalart` と同じ「local hard delete → cloud hard delete」パターンに統一。
 *
 * オフライン / 未サインインで cloud delete できなかった場合は warn のみ
 * (local の削除は成功しているので、次回 cleanup hook が cloud 側をクリーンアップする)。
 */
export async function deleteFolder(id: string): Promise<void> {
  const target = await query<{ is_system: number }>(
    'SELECT is_system FROM folders WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (target.length === 0) return  // 既に削除済み or 不在
  if (target[0].is_system === 1) {
    throw new Error('Inbox など system folder は削除できません')
  }
  // 1. 所属マンダラートを Inbox に reassign
  const inboxId = await ensureInboxFolder()
  const ts = now()
  await execute(
    'UPDATE mandalarts SET folder_id = ?, updated_at = ? WHERE folder_id = ?',
    [inboxId, ts, id],
  )
  // 2. local hard delete
  await execute('DELETE FROM folders WHERE id = ?', [id])
  // 3. cloud hard delete (任意。失敗しても local 削除は確定しているので warn のみ)
  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  try {
    await supabase.from('folders').delete().eq('id', id)
  } catch (e) {
    console.warn('[deleteFolder] cloud delete failed (local delete already succeeded):', e)
  }
}

/**
 * 既に soft-delete (deleted_at セット) されてしまった folder を local + cloud 両側から
 * 物理削除する一発掃除関数。
 *
 * 経緯: 旧 `deleteFolder` が `syncAwareDelete` 経由 (synced 済みなら soft delete) で
 * 削除していたため、cloud 側に deleted_at 付き folder 行が滞留した。`useCloudFoldersCleanup`
 * hook がアプリのバージョンアップ時に 1 回だけ呼び出してこれを掃除する。
 *
 * 失敗時は warn のみ。次回起動で再試行されるので過剰な retry は不要。
 */
export async function cleanupSoftDeletedFolders(): Promise<{
  localDeleted: number
  cloudDeleted: number
}> {
  // 1. local: deleted_at が立っている folder を物理削除
  const localRows = await query<{ id: string }>(
    'SELECT id FROM folders WHERE deleted_at IS NOT NULL',
  )
  const localIds = localRows.map((r) => r.id)
  if (localIds.length > 0) {
    const placeholders = localIds.map(() => '?').join(',')
    await execute(`DELETE FROM folders WHERE id IN (${placeholders})`, localIds)
  }
  // 2. cloud: deleted_at IS NOT NULL の行を batch DELETE
  if (!isSupabaseConfigured) return { localDeleted: localIds.length, cloudDeleted: 0 }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { localDeleted: localIds.length, cloudDeleted: 0 }
  try {
    const { data, error } = await supabase
      .from('folders')
      .select('id')
      .not('deleted_at', 'is', null)
    if (error) throw error
    const cloudIds = ((data ?? []) as { id: string }[]).map((r) => r.id)
    if (cloudIds.length === 0) return { localDeleted: localIds.length, cloudDeleted: 0 }
    const { error: delErr } = await supabase.from('folders').delete().in('id', cloudIds)
    if (delErr) throw delErr
    return { localDeleted: localIds.length, cloudDeleted: cloudIds.length }
  } catch (e) {
    console.warn('[cleanupSoftDeletedFolders] cloud cleanup failed:', e)
    return { localDeleted: localIds.length, cloudDeleted: 0 }
  }
}

/**
 * Inbox folder が存在することを保証する冪等な bootstrap (migration 010 以降)。
 *
 * - 既に `is_system=1` の folder が **1 つだけ**ならその id を返す
 * - 複数 (race / 過去 bug 起因) なら最古を canonical とし、それ以外は **マージ** で物理削除 →
 *   マンダラートの folder_id も canonical に reassign する self-heal を行う
 * - 1 つも無ければ新規作成 (sort_order=0、name='Inbox')
 * - その後、`folder_id IS NULL` の mandalarts を canonical Inbox に振り分け
 *
 * 同一セッション内での並行呼び出し (React StrictMode の useEffect 二重起動など) は
 * モジュールスコープの singleton promise で直列化するので、SELECT-then-INSERT race による
 * 重複生成は起きない。万一過去に重複が生まれた DB でも、起動時にマージで自動修復する。
 *
 * @returns Inbox folder の id
 */
export function ensureInboxFolder(): Promise<string> {
  if (!inboxBootstrapPromise) {
    inboxBootstrapPromise = doEnsureInboxFolder().catch((e) => {
      // エラー時は次回呼出でリトライできるようにキャッシュをクリア
      inboxBootstrapPromise = null
      throw e
    })
  }
  return inboxBootstrapPromise
}

let inboxBootstrapPromise: Promise<string> | null = null

/** テスト用: 各テスト間で singleton promise をリセットするための internal helper */
export function _resetInboxBootstrap(): void {
  inboxBootstrapPromise = null
}

async function doEnsureInboxFolder(): Promise<string> {
  // 全 system folder を作成日昇順で取得 (最古を canonical 採用)
  const all = await query<{ id: string }>(
    'SELECT id FROM folders WHERE is_system = 1 AND deleted_at IS NULL ORDER BY created_at ASC',
  )
  let inboxId: string
  if (all.length > 0) {
    inboxId = all[0].id
    if (all.length > 1) {
      // 重複を canonical にマージ: 紐付くマンダラートを移動 + 重複 folder を物理削除
      const dupIds = all.slice(1).map((f) => f.id)
      const ts = now()
      const placeholders = dupIds.map(() => '?').join(',')
      await execute(
        `UPDATE mandalarts SET folder_id = ?, updated_at = ? WHERE folder_id IN (${placeholders})`,
        [inboxId, ts, ...dupIds],
      )
      await execute(`DELETE FROM folders WHERE id IN (${placeholders})`, dupIds)
    }
  } else {
    inboxId = generateId()
    const ts = now()
    await execute(
      'INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [inboxId, 'Inbox', 0, 1, ts, ts],
    )
  }
  // folder_id NULL の mandalarts を canonical Inbox に振り分け
  await execute(
    'UPDATE mandalarts SET folder_id = ?, updated_at = ? WHERE folder_id IS NULL AND deleted_at IS NULL',
    [inboxId, now()],
  )
  return inboxId
}
