import { describe, it, expect } from 'vitest'
import { reorderArray } from '../reorderArray'

describe('reorderArray', () => {
  it('隣接 swap (src < target): A を B 上にドロップ → [B, A, C]', () => {
    expect(reorderArray(['A', 'B', 'C'], 0, 1)).toEqual(['B', 'A', 'C'])
  })

  it('隣接 swap (src > target): C を B 上にドロップ → [A, C, B]', () => {
    expect(reorderArray(['A', 'B', 'C'], 2, 1)).toEqual(['A', 'C', 'B'])
  })

  it('先頭から末尾への移動: A を C 上にドロップ → [B, C, A]', () => {
    expect(reorderArray(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'C', 'A'])
  })

  it('targetIdx === length (末尾より下にドロップ) → 末尾に append', () => {
    // useDashboardDnd の card 源末尾 fallback で `targetIndex = cardRectsRef.current.length` を渡す経路
    expect(reorderArray(['A', 'B', 'C'], 0, 3)).toEqual(['B', 'C', 'A'])
    expect(reorderArray(['A', 'B', 'C'], 1, 3)).toEqual(['A', 'C', 'B'])
  })

  it('末尾から先頭への移動: C を A 上にドロップ → [C, A, B]', () => {
    expect(reorderArray(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B'])
  })

  it('同位置への drop は no-op (元配列のコピーを返す)', () => {
    const input = ['A', 'B', 'C']
    const result = reorderArray(input, 1, 1)
    expect(result).toEqual(['A', 'B', 'C'])
    expect(result).not.toBe(input)  // shallow copy で別 ref
  })

  it('srcIdx が範囲外なら no-op', () => {
    expect(reorderArray(['A', 'B', 'C'], 5, 0)).toEqual(['A', 'B', 'C'])
    expect(reorderArray(['A', 'B', 'C'], -1, 0)).toEqual(['A', 'B', 'C'])
  })
})
