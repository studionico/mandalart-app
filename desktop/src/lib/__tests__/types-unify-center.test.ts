import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Grid, Mandalart, GridSnapshot } from '@/types'

/**
 * migration 004 (X=C 統一) + migration 006 (独立並列 center) で導入された
 * grids.center_cell_id / grids.parent_cell_id / mandalarts.root_cell_id が
 * 型レベルで正しく反映されていることの確認。
 *
 * DB 層 (tauri-plugin-sql) はテスト環境で起動しないので、ここでは型と
 * snapshot 形状のみをチェックする。実動作は Tauri dev でのスモーク確認
 * に委ねる (docs/data-model.md を参照)。
 */

describe('grid schema — type guards', () => {
  it('Grid has center_cell_id (NOT NULL) and parent_cell_id (nullable)', () => {
    const g: Grid = {
      id: 'g1',
      mandalart_id: 'm1',
      center_cell_id: 'c1',
      parent_cell_id: null,
      sort_order: 0,
      memo: null,
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    }
    expect(g.center_cell_id).toBe('c1')
    expect(g.parent_cell_id).toBeNull()
    expectTypeOf<Grid['center_cell_id']>().toEqualTypeOf<string>()
    // migration 006: root grid は null、drilled grid は drill 元 cell id
    expectTypeOf<Grid['parent_cell_id']>().toEqualTypeOf<string | null>()
  })

  it('drilled Grid は parent_cell_id に cell id を持てる', () => {
    const g: Grid = {
      id: 'g2',
      mandalart_id: 'm1',
      center_cell_id: 'cellY',
      parent_cell_id: 'cellY',
      sort_order: 0,
      memo: null,
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    }
    expect(g.parent_cell_id).toBe('cellY')
  })

  it('Mandalart has root_cell_id (required)', () => {
    const m: Mandalart = {
      id: 'm1',
      user_id: '',
      title: '',
      root_cell_id: 'c1',
      show_checkbox: false,
      pinned: false,
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    }
    expect(m.root_cell_id).toBe('c1')
    expectTypeOf<Mandalart['root_cell_id']>().toEqualTypeOf<string>()
  })

  it('GridSnapshot は並列グリッドを parentPosition=undefined で表現する', () => {
    // 並列グリッドは snapshot としては親グリッドの兄弟として parentPosition=undefined で記録。
    // import 側で独立した center cell として復元される (migration 006 以降)。
    const snap: GridSnapshot = {
      grid: { sort_order: 1, memo: null },
      cells: [],
      children: [],
      parentPosition: undefined,
    }
    expect(snap.parentPosition).toBeUndefined()
  })
})
