import { describe, it, expect } from 'vitest'
import {
  isCellEmpty,
  hasPeripheralContent,
  getCenterCell,
  getPeripheralCells,
  isGridEmpty,
  cellMap,
} from '../grid'
import { CENTER_POSITION, GRID_CELL_COUNT, PERIPHERAL_POSITIONS } from '@/constants/grid'
import type { Cell } from '@/types'

function cell(pos: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id: `c-${pos}`,
    grid_id: 'g1',
    position: pos,
    text: overrides.text ?? '',
    image_path: overrides.image_path ?? null,
    color: overrides.color ?? null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('isCellEmpty', () => {
  it('text 空 + image なし → empty', () => {
    expect(isCellEmpty(cell(0))).toBe(true)
  })
  it('text 空白のみ (trim 後空) → empty', () => {
    expect(isCellEmpty(cell(0, { text: '   \n  ' }))).toBe(true)
  })
  it('text あり → not empty', () => {
    expect(isCellEmpty(cell(0, { text: 'hello' }))).toBe(false)
  })
  it('text 空でも image あり → not empty', () => {
    expect(isCellEmpty(cell(0, { image_path: 'a.png' }))).toBe(false)
  })
})

describe('getCenterCell / getPeripheralCells', () => {
  const cells = [
    cell(0, { text: 'a' }),
    cell(CENTER_POSITION, { text: 'c' }),
    cell(8, { text: 'z' }),
  ]

  it('中央セル (position=4) を返す', () => {
    expect(getCenterCell(cells)?.text).toBe('c')
  })

  it('中央が無ければ undefined', () => {
    expect(getCenterCell([cell(0), cell(1)])).toBeUndefined()
  })

  it('周辺セルは中央を除いたもの', () => {
    const peripherals = getPeripheralCells(cells)
    expect(peripherals).toHaveLength(2)
    expect(peripherals.every((c) => c.position !== CENTER_POSITION)).toBe(true)
  })
})

describe('hasPeripheralContent', () => {
  it('全周辺セルが空 → false', () => {
    const cells = PERIPHERAL_POSITIONS.map((p) => cell(p))
    expect(hasPeripheralContent(cells)).toBe(false)
  })
  it('周辺に 1 つでも入力があれば true', () => {
    const cells = PERIPHERAL_POSITIONS.map((p, i) =>
      cell(p, i === 0 ? { text: 'x' } : {}),
    )
    expect(hasPeripheralContent(cells)).toBe(true)
  })
  it('中央に入力があっても周辺が空なら false (中央はカウントしない)', () => {
    const cells = [cell(CENTER_POSITION, { text: 'c' })]
    expect(hasPeripheralContent(cells)).toBe(false)
  })
})

describe('isGridEmpty', () => {
  it('全セル空 → true', () => {
    const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) => cell(i))
    expect(isGridEmpty(cells)).toBe(true)
  })
  it('1 セルでも入力あり → false', () => {
    const cells = [cell(0), cell(CENTER_POSITION, { text: 'x' })]
    expect(isGridEmpty(cells)).toBe(false)
  })
})

describe('cellMap', () => {
  it('position → Cell の Map を返す', () => {
    const cells = [cell(0, { text: 'a' }), cell(CENTER_POSITION, { text: 'c' })]
    const m = cellMap(cells)
    expect(m.get(0)?.text).toBe('a')
    expect(m.get(CENTER_POSITION)?.text).toBe('c')
    expect(m.get(8)).toBeUndefined()
  })
})
