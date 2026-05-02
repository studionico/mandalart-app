import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import {
  getFolders, createFolder, updateFolderName, updateFolderSortOrder,
  deleteFolder, ensureInboxFolder, _resetInboxBootstrap,
} from '@/lib/api/folders'
import { createMandalart, getMandalarts } from '@/lib/api/mandalarts'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
  // ensureInboxFolder の singleton promise はモジュールスコープなのでテスト間でリセット
  _resetInboxBootstrap()
})
afterEach(() => {
  unbindTestDb()
  db.close()
  _resetInboxBootstrap()
})

describe('ensureInboxFolder (bootstrap)', () => {
  it('初回呼び出しで Inbox folder を作成する (is_system=1)', async () => {
    const inboxId = await ensureInboxFolder()
    expect(inboxId).toBeTruthy()
    const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(inboxId) as { name: string; is_system: number; sort_order: number }
    expect(row.name).toBe('Inbox')
    expect(row.is_system).toBe(1)
    expect(row.sort_order).toBe(0)
  })

  it('冪等: 2 回呼び出しても Inbox は 1 つだけ', async () => {
    const id1 = await ensureInboxFolder()
    const id2 = await ensureInboxFolder()
    expect(id1).toBe(id2)
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE is_system = 1').get() as { n: number }).n).toBe(1)
  })

  it('folder_id IS NULL の mandalarts を Inbox に振り分ける', async () => {
    const m = await createMandalart('orphan')  // folder_id=NULL
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string | null }).folder_id).toBeNull()
    const inboxId = await ensureInboxFolder()
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string | null }).folder_id).toBe(inboxId)
  })

  it('singleton: 並行呼出 (Promise.all) で Inbox は 1 つだけ作られる', async () => {
    // React StrictMode の useEffect 二重起動シミュレーション
    const [id1, id2, id3] = await Promise.all([
      ensureInboxFolder(),
      ensureInboxFolder(),
      ensureInboxFolder(),
    ])
    expect(id1).toBe(id2)
    expect(id2).toBe(id3)
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE is_system = 1').get() as { n: number }).n).toBe(1)
  })

  it('self-heal: 既に複数の system folder がある DB を最古 1 つにマージし、紐付くマンダラートも集約する', async () => {
    // 過去 bug で 2 つの Inbox が DB に残っている状態を再現
    const ts1 = '2026-01-01T00:00:00.000Z'
    const ts2 = '2026-01-01T00:00:01.000Z'  // 後から作られた重複
    db.prepare('INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('inbox-old', 'Inbox', 0, 1, ts1, ts1)
    db.prepare('INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('inbox-dup', 'Inbox', 0, 1, ts2, ts2)
    // dup の方に紐付くマンダラートを作成
    const m = await createMandalart('attached-to-dup', 'inbox-dup')
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string }).folder_id).toBe('inbox-dup')
    // ensureInboxFolder で自己修復
    const inboxId = await ensureInboxFolder()
    expect(inboxId).toBe('inbox-old')  // 最古採用
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE is_system = 1').get() as { n: number }).n).toBe(1)
    // dup に紐付いていたマンダラートが canonical に移っている
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string }).folder_id).toBe('inbox-old')
  })
})

describe('createFolder / getFolders', () => {
  it('createFolder は sort_order を MAX+1 で振る (Inbox=0、次が 1、その次が 2)', async () => {
    await ensureInboxFolder()  // Inbox = 0
    const a = await createFolder('Archive')
    const b = await createFolder('Projects')
    expect(a.sort_order).toBe(1)
    expect(b.sort_order).toBe(2)
    expect(a.is_system).toBe(false)
  })

  it('getFolders は sort_order 昇順で返す', async () => {
    const inboxId = await ensureInboxFolder()
    const a = await createFolder('A')
    const b = await createFolder('B')
    const list = await getFolders()
    expect(list.map((f) => f.id)).toEqual([inboxId, a.id, b.id])
  })

  it('getFolders は deleted_at IS NULL のみ返す', async () => {
    await ensureInboxFolder()
    const a = await createFolder('toDelete')
    db.prepare('UPDATE folders SET synced_at = ? WHERE id = ?').run(new Date().toISOString(), a.id)
    await deleteFolder(a.id)
    const list = await getFolders()
    expect(list.find((f) => f.id === a.id)).toBeUndefined()
  })
})

