import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import {
  createMandalart, getMandalart, getMandalarts,
  deleteMandalart, restoreMandalart, getDeletedMandalarts,
  permanentDeleteMandalart, updateMandalartTitle,
  updateMandalartPinned, updateMandalartSortOrder, reorderMandalarts,
  duplicateMandalart,
} from '@/lib/api/mandalarts'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

describe('createMandalart', () => {
  it('mandalart + root grid + root center cell の 3 行を作る', async () => {
    const m = await createMandalart('テスト')
    expect(m.title).toBe('テスト')
    const mandalarts = db.prepare('SELECT * FROM mandalarts').all() as Array<{ id: string; root_cell_id: string }>
    const grids = db.prepare('SELECT * FROM grids').all() as Array<{ mandalart_id: string; center_cell_id: string }>
    const cells = db.prepare('SELECT * FROM cells').all() as Array<{ id: string; grid_id: string }>
    expect(mandalarts).toHaveLength(1)
    expect(grids).toHaveLength(1)
    expect(cells).toHaveLength(1) // root center cell のみ (lazy: peripherals は未作成)
    expect(grids[0].mandalart_id).toBe(m.id)
    expect(grids[0].center_cell_id).toBe(mandalarts[0].root_cell_id)
    expect(cells[0].id).toBe(mandalarts[0].root_cell_id)
    expect(cells[0].grid_id).toBe(grids[0]['id' as keyof typeof grids[0]])
  })
})

describe('getMandalarts / getMandalart', () => {
  it('deleted_at IS NULL の mandalart のみ返す', async () => {
    const m1 = await createMandalart('one')
    const m2 = await createMandalart('two')
    db.prepare('UPDATE mandalarts SET synced_at = ? WHERE id = ?').run(now(), m2.id)
    await deleteMandalart(m2.id) // synced なので soft-delete (deleted_at セット)
    const list = await getMandalarts()
    expect(list.map((m) => m.id)).toEqual([m1.id])
  })

  it('単体取得は root cell の image_path を JOIN で返す', async () => {
    const m = await createMandalart('imgtest')
    db.prepare('UPDATE cells SET image_path = ? WHERE id = ?').run('cells/abc.png', m.root_cell_id)
    const fetched = await getMandalart(m.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.image_path).toBe('cells/abc.png')
  })
})

describe('updateMandalartTitle', () => {
  it('title を更新し updated_at を更新する', async () => {
    const m = await createMandalart('old')
    const beforeRow = db.prepare('SELECT updated_at FROM mandalarts WHERE id = ?').get(m.id) as { updated_at: string }
    await new Promise((r) => setTimeout(r, 5))
    await updateMandalartTitle(m.id, 'new')
    const after = db.prepare('SELECT title, updated_at FROM mandalarts WHERE id = ?').get(m.id) as { title: string; updated_at: string }
    expect(after.title).toBe('new')
    expect(after.updated_at > beforeRow.updated_at).toBe(true)
  })
})

describe('deleteMandalart (落とし穴 #12: synced_at で hard / soft 分岐)', () => {
  it('未同期 (synced_at IS NULL) は cells / grids / mandalart 全部 hard delete', async () => {
    const m = await createMandalart('unsynced')
    await deleteMandalart(m.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM mandalarts WHERE id = ?').get(m.id)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE mandalart_id = ?').get(m.id)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)').get(m.id)).toEqual({ n: 0 })
  })

  it('同期済み (synced_at IS NOT NULL) は cells / grids / mandalart 全部 soft delete', async () => {
    const m = await createMandalart('synced')
    db.prepare('UPDATE cells SET synced_at = ? WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)').run(now(), m.id)
    db.prepare('UPDATE grids SET synced_at = ? WHERE mandalart_id = ?').run(now(), m.id)
    db.prepare('UPDATE mandalarts SET synced_at = ? WHERE id = ?').run(now(), m.id)
    await deleteMandalart(m.id)
    const mRow = db.prepare('SELECT deleted_at FROM mandalarts WHERE id = ?').get(m.id) as { deleted_at: string | null }
    const gRow = db.prepare('SELECT deleted_at FROM grids WHERE mandalart_id = ?').get(m.id) as { deleted_at: string | null }
    const cRow = db.prepare('SELECT deleted_at FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)').get(m.id) as { deleted_at: string | null }
    expect(mRow?.deleted_at).toBeTruthy()
    expect(gRow?.deleted_at).toBeTruthy()
    expect(cRow?.deleted_at).toBeTruthy()
  })

  it('mixed (一部 synced) は同期済みのみ soft、未同期は hard で残らない', async () => {
    const m = await createMandalart('mixed')
    // mandalart 本体は同期済み、cells / grids は未同期
    db.prepare('UPDATE mandalarts SET synced_at = ? WHERE id = ?').run(now(), m.id)
    await deleteMandalart(m.id)
    // mandalart は soft 残る
    expect(db.prepare('SELECT deleted_at FROM mandalarts WHERE id = ?').get(m.id)).toMatchObject({ deleted_at: expect.any(String) })
    // cells / grids は hard で消える
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE mandalart_id = ?').get(m.id)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells').get()).toEqual({ n: 0 })
  })
})

