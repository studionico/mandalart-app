/**
 * `cleanupGridIfEmpty` の判定ロジック網羅テスト。
 *
 * 実体は [`EditorLayout.tsx`](../EditorLayout.tsx) 内の closure だが、ロジックは
 * `getGrid` + [`isGridContentEmpty`](../../../lib/utils/grid.ts) + `permanentDeleteGrid`
 * の組み合わせなので、ここでは同等のラッパー `runCleanup()` をテスト側で再構成して
 * DB シナリオから検証する。
 *
 * 4 経路 (drill-up / breadcrumb / 並列スライド / Home) は EditorLayout 内で異なる
 * state 遷移を辿るが、最終的に呼ばれるのは同じ `cleanupGridIfEmpty(oldGridId)`。
 * 経路の違いは「`oldGridId` をどう特定するか」であり判定本体は経路非依存。
 * 経路ごとに DB 状態を組み立てて runCleanup を呼ぶことで E2E 等価のカバレッジになる。
 */

import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import {
  getRootGrids,
  getGrid,
  createGrid,
  permanentDeleteGrid,
  updateGridMemo,
} from '@/lib/api/grids'
import { upsertCellAt } from '@/lib/api/cells'
import { isGridContentEmpty } from '@/lib/utils/grid'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

/**
 * EditorLayout の `cleanupGridIfEmpty` と等価なラッパー。
 * 同期挙動を維持するために実装本体をコピーしている。本体側の変更時は
 * 両方を同時に更新すること。
 */
async function runCleanup(gridId: string): Promise<boolean> {
  const gridWithCells = await getGrid(gridId)
  const centerCellId = gridWithCells.center_cell_id
  const centerCell = gridWithCells.cells.find((c) => c.id === centerCellId)
  const isSelfCentered = centerCell?.grid_id === gridWithCells.id
  if (!isGridContentEmpty(gridWithCells, gridWithCells.cells, isSelfCentered)) {
    return false
  }
  await permanentDeleteGrid(gridId)
  return true
}

function gridExists(id: string): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM grids WHERE id = ?').get(id) as {
    n: number
  }
  return row.n > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// drill-up 経路 (sub-grid)
// ─────────────────────────────────────────────────────────────────────────────

describe('drill-up 経路: child grid (X=C primary drilled)', () => {
  it('memo あり + 周辺全空 のサブグリッドは削除されない (= 保持)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id,
      parentCellId: a.id,
      centerCellId: a.id,
      sortOrder: 0,
    })
    await updateGridMemo(child.id, 'note-to-keep')

    const deleted = await runCleanup(child.id)
    expect(deleted).toBe(false)
    expect(gridExists(child.id)).toBe(true)

    const refetched = await getGrid(child.id)
    expect(refetched.memo).toBe('note-to-keep')
  })

  it('memo 空 + 周辺全空 のサブグリッドは削除される (regression)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 1, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id,
      parentCellId: a.id,
      centerCellId: a.id,
      sortOrder: 0,
    })

    const deleted = await runCleanup(child.id)
    expect(deleted).toBe(true)
    expect(gridExists(child.id)).toBe(false)
  })

  it('memo 空 + 周辺 1 つ非空 のサブグリッドは削除されない (regression)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 2, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id,
      parentCellId: a.id,
      centerCellId: a.id,
      sortOrder: 0,
    })
    await upsertCellAt(child.id, 0, { text: 'inner-content' })

    const deleted = await runCleanup(child.id)
    expect(deleted).toBe(false)
    expect(gridExists(child.id)).toBe(true)
  })

  it('memo が空白のみ + 周辺全空 のサブグリッドは削除される', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 3, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id,
      parentCellId: a.id,
      centerCellId: a.id,
      sortOrder: 0,
    })
    await updateGridMemo(child.id, '   \n   \t  ')

    const deleted = await runCleanup(child.id)
    expect(deleted).toBe(true)
    expect(gridExists(child.id)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// breadcrumb 戻り経路: 上位階層クリック相当
// ─────────────────────────────────────────────────────────────────────────────

describe('breadcrumb 戻り経路: 深い階層のサブグリッド', () => {
  it('孫 grid に memo を入れて breadcrumb で 2 段戻る → 孫 grid は保持', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: a.id, sortOrder: 0,
    })
    const b = await upsertCellAt(child.id, 0, { text: 'B' })
    const grandchild = await createGrid({
      mandalartId: m.id, parentCellId: b.id, centerCellId: b.id, sortOrder: 0,
    })
    await updateGridMemo(grandchild.id, 'grandchild-memo')

    // breadcrumb で root に戻ると、まず grandchild の cleanup が走る (現在地が grandchild の場合)
    const deleted = await runCleanup(grandchild.id)
    expect(deleted).toBe(false)
    expect(gridExists(grandchild.id)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 並列スライド経路: 独立並列 grid (self-centered)
// ─────────────────────────────────────────────────────────────────────────────

describe('並列スライド経路: 独立並列 grid (self-centered)', () => {
  it('self-centered な並列 grid に memo を入れて並列スライド → 削除されない', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    // primary drilled (child)
    const primary = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: a.id, sortOrder: 0,
    })
    // 並列独立 grid (centerCellId=null で新 center cell を作る → self-centered)
    const parallel = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: null, sortOrder: 1,
    })
    await updateGridMemo(parallel.id, 'parallel-memo')
    // primary は cleanup 対象ではないがテストの確実性のためダミー読み
    expect(primary.id).toBeTruthy()

    const deleted = await runCleanup(parallel.id)
    expect(deleted).toBe(false)
    expect(gridExists(parallel.id)).toBe(true)
  })

  it('self-centered + memo 空 + 中心セル空 + 周辺全空 → 削除される (regression)', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    const parallel = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: null, sortOrder: 0,
    })

    const deleted = await runCleanup(parallel.id)
    expect(deleted).toBe(true)
    expect(gridExists(parallel.id)).toBe(false)
  })

  it('self-centered + memo 空 + 中心セル非空 + 周辺全空 → 削除されない', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    const parallel = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: null, sortOrder: 0,
    })
    // 並列独立 grid の中心セル (= self-centered) に内容を入れる
    db.prepare("UPDATE cells SET text = ? WHERE id = ?").run('center-text', parallel.center_cell_id)

    const deleted = await runCleanup(parallel.id)
    expect(deleted).toBe(false)
    expect(gridExists(parallel.id)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Home 戻り経路: handleNavigateHome から cleanupGridIfEmpty に委譲されるケース
// ─────────────────────────────────────────────────────────────────────────────

describe('Home 戻り経路: child grid を経由した Home 戻り', () => {
  it('child grid に memo を入れて Home 戻り → child grid は保持', async () => {
    const m = await createMandalart('test')
    const root = (await getRootGrids(m.id))[0]
    const a = await upsertCellAt(root.id, 0, { text: 'A' })
    const child = await createGrid({
      mandalartId: m.id, parentCellId: a.id, centerCellId: a.id, sortOrder: 0,
    })
    await updateGridMemo(child.id, 'memo-on-child')

    const deleted = await runCleanup(child.id)
    expect(deleted).toBe(false)
    expect(gridExists(child.id)).toBe(true)
  })

  // NOTE: sole-root + 空セル + memo の `permanentDeleteMandalart` 経路は今回スコープ外
  // (handleNavigateHome の memo ガード未対応)。child grid 経由の `cleanupGridIfEmpty` 委譲分のみ検証。
})
