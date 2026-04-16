import { describe, it, expect } from 'vitest'
import { TAB_ORDER, TAB_ORDER_REVERSE, nextTabPosition } from '../tabOrder'
import { CENTER_POSITION, GRID_CELL_COUNT } from '../grid'

describe('TAB_ORDER', () => {
  it('長さは GRID_CELL_COUNT (= 9)', () => {
    expect(TAB_ORDER.length).toBe(GRID_CELL_COUNT)
  })
  it('中央 (4) から始まる', () => {
    expect(TAB_ORDER[0]).toBe(CENTER_POSITION)
  })
  it('0..8 が 1 回ずつ登場する', () => {
    const set = new Set(TAB_ORDER)
    expect(set.size).toBe(GRID_CELL_COUNT)
    for (let i = 0; i < GRID_CELL_COUNT; i++) {
      expect(set.has(i)).toBe(true)
    }
  })
  it('REVERSE は TAB_ORDER の逆順', () => {
    expect(TAB_ORDER_REVERSE).toEqual([...TAB_ORDER].reverse())
  })
})

describe('nextTabPosition', () => {
  it('中央 (4) の次は 7 (時計回り先頭)', () => {
    expect(nextTabPosition(CENTER_POSITION)).toBe(7)
  })
  it('TAB_ORDER[i] の次は TAB_ORDER[i+1]', () => {
    for (let i = 0; i < TAB_ORDER.length - 1; i++) {
      expect(nextTabPosition(TAB_ORDER[i])).toBe(TAB_ORDER[i + 1])
    }
  })
  it('末尾 (TAB_ORDER 最後) の次は先頭 (ループ)', () => {
    const last = TAB_ORDER[TAB_ORDER.length - 1]
    expect(nextTabPosition(last)).toBe(TAB_ORDER[0])
  })
  it('reverse=true は逆方向に進む', () => {
    const first = TAB_ORDER[0]
    const last = TAB_ORDER[TAB_ORDER.length - 1]
    // 中央 (先頭) から Shift+Tab で末尾へ戻る
    expect(nextTabPosition(first, true)).toBe(last)
  })
})
