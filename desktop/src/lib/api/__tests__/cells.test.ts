import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids, createGrid, getGrid } from '@/lib/api/grids'
import { upsertCellAt, updateCell, pasteCell, swapCellSubtree, swapCellContent, toggleCellDone, shredCellSubtree } from '@/lib/api/cells'

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

  it('done も content と一緒に swap される (チェックボックス状態がセルに付随)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const A = await upsertCellAt(root.id, 0, { text: 'A-text' })
    const B = await upsertCellAt(root.id, 1, { text: 'B-text' })
    // A だけ done 化 (周辺 2 つのうち 1 つなので中心は done にならない)
    await toggleCellDone(A.id)

    const doneOf = (id: string) =>
      Number((db.prepare('SELECT done FROM cells WHERE id = ?').get(id) as { done: number }).done)
    expect(doneOf(A.id)).toBe(1)
    expect(doneOf(B.id)).toBe(0)

    // swap → done が text と一緒に入れ替わる
    await swapCellContent(A.id, B.id)
    expect(doneOf(A.id)).toBe(0)
    expect(doneOf(B.id)).toBe(1)
    // text も入れ替わっていること (回帰確認)
    const after = (await getGrid(root.id)).cells
    expect(after.find((c) => c.id === A.id)?.text).toBe('B-text')
    expect(after.find((c) => c.id === B.id)?.text).toBe('A-text')
  })
})

describe('shredCellSubtree (done 上方再計算)', () => {
  function doneOf(id: string): number {
    const row = db.prepare('SELECT done FROM cells WHERE id = ?').get(id) as { done: number }
    return Number(row.done)
  }

  it('未 done の周辺セルを shred すると、残った全周辺が done のとき中心セルも done になる', async () => {
    // setup: root の周辺 X を drill → child grid (center = X)。child に P1 / P2 を非空作成。
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const X = await upsertCellAt(root.id, 0, { text: 'X' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: X.id, centerCellId: X.id, sortOrder: 0,
    })
    const p1 = await upsertCellAt(child.id, 0, { text: 'P1' })
    const p2 = await upsertCellAt(child.id, 1, { text: 'P2' })

    // P1 を done に → P2 が未 done なので中心 X はまだ done にならない
    await toggleCellDone(p1.id)
    expect(doneOf(p1.id)).toBe(1)
    expect(doneOf(X.id)).toBe(0)

    // P2 を shred → 残る非空周辺は P1 (done) のみ → 中心 X が done になるべき
    await shredCellSubtree(p2.id)
    expect(doneOf(X.id)).toBe(1)
  })

  it('regression: 残った周辺が未 done のままなら中心セルは done にならない', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const X = await upsertCellAt(root.id, 0, { text: 'X' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: X.id, centerCellId: X.id, sortOrder: 0,
    })
    const p1 = await upsertCellAt(child.id, 0, { text: 'P1' })
    const p2 = await upsertCellAt(child.id, 1, { text: 'P2' })

    // どちらも未 done のまま P2 を shred → 残る P1 が未 done なので中心は done にならない
    await shredCellSubtree(p2.id)
    expect(doneOf(p1.id)).toBe(0)
    expect(doneOf(X.id)).toBe(0)
  })
})

describe('updateCell / pasteCell (新規入力セルは必ず未完了)', () => {
  const doneOf = (id: string) =>
    Number((db.prepare('SELECT done FROM cells WHERE id = ?').get(id) as { done: number }).done)

  it('stale done セルへ再入力すると未完了になる (空→非空で done=0 リセット)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'task' })
    await toggleCellDone(cell.id)
    expect(doneOf(cell.id)).toBe(1)

    // 内容を空に編集 (done は stale で残る = 非空→空では reset しない仕様)
    await updateCell(cell.id, { text: '' })
    expect(doneOf(cell.id)).toBe(1)

    // 再入力 (空→非空) → 必ず未完了
    await updateCell(cell.id, { text: 'new-task' })
    expect(doneOf(cell.id)).toBe(0)
  })

  it('既存非空セルの text 編集では done を保持する (空→非空でないため)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const cell = await upsertCellAt(root.id, 0, { text: 'task' })
    await toggleCellDone(cell.id)
    expect(doneOf(cell.id)).toBe(1)

    await updateCell(cell.id, { text: 'task (edited)' })
    expect(doneOf(cell.id)).toBe(1)
  })

  it('cut で source セルの done が 0 にリセットされる', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    // 周辺セルへの paste は中心セル非空が前提なので中心を埋める
    await upsertCellAt(root.id, 4, { text: 'center' })
    const src = await upsertCellAt(root.id, 0, { text: 'src' })
    const dst = await upsertCellAt(root.id, 1, { text: 'dst' })
    await toggleCellDone(src.id)
    expect(doneOf(src.id)).toBe(1)

    await pasteCell(src.id, dst.id, 'cut')
    // source は空クリア + done=0
    expect(doneOf(src.id)).toBe(0)
  })
})