describe('restoreMandalart (ゴミ箱からの復元)', () => {
  it('mandalart / grids / cells すべての deleted_at を NULL に戻す', async () => {
    const m = await createMandalart('restoreme')
    // sync 済みにして soft delete
    db.prepare('UPDATE cells SET synced_at = ? WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)').run(now(), m.id)
    db.prepare('UPDATE grids SET synced_at = ? WHERE mandalart_id = ?').run(now(), m.id)
    db.prepare('UPDATE mandalarts SET synced_at = ? WHERE id = ?').run(now(), m.id)
    await deleteMandalart(m.id)
    expect((await getDeletedMandalarts()).map((x) => x.id)).toContain(m.id)
    await restoreMandalart(m.id)
    expect((await getDeletedMandalarts()).map((x) => x.id)).not.toContain(m.id)
    expect((await getMandalarts()).map((x) => x.id)).toContain(m.id)
    const cell = db.prepare('SELECT deleted_at FROM cells WHERE grid_id IN (SELECT id FROM grids WHERE mandalart_id = ?)').get(m.id) as { deleted_at: string | null }
    expect(cell.deleted_at).toBeNull()
  })
})

describe('permanentDeleteMandalart', () => {
  it('local からは cells / grids / mandalart を物理削除する (cloud 部分は Supabase 未設定なので skip)', async () => {
    const m = await createMandalart('permdel')
    await permanentDeleteMandalart(m.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM mandalarts').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells').get()).toEqual({ n: 0 })
  })
})

