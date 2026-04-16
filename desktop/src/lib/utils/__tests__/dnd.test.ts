import { describe, it, expect } from 'vitest'
import { resolveDndAction } from '../dnd'
import { CENTER_POSITION } from '@/constants/grid'
import type { Cell } from '@/types'

/**
 * D&D ルールテーブル (要件定義に記載):
 *
 * | ドラッグ元 | ドロップ先 | 結果 |
 * |---|---|---|
 * | 周辺 | 周辺 | SWAP_SUBTREE |
 * | 中央 | 入力ありの周辺 | SWAP_CONTENT |
 * | 中央 | 空の周辺 | COPY_SUBTREE |
 * | 入力ありの周辺 | 中央 | SWAP_CONTENT |
 * | 空の周辺 | 中央 | NOOP |
 *
 * 9×9 で異なるサブグリッドまたいだ D&D も同じ判定を再利用するので、
 * ここで分岐が網羅されていれば両方カバーされる。
 */

function cell(overrides: Partial<Cell>): Cell {
  return {
    id: overrides.id ?? `cell-${overrides.position ?? 0}`,
    grid_id: 'g1',
    position: overrides.position ?? 0,
    text: overrides.text ?? '',
    image_path: overrides.image_path ?? null,
    color: overrides.color ?? null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('resolveDndAction', () => {
  it('同一セルへのドロップは NOOP', () => {
    const a = cell({ id: 'a', position: 0, text: 'x' })
    expect(resolveDndAction(a, a)).toEqual({ type: 'NOOP' })
  })

  it('周辺 → 周辺 は SWAP_SUBTREE', () => {
    const src = cell({ id: 's', position: 0, text: 'x' })
    const tgt = cell({ id: 't', position: 1, text: 'y' })
    expect(resolveDndAction(src, tgt)).toEqual({
      type: 'SWAP_SUBTREE',
      cellIdA: 's',
      cellIdB: 't',
    })
  })

  it('中央 → 入力ありの周辺 は SWAP_CONTENT', () => {
    const src = cell({ id: 's', position: CENTER_POSITION, text: 'center' })
    const tgt = cell({ id: 't', position: 1, text: 'peri' })
    expect(resolveDndAction(src, tgt)).toEqual({
      type: 'SWAP_CONTENT',
      cellIdA: 's',
      cellIdB: 't',
    })
  })

  it('中央 → 空の周辺 は COPY_SUBTREE', () => {
    const src = cell({ id: 's', position: CENTER_POSITION, text: 'center' })
    const tgt = cell({ id: 't', position: 1, text: '' })
    expect(resolveDndAction(src, tgt)).toEqual({
      type: 'COPY_SUBTREE',
      sourceCellId: 's',
      targetCellId: 't',
    })
  })

  it('入力ありの周辺 → 中央 は SWAP_CONTENT', () => {
    const src = cell({ id: 's', position: 1, text: 'peri' })
    const tgt = cell({ id: 't', position: CENTER_POSITION, text: 'center' })
    expect(resolveDndAction(src, tgt)).toEqual({
      type: 'SWAP_CONTENT',
      cellIdA: 's',
      cellIdB: 't',
    })
  })

  it('空の周辺 → 中央 は NOOP', () => {
    const src = cell({ id: 's', position: 1, text: '' })
    const tgt = cell({ id: 't', position: CENTER_POSITION, text: 'center' })
    expect(resolveDndAction(src, tgt)).toEqual({ type: 'NOOP' })
  })

  it('画像のみの周辺セルは「入力あり」扱い (SWAP_SUBTREE 継続)', () => {
    const src = cell({ id: 's', position: 0, image_path: 'a.png' })
    const tgt = cell({ id: 't', position: 1, text: 'x' })
    expect(resolveDndAction(src, tgt)).toEqual({
      type: 'SWAP_SUBTREE',
      cellIdA: 's',
      cellIdB: 't',
    })
  })
})
