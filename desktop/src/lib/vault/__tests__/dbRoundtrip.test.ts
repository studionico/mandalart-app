import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids, createGrid } from '@/lib/api/grids'
import { upsertCellAt, updateCell, toggleCellDone } from '@/lib/api/cells'
import { loadMandalartRows } from '@/lib/vault/dbRows'
import { mandalartToVaultFiles, vaultFilesToRows } from '@/lib/vault/vaultModel'

/**
 * Phase 2 Stage 3a: **実 SQLite (in-memory)** の行が vault ファイル経由で完全往復することを保証する。
 * 実際の API (createMandalart / drill / parallel / cell 編集 / done) で作ったデータに対して
 * loadMandalartRows → mandalartToVaultFiles → vaultFilesToRows を通し、modeled な全フィールドが
 * 一致することを検証する (vault が追跡しない deleted_at / synced_at / remote_id は除外して比較)。
 */

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

// vault が持たない sync / soft-delete 列を除いて比較する。
function strip(o: Record<string, unknown>, extra: string[] = []): Record<string, unknown> {
  const c: Record<string, unknown> = { ...o }
  for (const k of ['deleted_at', 'synced_at', 'remote_id', ...extra]) delete c[k]
  return c
}
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

describe('vault ⇄ 実 SQLite round-trip', () => {
  it('root + drilled(X=C) + 並列 + lazy + done + color を欠落なく往復', async () => {
    const m = await createMandalart('健康')
    const root = (await getRootGrids(m.id))[0]

    // root 周辺セルを編集 (lazy: 他は空のまま)
    const p2 = await upsertCellAt(root.id, 2, { text: '運動' })
    await updateCell(p2.id, { color: 'red-100' })
    const p0 = await upsertCellAt(root.id, 0, { text: '食事' })
    await toggleCellDone(p0.id)

    // p2 を drill (X=C primary: center_cell_id = parent_cell_id = p2)
    const child = await createGrid({
      mandalartId: m.id,
      parentCellId: p2.id,
      centerCellId: p2.id,
      sortOrder: 0,
    })
    await upsertCellAt(child.id, 1, { text: '筋トレ' })

    // root 並列グリッド (独立 center)
    await createGrid({ mandalartId: m.id, parentCellId: null, centerCellId: null, sortOrder: 1 })

    // load → files → rows
    const rows = await loadMandalartRows(m.id)
    expect(rows).not.toBeNull()
    const vault = mandalartToVaultFiles(rows!)
    const restored = vaultFilesToRows(vault.files)
    expect(restored).not.toBeNull()

    // mandalart (vault が持たない user_id / image_path / folder_id は除外、folderName は別途比較)
    expect(strip(restored!.mandalart, ['image_path', 'folder_id', 'user_id'])).toEqual(
      strip(rows!.mandalart, ['image_path', 'folder_id', 'user_id']),
    )
    expect(restored!.folderName).toBe(rows!.folderName) // 'Inbox'

    // grids / cells
    expect(sortById(restored!.grids).map((g) => strip(g))).toEqual(
      sortById(rows!.grids).map((g) => strip(g)),
    )
    expect(sortById(restored!.cells).map((c) => strip(c))).toEqual(
      sortById(rows!.cells).map((c) => strip(c)),
    )
  })

  it('grid 3 種 (root/drilled/parallel) が DB の parent/center をそのまま保持する', async () => {
    const m = await createMandalart('t')
    const root = (await getRootGrids(m.id))[0]
    const p3 = await upsertCellAt(root.id, 3, { text: 'X' })
    // drilled (X=C) は中身を持たせる (空 X=C grid は lazy grid として vault に焼かれないため)
    const drilled = await createGrid({ mandalartId: m.id, parentCellId: p3.id, centerCellId: p3.id, sortOrder: 0 })
    await upsertCellAt(drilled.id, 0, { text: 'drilled-content' })
    await createGrid({ mandalartId: m.id, parentCellId: null, centerCellId: null, sortOrder: 1 })

    const rows = (await loadMandalartRows(m.id))!
    const restored = vaultFilesToRows(mandalartToVaultFiles(rows).files)!

    const byId = (gs: typeof rows.grids) => new Map(gs.map((g) => [g.id, g]))
    const a = byId(rows.grids)
    const b = byId(restored.grids)
    expect(b.size).toBe(a.size)
    for (const [id, g] of a) {
      expect(b.get(id)!.parent_cell_id).toBe(g.parent_cell_id)
      expect(b.get(id)!.center_cell_id).toBe(g.center_cell_id)
    }
  })
})
