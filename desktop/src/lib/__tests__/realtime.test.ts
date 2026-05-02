import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { applyMandalartChange, applyGridChange, applyCellChange, applyFolderChange } from '@/lib/realtime'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids } from '@/lib/api/grids'
import { upsertCellAt } from '@/lib/api/cells'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-01-01T00:00:01.000Z'  // T1 より新しい

// ====================================================================
// applyMandalartChange
// ====================================================================

describe('applyMandalartChange — INSERT (local row が無い)', () => {
  it('cloud の row を INSERT して true を返す', async () => {
    const cellId = 'cell-1'
    db.prepare('INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(cellId, 'grid-1', 4, '', T1, T1)
    const result = await applyMandalartChange({
      eventType: 'INSERT',
      new: { id: 'm-1', title: 'cloud', root_cell_id: cellId, show_checkbox: false, last_grid_id: null, created_at: T1, updated_at: T1, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT title, synced_at FROM mandalarts WHERE id = ?').get('m-1') as { title: string; synced_at: string }
    expect(row.title).toBe('cloud')
    expect(row.synced_at).toBe(T1)
  })
})

describe('applyMandalartChange — UPDATE (local row あり)', () => {
  it('content が同一 (echo) なら false を返し、UI reload しない', async () => {
    const m = await createMandalart('echo-test')
    db.prepare('UPDATE mandalarts SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, m.id)
    // cloud の updated_at が新しい (T2) けど content は同じ → echo
    const result = await applyMandalartChange({
      eventType: 'UPDATE',
      new: { id: m.id, title: m.title, root_cell_id: m.root_cell_id, show_checkbox: false, last_grid_id: null, created_at: m.created_at, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(false)
    // timestamp だけ更新される
    const row = db.prepare('SELECT title, updated_at, synced_at FROM mandalarts WHERE id = ?').get(m.id) as { title: string; updated_at: string; synced_at: string }
    expect(row.title).toBe(m.title)
    expect(row.updated_at).toBe(T2)
    expect(row.synced_at).toBe(T2)
  })

  it('content が違う (他デバイス編集) なら true を返し、UPDATE する', async () => {
    const m = await createMandalart('old-title')
    db.prepare('UPDATE mandalarts SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, m.id)
    const result = await applyMandalartChange({
      eventType: 'UPDATE',
      new: { id: m.id, title: 'new-title', root_cell_id: m.root_cell_id, show_checkbox: false, last_grid_id: null, created_at: m.created_at, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT title FROM mandalarts WHERE id = ?').get(m.id) as { title: string }
    expect(row.title).toBe('new-title')
  })

  it('pinned 変化 → true (Phase A: ピン留めの伝播)', async () => {
    const m = await createMandalart('pintest')
    db.prepare('UPDATE mandalarts SET synced_at = ?, updated_at = ?, pinned = 0 WHERE id = ?').run(T1, T1, m.id)
    const result = await applyMandalartChange({
      eventType: 'UPDATE',
      new: { id: m.id, title: m.title, root_cell_id: m.root_cell_id, show_checkbox: false, last_grid_id: null, sort_order: null, pinned: true, created_at: m.created_at, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT pinned FROM mandalarts WHERE id = ?').get(m.id) as { pinned: number }
    expect(row.pinned).toBe(1)
  })

  it('sort_order 変化 → true (Phase A: 並び替えの伝播)', async () => {
    const m = await createMandalart('sorttest')
    db.prepare('UPDATE mandalarts SET synced_at = ?, updated_at = ?, sort_order = NULL WHERE id = ?').run(T1, T1, m.id)
    const result = await applyMandalartChange({
      eventType: 'UPDATE',
      new: { id: m.id, title: m.title, root_cell_id: m.root_cell_id, show_checkbox: false, last_grid_id: null, sort_order: 3, pinned: false, created_at: m.created_at, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT sort_order FROM mandalarts WHERE id = ?').get(m.id) as { sort_order: number }
    expect(row.sort_order).toBe(3)
  })

  it('cloud の updated_at が古い (stale) なら false を返し、何もしない', async () => {
    const m = await createMandalart('local-newer')
    db.prepare('UPDATE mandalarts SET synced_at = ?, updated_at = ? WHERE id = ?').run(T2, T2, m.id)
    // cloud は T1 < local T2 なので stale
    const result = await applyMandalartChange({
      eventType: 'UPDATE',
      new: { id: m.id, title: 'stale-cloud', root_cell_id: m.root_cell_id, show_checkbox: false, last_grid_id: null, created_at: m.created_at, updated_at: T1, deleted_at: null },
      old: {},
    })
    expect(result).toBe(false)
    const row = db.prepare('SELECT title FROM mandalarts WHERE id = ?').get(m.id) as { title: string }
    expect(row.title).toBe('local-newer') // 上書きされない
  })
})

describe('applyMandalartChange — DELETE (cascade)', () => {
  it('mandalart 配下の cells / grids / mandalart 全部を物理削除する', async () => {
    const m = await createMandalart('to-delete')
    const root = (await getRootGrids(m.id))[0]
    await upsertCellAt(root.id, 0, { text: 'p0' })
    expect((db.prepare('SELECT COUNT(*) AS n FROM cells').get() as { n: number }).n).toBeGreaterThan(0)
    const result = await applyMandalartChange({
      eventType: 'DELETE',
      new: {},
      old: { id: m.id },
    })
    expect(result).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM mandalarts').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells').get()).toEqual({ n: 0 })
  })
})

// ====================================================================
// applyGridChange
// ====================================================================

describe('applyGridChange — INSERT', () => {
  it('local 不在の cloud grid を INSERT して true', async () => {
    const m = await createMandalart('test')
    const cellId = 'gcell-1'
    db.prepare('INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(cellId, 'g-new', 4, '', T1, T1)
    const result = await applyGridChange({
      eventType: 'INSERT',
      new: {
        id: 'g-new', mandalart_id: m.id, center_cell_id: cellId, parent_cell_id: null,
        sort_order: 0, memo: null, created_at: T1, updated_at: T1, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT mandalart_id FROM grids WHERE id = ?').get('g-new') as { mandalart_id: string }
    expect(row.mandalart_id).toBe(m.id)
  })
})

describe('applyGridChange — UPDATE echo / real', () => {
  it('content 同一 → false (timestamp のみ更新)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    db.prepare('UPDATE grids SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, root.id)
    const result = await applyGridChange({
      eventType: 'UPDATE',
      new: {
        id: root.id, mandalart_id: m.id, center_cell_id: root.center_cell_id, parent_cell_id: null,
        sort_order: 0, memo: null, created_at: root.created_at, updated_at: T2, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(false)
  })

  it('memo が違う → true (UPDATE)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    db.prepare('UPDATE grids SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, root.id)
    const result = await applyGridChange({
      eventType: 'UPDATE',
      new: {
        id: root.id, mandalart_id: m.id, center_cell_id: root.center_cell_id, parent_cell_id: null,
        sort_order: 0, memo: 'new memo', created_at: root.created_at, updated_at: T2, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT memo FROM grids WHERE id = ?').get(root.id) as { memo: string }
    expect(row.memo).toBe('new memo')
  })
})

describe('applyGridChange — DELETE', () => {
  it('grid 配下の cells を物理削除する', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    await upsertCellAt(root.id, 0, { text: 'p0' })
    const result = await applyGridChange({ eventType: 'DELETE', new: {}, old: { id: root.id } })
    expect(result).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(root.id)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells WHERE grid_id = ?').get(root.id)).toEqual({ n: 0 })
  })
})

// ====================================================================
// applyCellChange
// ====================================================================

describe('applyCellChange — INSERT', () => {
  it('local 不在の cloud cell を INSERT', async () => {
    const result = await applyCellChange({
      eventType: 'INSERT',
      new: {
        id: 'c-new', grid_id: 'g-x', position: 0, text: 'hello',
        image_path: null, color: null, done: false,
        created_at: T1, updated_at: T1, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT text FROM cells WHERE id = ?').get('c-new') as { text: string }
    expect(row.text).toBe('hello')
  })
})

describe('applyCellChange — UPDATE echo / real', () => {
  it('text が同じ → false', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'unchanged' })
    db.prepare('UPDATE cells SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, cell.id)
    const result = await applyCellChange({
      eventType: 'UPDATE',
      new: {
        id: cell.id, grid_id: cell.grid_id, position: cell.position,
        text: 'unchanged', image_path: null, color: null, done: false,
        created_at: cell.created_at, updated_at: T2, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(false)
  })

  it('text が違う → true', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'old' })
    db.prepare('UPDATE cells SET synced_at = ?, updated_at = ? WHERE id = ?').run(T1, T1, cell.id)
    const result = await applyCellChange({
      eventType: 'UPDATE',
      new: {
        id: cell.id, grid_id: cell.grid_id, position: cell.position,
        text: 'new', image_path: null, color: null, done: false,
        created_at: cell.created_at, updated_at: T2, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT text FROM cells WHERE id = ?').get(cell.id) as { text: string }
    expect(row.text).toBe('new')
  })

  it('done フラグ反転 → true', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'x' })
    db.prepare('UPDATE cells SET synced_at = ?, updated_at = ?, done = 0 WHERE id = ?').run(T1, T1, cell.id)
    const result = await applyCellChange({
      eventType: 'UPDATE',
      new: {
        id: cell.id, grid_id: cell.grid_id, position: cell.position,
        text: 'x', image_path: null, color: null, done: true,
        created_at: cell.created_at, updated_at: T2, deleted_at: null,
      },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT done FROM cells WHERE id = ?').get(cell.id) as { done: number }
    expect(row.done).toBe(1)
  })
})

describe('applyCellChange — DELETE', () => {
  it('cell を物理削除する (cascade なし、cells は子を持たない)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'doomed' })
    const result = await applyCellChange({ eventType: 'DELETE', new: {}, old: { id: cell.id } })
    expect(result).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells WHERE id = ?').get(cell.id)).toEqual({ n: 0 })
  })
})

describe('applyCellChange — id 不在の payload はスキップ', () => {
  it('INSERT で payload.new.id が無いと false を返す', async () => {
    const result = await applyCellChange({
      eventType: 'INSERT',
      new: { grid_id: 'g', position: 0, text: '', created_at: T1, updated_at: T1 },
      old: {},
    })
    expect(result).toBe(false)
  })

  it('DELETE で payload.old.id が無いと false を返す', async () => {
    const result = await applyCellChange({ eventType: 'DELETE', new: {}, old: {} })
    expect(result).toBe(false)
  })
})

// ====================================================================
// applyFolderChange (migration 010 / Phase B)
// ====================================================================

describe('applyFolderChange — INSERT', () => {
  it('local 不在の cloud folder を INSERT', async () => {
    const result = await applyFolderChange({
      eventType: 'INSERT',
      new: { id: 'f-1', name: 'Archive', sort_order: 1, is_system: false, created_at: T1, updated_at: T1, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT name, is_system FROM folders WHERE id = ?').get('f-1') as { name: string; is_system: number }
    expect(row.name).toBe('Archive')
    expect(row.is_system).toBe(0)
  })
})

describe('applyFolderChange — UPDATE echo / real', () => {
  it('content 同一 → false (timestamp のみ更新)', async () => {
    db.prepare('INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at, synced_at) VALUES (?,?,?,?,?,?,?)').run('f-2', 'A', 0, 0, T1, T1, T1)
    const result = await applyFolderChange({
      eventType: 'UPDATE',
      new: { id: 'f-2', name: 'A', sort_order: 0, is_system: false, created_at: T1, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(false)
  })

  it('name 変化 → true (UPDATE)', async () => {
    db.prepare('INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at, synced_at) VALUES (?,?,?,?,?,?,?)').run('f-3', 'old', 0, 0, T1, T1, T1)
    const result = await applyFolderChange({
      eventType: 'UPDATE',
      new: { id: 'f-3', name: 'new', sort_order: 0, is_system: false, created_at: T1, updated_at: T2, deleted_at: null },
      old: {},
    })
    expect(result).toBe(true)
    const row = db.prepare('SELECT name FROM folders WHERE id = ?').get('f-3') as { name: string }
    expect(row.name).toBe('new')
  })
})

describe('applyFolderChange — DELETE', () => {
  it('folder を物理削除する', async () => {
    db.prepare('INSERT INTO folders (id, name, sort_order, is_system, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('f-4', 'doomed', 0, 0, T1, T1)
    const result = await applyFolderChange({ eventType: 'DELETE', new: {}, old: { id: 'f-4' } })
    expect(result).toBe(true)
    expect((db.prepare('SELECT COUNT(*) AS n FROM folders WHERE id = ?').get('f-4') as { n: number }).n).toBe(0)
  })
})
