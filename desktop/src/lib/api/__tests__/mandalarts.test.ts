import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import {
  createMandalart, getMandalart, getMandalarts,
  deleteMandalart, restoreMandalart, getDeletedMandalarts,
  permanentDeleteMandalart, updateMandalartTitle,
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

// 局所 helper: テスト中の timestamp 生成 (mock now と同じ shape)
function now(): string {
  return new Date().toISOString()
}
