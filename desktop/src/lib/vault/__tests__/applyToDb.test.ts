import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart } from '@/lib/api/mandalarts'
import { getRootGrids, createGrid } from '@/lib/api/grids'
import { upsertCellAt, updateCell } from '@/lib/api/cells'
import { loadMandalartRows, loadAllMandalartIds } from '@/lib/vault/dbRows'
import { applyVaultRowsToDb } from '@/lib/vault/applyToDb'
import type { MandalartRows } from '@/lib/vault/types'

/**
 * Phase 2 Stage 3b の核心: **file→DB 適用 (applyVaultRowsToDb)** を実 SQLite で検証する。
 * 復元 (wipe→apply で完全一致) / 冪等性 / vault に無い grid·cell の削除 / 全体削除オプション。
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

function strip(o: Record<string, unknown>, extra: string[] = []): Record<string, unknown> {
  const c: Record<string, unknown> = { ...o }
  for (const k of ['deleted_at', 'synced_at', 'remote_id', ...extra]) delete c[k]
  return c
}
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
// 比較用に MandalartRows[] を folder_id/user_id 非依存の形へ正規化。
function norm(all: MandalartRows[]) {
  return sortById(all.map((r) => ({ id: r.mandalart.id, ...r })) as { id: string }[])
    .map((r) => {
      const rows = r as unknown as MandalartRows
      return {
        mandalart: strip(rows.mandalart, ['folder_id', 'user_id', 'image_path']),
        folderName: rows.folderName,
        grids: sortById(rows.grids).map((g) => strip(g)),
        cells: sortById(rows.cells).map((c) => strip(c)),
      }
    })
}
async function snapshotAll(): Promise<MandalartRows[]> {
  const ids = await loadAllMandalartIds()
  const out: MandalartRows[] = []
  for (const id of ids) {
    const r = await loadMandalartRows(id)
    if (r) out.push(r)
  }
  return out
}
function count(table: 'mandalarts' | 'grids' | 'cells'): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE deleted_at IS NULL`).get() as { c: number }).c
}

async function seedSample() {
  const m = await createMandalart('健康')
  const root = (await getRootGrids(m.id))[0]
  const p2 = await upsertCellAt(root.id, 2, { text: '運動' })
  await updateCell(p2.id, { color: 'red-100' })
  await upsertCellAt(root.id, 0, { text: '食事' })
  const child = await createGrid({
    mandalartId: m.id, parentCellId: p2.id, centerCellId: p2.id, sortOrder: 0,
  })
  await upsertCellAt(child.id, 1, { text: '筋トレ' })
  await createGrid({ mandalartId: m.id, parentCellId: null, centerCellId: null, sortOrder: 1 })
  return m
}

describe('applyVaultRowsToDb', () => {
  it('wipe → apply で DB が完全復元する', async () => {
    await seedSample()
    const before = await snapshotAll()

    db.exec('DELETE FROM cells; DELETE FROM grids; DELETE FROM mandalarts; DELETE FROM folders;')
    expect(count('mandalarts')).toBe(0)

    await applyVaultRowsToDb(before)
    const after = await snapshotAll()
    expect(norm(after)).toEqual(norm(before))
  })

  it('2 回適用しても増殖しない (冪等)', async () => {
    await seedSample()
    const before = await snapshotAll()
    const g0 = count('grids')
    const c0 = count('cells')

    await applyVaultRowsToDb(before)
    await applyVaultRowsToDb(before)

    expect(count('grids')).toBe(g0)
    expect(count('cells')).toBe(c0)
    expect(norm(await snapshotAll())).toEqual(norm(before))
  })

  it('vault に無い grid / cell は削除される', async () => {
    await seedSample()
    const before = await snapshotAll()
    const mId = before[0].mandalart.id
    const ts = '2026-06-03T00:00:00.000Z'
    db.prepare(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run('bogus-grid', mId, 'bogus-cell', null, 99, ts, ts)
    db.prepare(
      'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    ).run('bogus-cell', 'bogus-grid', 4, 'x', ts, ts)

    await applyVaultRowsToDb(before)

    expect(db.prepare('SELECT 1 FROM grids WHERE id = ?').get('bogus-grid')).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM cells WHERE id = ?').get('bogus-cell')).toBeUndefined()
  })

  it('skipGridDeletionFor: parse 失敗扱いのマンダラートは vault に無い grid を消さない (G 保護)', async () => {
    await seedSample()
    const before = await snapshotAll()
    const mId = before[0].mandalart.id
    const ts = '2026-06-03T00:00:00.000Z'
    db.prepare(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run('keep-grid', mId, 'keep-cell', null, 99, ts, ts)
    db.prepare(
      'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    ).run('keep-cell', 'keep-grid', 4, 'x', ts, ts)

    // skipGridDeletionFor に該当 id を渡す → 削除スキップ (upsert のみ)
    await applyVaultRowsToDb(before, { skipGridDeletionFor: new Set([mId]) })

    expect(db.prepare('SELECT 1 FROM grids WHERE id = ?').get('keep-grid')).toBeDefined()
    expect(db.prepare('SELECT 1 FROM cells WHERE id = ?').get('keep-cell')).toBeDefined()
  })

  it('deleteMissingMandalarts: vault に無いマンダラートは opt 次第で削除', async () => {
    const m1 = await seedSample()
    await createMandalart('B') // m2 (vault には含めない)
    expect(count('mandalarts')).toBe(2)

    const onlyM1 = (await snapshotAll()).filter((r) => r.mandalart.id === m1.id)

    // false: m2 は残る
    await applyVaultRowsToDb(onlyM1, { deleteMissingMandalarts: false })
    expect(count('mandalarts')).toBe(2)

    // true: m2 は消える
    const report = await applyVaultRowsToDb(onlyM1, { deleteMissingMandalarts: true })
    expect(report.deletedMandalarts).toBe(1)
    expect(count('mandalarts')).toBe(1)
    expect(db.prepare('SELECT id FROM mandalarts').get()).toEqual({ id: m1.id })
  })
})