describe('updateFolderName / updateFolderSortOrder', () => {
  it('updateFolderName は system folder にも適用可 (Inbox の i18n 想定)', async () => {
    const inboxId = await ensureInboxFolder()
    await updateFolderName(inboxId, '受信箱')
    expect((db.prepare('SELECT name FROM folders WHERE id = ?').get(inboxId) as { name: string }).name).toBe('受信箱')
  })

  it('updateFolderSortOrder は値を直接設定する', async () => {
    const inboxId = await ensureInboxFolder()
    await updateFolderSortOrder(inboxId, 5)
    expect((db.prepare('SELECT sort_order FROM folders WHERE id = ?').get(inboxId) as { sort_order: number }).sort_order).toBe(5)
  })
})

describe('deleteFolder', () => {
  it('system folder (is_system=1) は削除拒否 (Error throw)', async () => {
    const inboxId = await ensureInboxFolder()
    await expect(deleteFolder(inboxId)).rejects.toThrow(/system folder/)
    // Inbox が消えていない
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE id = ?').get(inboxId) as { n: number }).n).toBe(1)
  })

  it('ユーザー定義フォルダの削除で所属マンダラートが Inbox に移る', async () => {
    const inboxId = await ensureInboxFolder()
    const archive = await createFolder('Archive')
    const m = await createMandalart('inarchive', archive.id)
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string }).folder_id).toBe(archive.id)
    await deleteFolder(archive.id)
    // mandalart は残り、folder_id が Inbox に reset
    expect((db.prepare('SELECT folder_id FROM mandalarts WHERE id = ?').get(m.id) as { folder_id: string }).folder_id).toBe(inboxId)
    // archive folder 自身は (未同期なので) hard delete
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE id = ?').get(archive.id) as { n: number }).n).toBe(0)
  })

  it('同期済み folder も local からは hard delete (cloud は別途 hard delete を試みる)', async () => {
    // フォルダにはゴミ箱 / 復元 UI が無いので soft delete (deleted_at セット) せずに
    // 物理削除する設計 (permanentDeleteMandalart と同じパターン)。テストでは
    // Supabase 未設定なので cloud delete は no-op、local の物理削除のみ検証する。
    await ensureInboxFolder()
    const archive = await createFolder('Archive')
    db.prepare('UPDATE folders SET synced_at = ? WHERE id = ?').run(new Date().toISOString(), archive.id)
    await deleteFolder(archive.id)
    // 物理削除されているので row 自体が無い
    const count = (db.prepare('SELECT COUNT(*) AS n FROM folders WHERE id = ?').get(archive.id) as { n: number }).n
    expect(count).toBe(0)
  })
})

describe('getMandalarts(folderId): フォルダフィルタ (migration 010)', () => {
  it('指定 folder の mandalarts のみ返す', async () => {
    const inboxId = await ensureInboxFolder()
    const archive = await createFolder('Archive')
    const inInbox = await createMandalart('inbox-card', inboxId)
    const inArchive = await createMandalart('archive-card', archive.id)
    const inboxList = await getMandalarts(inboxId)
    const archiveList = await getMandalarts(archive.id)
    expect(inboxList.map((m) => m.id)).toEqual([inInbox.id])
    expect(archiveList.map((m) => m.id)).toEqual([inArchive.id])
  })

  it('引数なしは全 folder のマンダラートを返す', async () => {
    const inboxId = await ensureInboxFolder()
    const archive = await createFolder('Archive')
    await createMandalart('a', inboxId)
    await createMandalart('b', archive.id)
    const all = await getMandalarts()
    expect(all).toHaveLength(2)
  })
})
