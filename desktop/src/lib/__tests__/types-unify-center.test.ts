import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Grid, Mandalart, GridSnapshot } from '@/types'

/**
 * X/C 統一リファクタで追加された新カラム (grids.center_cell_id /
 * mandalarts.root_cell_id) が型レベルで正しく反映されていることの確認。
 *
 * DB 層 (tauri-plugin-sql) はテスト環境で起動しないので、ここでは型と
 * snapshot 形状のみをチェックする。実動作は Tauri dev でのスモーク確認
 * に委ねる (docs/data-model.md を参照)。
 */

describe('unified X/C model — type guards', () => {
  it('Grid has center_cell_id (NOT NULL) and no parent_cell_id', () => {
    const g: Grid = {
      id: 'g1',
      mandalart_id: 'm1',
      center_cell_id: 'c1',
      sort_order: 0,
      memo: null,
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    }
    expect(g.center_cell_id).toBe('c1')
    expectTypeOf<Grid['center_cell_id']>().toEqualTypeOf<string>()
    // parent_cell_id は新モデルで廃止: プロパティ自体が存在しない
    expectTypeOf<Grid>().not.toHaveProperty('parent_cell_id')
  })

  it('Mandalart has root_cell_id (required)', () => {
    const m: Mandalart = {
      id: 'm1',
      user_id: '',
      title: '',
      root_cell_id: 'c1',
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    }
    expect(m.root_cell_id).toBe('c1')
    expectTypeOf<Mandalart['root_cell_id']>().toEqualTypeOf<string>()
  })

  it('GridSnapshot は並列グリッドを parentPosition=undefined で表現する', () => {
    // 並列グリッドは中心を共有するため snapshot としては parentPosition=undefined で
    // 親グリッドの兄弟として記録する (import/paste 側で center_cell_id を共有するよう復元)
    const snap: GridSnapshot = {
      grid: { sort_order: 1, memo: null },
      cells: [],
      children: [],
      parentPosition: undefined,
    }
    expect(snap.parentPosition).toBeUndefined()
  })
})
