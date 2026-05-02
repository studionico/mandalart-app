import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import {
  getRootGrids, getChildGrids, getGrid, createGrid, deleteGrid, cleanupOrphanGrids,
} from '@/lib/api/grids'
import { upsertCellAt } from '@/lib/api/cells'
import { CENTER_POSITION } from '@/constants/grid'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

function nowIso(): string {
  return new Date().toISOString()
}

describe('getRootGrids', () => {
  it('parent_cell_id IS NULL の root grid のみ返す', async () => {
    const m = await createMandalart('test')
    const roots = await getRootGrids(m.id)
    expect(roots).toHaveLength(1)
    expect(roots[0].parent_cell_id).toBeNull()
    expect(roots[0].mandalart_id).toBe(m.id)
  })

  it('drilled / 並列 grid は root として返さない', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    // root の peripheral cell を作って、そこから drill する
    const peripheral = await upsertCellAt(root.id, 0, { text: 'p0' })
    await createGrid({
      mandalartId: m.id,
      parentCellId: peripheral.id,
      centerCellId: peripheral.id, // primary drilled (X=C)
      sortOrder: 0,
    })
    const roots = await getRootGrids(m.id)
    expect(roots).toHaveLength(1) // 増えていない
    expect(roots[0].id).toBe(root.id)
  })
})

describe('getChildGrids', () => {
  it('指定 cell を parent_cell_id に持つ grid を sort_order 順で返す', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 1, { text: 'p1' })
    const g1 = await createGrid({
      mandalartId: m.id, parentCellId: cell.id, centerCellId: cell.id, sortOrder: 0,
    })
    const g2 = await createGrid({
      mandalartId: m.id, parentCellId: cell.id, centerCellId: null, sortOrder: 1,
    })
    const children = await getChildGrids(cell.id)
    expect(children.map((g) => g.id)).toEqual([g1.id, g2.id])
  })
})

describe('createGrid', () => {
  it('centerCellId=null は新 center cell を独立 INSERT する (並列独立)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 2, { text: 'p2' })
    const g = await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: null, sortOrder: 0,
    })
    expect(g.center_cell_id).not.toBe(peripheral.id)
    const centerCells = db.prepare('SELECT * FROM cells WHERE id = ?').all(g.center_cell_id)
    expect(centerCells).toHaveLength(1)
  })

  it('centerCellId 指定は cell を新規作成せず既存を共有 (primary drilled X=C)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 3, { text: 'p3' })
    const cellsBefore = (db.prepare('SELECT COUNT(*) AS n FROM cells').get() as { n: number }).n
    await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: peripheral.id, sortOrder: 0,
    })
    const cellsAfter = (db.prepare('SELECT COUNT(*) AS n FROM cells').get() as { n: number }).n
    expect(cellsAfter).toBe(cellsBefore) // cell 増えていない
  })
})

describe('getGrid', () => {
  it('root grid: 自 grid 所属の center を含む 9 要素を返す', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const fetched = await getGrid(root.id)
    // peripheral は lazy なので center 1 行だけ
    expect(fetched.cells.find((c) => c.position === CENTER_POSITION)).toBeDefined()
  })

  it('child grid (X=C): 親の cell を center として merge する', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 0, { text: 'parent-text' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: peripheral.id, sortOrder: 0,
    })
    // child grid に peripheral cell を 1 つ追加
    await upsertCellAt(child.id, 1, { text: 'inner' })
    const fetched = await getGrid(child.id)
    const center = fetched.cells.find((c) => c.position === CENTER_POSITION)
    expect(center?.text).toBe('parent-text') // 親 cell が center として merge されている
  })
})

describe('deleteGrid (cascade & sync-aware)', () => {
  it('未同期 grid: cells も grid 本体も hard delete', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 5, { text: 'p5' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: peripheral.id, sortOrder: 0,
    })
    await upsertCellAt(child.id, 0, { text: 'inner-cell' })
    await deleteGrid(child.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(child.id)).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cells WHERE grid_id = ?').get(child.id)).toEqual({ n: 0 })
  })

  it('同期済み grid: cells も grid も deleted_at セット', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 6, { text: 'p6' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: peripheral.id, sortOrder: 0,
    })
    await upsertCellAt(child.id, 0, { text: 'inner-cell' })
    db.prepare('UPDATE cells SET synced_at = ? WHERE grid_id = ?').run(nowIso(), child.id)
    db.prepare('UPDATE grids SET synced_at = ? WHERE id = ?').run(nowIso(), child.id)
    await deleteGrid(child.id)
    const gridRow = db.prepare('SELECT deleted_at FROM grids WHERE id = ?').get(child.id) as { deleted_at: string | null }
    const cellRow = db.prepare('SELECT deleted_at FROM cells WHERE grid_id = ?').get(child.id) as { deleted_at: string | null }
    expect(gridRow.deleted_at).toBeTruthy()
    expect(cellRow.deleted_at).toBeTruthy()
  })

  it('再帰削除: 子グリッドの孫グリッドも対象', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const p = await upsertCellAt(root.id, 7, { text: 'p7' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: p.id, centerCellId: p.id, sortOrder: 0,
    })
    const childInner = await upsertCellAt(child.id, 0, { text: 'inner' })
    const grandchild = await createGrid({
      mandalartId: m.id, parentCellId: childInner.id, centerCellId: childInner.id, sortOrder: 0,
    })
    await deleteGrid(child.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(grandchild.id)).toEqual({ n: 0 })
  })
})

describe('cleanupOrphanGrids', () => {
  it('drilled grid で peripheral 全部空 + 非 orphan な子孫なし → orphan として削除', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const peripheral = await upsertCellAt(root.id, 8, { text: 'p8' })
    const empty = await createGrid({
      mandalartId: m.id, parentCellId: peripheral.id, centerCellId: peripheral.id, sortOrder: 0,
    })
    // empty grid には peripheral cells を作っていないので「中身なし」= orphan 候補
    const result = await cleanupOrphanGrids()
    expect(result.gridsDeleted).toBeGreaterThanOrEqual(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(empty.id)).toEqual({ n: 0 })
  })

  it('root grid (parent_cell_id IS NULL) は中身がなくても orphan 扱いしない', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    // root はそのまま (peripheral 未入力) → orphan として消されてはいけない
    await cleanupOrphanGrids()
    expect(db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(root.id)).toEqual({ n: 1 })
  })
})
