import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids, createGrid, getGrid, getChildGrids } from '@/lib/api/grids'
import { upsertCellAt, shredCellSubtree, isSelfCenterWithPeripheralContent } from '@/lib/api/cells'
import { buildCellSnapshot, pasteSnapshot } from '@/lib/api/stock'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

describe('カット相当のフロー (buildCellSnapshot → shredCellSubtree → pasteSnapshot)', () => {
  it('周辺セルを snapshot 退避 → shred → 同セルに復元すると content + 子グリッドが戻る (= undo)', async () => {
    const m = await createMandalart('root-title')
    const root = (await getRootGrids(m.id))[0]
    // 周辺セルへの paste は「中心セル非空」が前提なので root 中心に content を入れておく。
    await upsertCellAt(root.id, 4, { text: 'center' })
    const A = await upsertCellAt(root.id, 0, { text: 'A-text' })
    const childA = await createGrid({
      mandalartId: m.id, parentCellId: A.id, centerCellId: A.id, sortOrder: 0,
    })
    await upsertCellAt(childA.id, 0, { text: 'A-child' })

    // カット: snapshot 退避 → 即削除
    const snap = await buildCellSnapshot(A.id)
    await shredCellSubtree(A.id)

    const Aempty = (await getGrid(root.id)).cells.find((c) => c.id === A.id)
    expect(Aempty?.text).toBe('')
    expect(await getChildGrids(A.id)).toHaveLength(0)

    // undo: 同セルに snapshot を復元
    await pasteSnapshot(snap, A.id)

    const Arestored = (await getGrid(root.id)).cells.find((c) => c.id === A.id)
    expect(Arestored?.text).toBe('A-text')
    const childrenAfter = await getChildGrids(A.id)
    expect(childrenAfter).toHaveLength(1)
    const restoredChildCells = (await getGrid(childrenAfter[0].id)).cells
    expect(restoredChildCells.some((c) => c.text === 'A-child')).toBe(true)
  })

  it('カット → 別セルに paste で移動 (元は空のまま / 移動先に content)', async () => {
    const m = await createMandalart('root-title')
    const root = (await getRootGrids(m.id))[0]
    await upsertCellAt(root.id, 4, { text: 'center' })
    const A = await upsertCellAt(root.id, 0, { text: 'move-me' })
    const B = await upsertCellAt(root.id, 1, {})  // 空の移動先

    const snap = await buildCellSnapshot(A.id)
    await shredCellSubtree(A.id)
    await pasteSnapshot(snap, B.id)

    const cells = (await getGrid(root.id)).cells
    expect(cells.find((c) => c.id === A.id)?.text).toBe('')
    expect(cells.find((c) => c.id === B.id)?.text).toBe('move-me')
  })
})

describe('isSelfCenterWithPeripheralContent (中心セル保護判定)', () => {
  it('自グリッド中心 + 周辺非空 → true', async () => {
    const m = await createMandalart('root-title')
    const root = (await getRootGrids(m.id))[0]
    await upsertCellAt(root.id, 0, { text: 'peripheral' })
    const centerId = (await getGrid(root.id)).center_cell_id!
    expect(await isSelfCenterWithPeripheralContent(centerId)).toBe(true)
  })

  it('自グリッド中心 + 周辺すべて空 → false', async () => {
    const m = await createMandalart('root-title')
    const root = (await getRootGrids(m.id))[0]
    const centerId = (await getGrid(root.id)).center_cell_id!
    expect(await isSelfCenterWithPeripheralContent(centerId)).toBe(false)
  })

  it('周辺セル (position != 4) → false', async () => {
    const m = await createMandalart('root-title')
    const root = (await getRootGrids(m.id))[0]
    const A = await upsertCellAt(root.id, 0, { text: 'peripheral' })
    expect(await isSelfCenterWithPeripheralContent(A.id)).toBe(false)
  })
})
