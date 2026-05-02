import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids, createGrid, getGrid } from '@/lib/api/grids'
import { upsertCellAt, swapCellSubtree } from '@/lib/api/cells'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

describe('swapCellSubtree (周辺 ↔ 周辺、両方サブツリー有り)', () => {
  it('セル content + 子グリッドの center_cell_id 両方が swap される', async () => {
    // setup: root grid に peripheral A (pos 0), B (pos 1) を作成し、両方 drill 済 (子グリッド有り)
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const A = await upsertCellAt(root.id, 0, { text: 'A-text' })
    const B = await upsertCellAt(root.id, 1, { text: 'B-text' })
    // A の drilled child grid (center_cell_id = A.id, X=C モデル)
    const childA = await createGrid({
      mandalartId: m.id, parentCellId: A.id, centerCellId: A.id, sortOrder: 0,
    })
    await upsertCellAt(childA.id, 0, { text: 'A-child-content' })
    // B の drilled child grid
    const childB = await createGrid({
      mandalartId: m.id, parentCellId: B.id, centerCellId: B.id, sortOrder: 0,
    })
    await upsertCellAt(childB.id, 0, { text: 'B-child-content' })

    // act: A と B のサブツリー swap
    await swapCellSubtree(A.id, B.id)

    // assert 1: cell content swap
    const Aafter = (await getGrid(root.id)).cells.find((c) => c.id === A.id)
    const Bafter = (await getGrid(root.id)).cells.find((c) => c.id === B.id)
    expect(Aafter?.text).toBe('B-text')
    expect(Bafter?.text).toBe('A-text')

    // assert 2: 子グリッドの center_cell_id + parent_cell_id 両方が swap されている。
    // X=C 統一モデルなので childA.parent_cell_id = childA.center_cell_id = A.id だった。
    // swap 後は両方とも B.id を指すようになり、getChildGrids(B.id) が childA を返す ↔
    // drill from B reaches childA という対称性が保たれる必要がある。
    const childAafter = await getGrid(childA.id)
    const childBafter = await getGrid(childB.id)
    expect(childAafter.center_cell_id).toBe(B.id)
    expect(childBafter.center_cell_id).toBe(A.id)
    expect(childAafter.parent_cell_id).toBe(B.id)
    expect(childBafter.parent_cell_id).toBe(A.id)

    // assert 2b: getChildGrids も swap 後の関係を返す (drill から見ても整合)
    const { getChildGrids } = await import('@/lib/api/grids')
    const childrenOfA = await getChildGrids(A.id)
    const childrenOfB = await getChildGrids(B.id)
    expect(childrenOfA.map((g) => g.id)).toContain(childB.id)
    expect(childrenOfB.map((g) => g.id)).toContain(childA.id)

    // assert 3: drilling into A (now showing B-text) reaches childB (B's old subtree)
    // = grids where center_cell_id = A.id should now contain childB
    const gridsCenteredOnA = db
      .prepare("SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL AND id != ?")
      .all(A.id, root.id) as { id: string }[]
    expect(gridsCenteredOnA.map((g) => g.id)).toContain(childB.id)

    // 同様に drilling into B reaches childA (A's old subtree)
    const gridsCenteredOnB = db
      .prepare("SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL AND id != ?")
      .all(B.id, root.id) as { id: string }[]
    expect(gridsCenteredOnB.map((g) => g.id)).toContain(childA.id)
  })

  it('片方だけサブツリー有りの場合、片方の subtree のみ swap', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const A = await upsertCellAt(root.id, 0, { text: 'A-text' })
    const B = await upsertCellAt(root.id, 1, { text: 'B-text' })
    // A だけ drilled
    const childA = await createGrid({
      mandalartId: m.id, parentCellId: A.id, centerCellId: A.id, sortOrder: 0,
    })

    await swapCellSubtree(A.id, B.id)

    // childA の center は B.id に
    const childAafter = await getGrid(childA.id)
    expect(childAafter.center_cell_id).toBe(B.id)
    // A 側に子グリッドは無い (B には元々無かったので空のまま)
    const gridsCenteredOnA = db
      .prepare("SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL AND id != ?")
      .all(A.id, root.id) as { id: string }[]
    expect(gridsCenteredOnA).toHaveLength(0)
  })
})