describe('Phase A: 並び替え + ピン留め (migration 009)', () => {
  it('updateMandalartPinned は pinned カラムを 1/0 に切替える', async () => {
    const m = await createMandalart('pin-test')
    await updateMandalartPinned(m.id, true)
    expect(db.prepare('SELECT pinned FROM mandalarts WHERE id = ?').get(m.id)).toEqual({ pinned: 1 })
    await updateMandalartPinned(m.id, false)
    expect(db.prepare('SELECT pinned FROM mandalarts WHERE id = ?').get(m.id)).toEqual({ pinned: 0 })
  })

  it('updateMandalartSortOrder は sort_order を直接設定する', async () => {
    const m = await createMandalart('order-test')
    await updateMandalartSortOrder(m.id, 5)
    expect(db.prepare('SELECT sort_order FROM mandalarts WHERE id = ?').get(m.id)).toEqual({ sort_order: 5 })
  })

  it('reorderMandalarts は orderedIds の先頭から 0,1,2... を振る', async () => {
    const m1 = await createMandalart('a')
    const m2 = await createMandalart('b')
    const m3 = await createMandalart('c')
    await reorderMandalarts([m3.id, m1.id, m2.id])
    const rows = db.prepare('SELECT id, sort_order FROM mandalarts ORDER BY sort_order').all() as Array<{ id: string; sort_order: number }>
    expect(rows).toEqual([
      { id: m3.id, sort_order: 0 },
      { id: m1.id, sort_order: 1 },
      { id: m2.id, sort_order: 2 },
    ])
  })

  it('getMandalarts: pinned が unpinned より先頭に来る', async () => {
    const a = await createMandalart('a')
    const b = await createMandalart('b')
    await updateMandalartPinned(b.id, true)  // b だけ pinned
    const list = await getMandalarts()
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })

  it('getMandalarts: 同 pinned 状態内は sort_order 昇順、NULL は最後 (created_at fallback)', async () => {
    const a = await createMandalart('a')  // sort_order = NULL
    const b = await createMandalart('b')
    const c = await createMandalart('c')
    await updateMandalartSortOrder(b.id, 0)  // b 先頭
    await updateMandalartSortOrder(c.id, 1)  // c 二番目
    // a は sort_order NULL → 最後
    const list = await getMandalarts()
    expect(list.map((m) => m.id)).toEqual([b.id, c.id, a.id])
  })

  it('duplicateMandalart: reorder 済 folder で複製しても先頭に並ぶ (createMandalart と同じ semantics)', async () => {
    // 統一性の回帰テスト: createMandalart / duplicateMandalart / importFromJSON すべての
    // 作成経路が `nextTopSortOrder` を経由して同じ「先頭に並ぶ」結果になるべき。
    const a = await createMandalart('A', 'archive-folder')
    const b = await createMandalart('B', 'archive-folder')
    const c = await createMandalart('C', 'archive-folder')
    await reorderMandalarts([a.id, b.id, c.id])  // sort_order = 0, 1, 2
    // a を複製 → 新規カードは先頭 (sort_order = -1)
    const dup = await duplicateMandalart(a.id)
    expect(dup.sort_order).toBe(-1)
    expect(dup.folder_id).toBe('archive-folder')  // folder_id は継承
    const list = await getMandalarts('archive-folder')
    expect(list.map((m) => m.id)).toEqual([dup.id, a.id, b.id, c.id])
  })

  it('createMandalart with folderId: 既存 reorder 済 (sort_order=0..N) folder でも先頭に並ぶ', async () => {
    // 回帰テスト: フォルダ内で reorder 済みのカード群がある状態で新規作成すると、
    // 新規カードが defined-sort_order バケットの先頭 (MIN(sort_order) - 1) に並ぶ。
    // フォルダ移動後 (updateMandalartFolderId は sort_order を NULL リセット) のシナリオで
    // 「Archive で新規作成しても末尾に行く」回帰を防ぐ。
    const a = await createMandalart('A', 'archive-folder')
    const b = await createMandalart('B', 'archive-folder')
    const c = await createMandalart('C', 'archive-folder')
    // 3 件を [A, B, C] に reorder (sort_order=0, 1, 2)
    await reorderMandalarts([a.id, b.id, c.id])
    // この時点の folder 内 sort_order: a=0, b=1, c=2
    // 新規 D を archive-folder に作成 → MIN-1 = -1 が割当てられる
    const d = await createMandalart('D', 'archive-folder')
    expect(d.sort_order).toBe(-1)
    // getMandalarts(archive) で D が先頭に来る (defined sort_order ASC で D(-1) → a(0) → b(1) → c(2))
    const list = await getMandalarts('archive-folder')
    expect(list.map((m) => m.id)).toEqual([d.id, a.id, b.id, c.id])
  })

  it('getMandalarts: 編集 (updateMandalartTitle で updated_at 更新) してもカード位置が動かない', async () => {
    // 回帰テスト: 編集で updated_at が bump されてもダッシュボード上の位置は変わらない
    // (created_at fallback により、編集してもカード位置不変)。
    const a = await createMandalart('A')
    await new Promise((r) => setTimeout(r, 5))
    const b = await createMandalart('B')
    await new Promise((r) => setTimeout(r, 5))
    const c = await createMandalart('C')
    // 初期順序: created_at DESC で [C, B, A]
    expect((await getMandalarts()).map((m) => m.id)).toEqual([c.id, b.id, a.id])
    // a を編集 → updated_at 更新されるが created_at 不変
    await new Promise((r) => setTimeout(r, 5))
    await updateMandalartTitle(a.id, 'A-edited')
    // 期待: 順序は [C, B, A] のまま (a が先頭に来ない)
    expect((await getMandalarts()).map((m) => m.id)).toEqual([c.id, b.id, a.id])
  })

  it('getMandalarts: pinned > sort_order > created_at の優先順位', async () => {
    const old = await createMandalart('old')          // sort_order=NULL, oldest created_at
    await new Promise((r) => setTimeout(r, 5))
    const newer = await createMandalart('newer')      // sort_order=NULL, newer
    await new Promise((r) => setTimeout(r, 5))
    const ordered = await createMandalart('ordered')  // sort_order=0
    await updateMandalartSortOrder(ordered.id, 0)
    const pinned = await createMandalart('pinned')    // pinned=1, sort_order=NULL
    await updateMandalartPinned(pinned.id, true)
    const list = await getMandalarts()
    // 期待: pinned 先頭、次に sort_order=0 の ordered、その後 sort_order=NULL を created_at 新→旧
    expect(list.map((m) => m.id)).toEqual([pinned.id, ordered.id, newer.id, old.id])
  })
})

// 局所 helper: テスト中の timestamp 生成 (mock now と同じ shape)
function now(): string {
  return new Date().toISOString()
}
