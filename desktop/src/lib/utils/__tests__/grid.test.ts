import { describe, it, expect } from 'vitest'
import {
  isCellEmpty,
  hasPeripheralContent,
  getCenterCell,
  getPeripheralCells,
  isGridEmpty,
  isGridContentEmpty,
  cellMap,
  canPasteIntoPeripheral,
} from '../grid'
import { CENTER_POSITION, GRID_CELL_COUNT, PERIPHERAL_POSITIONS } from '@/constants/grid'
import type { Cell, Grid } from '@/types'

function cell(pos: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id: `c-${pos}`,
    grid_id: 'g1',
    position: pos,
    text: overrides.text ?? '',
    image_path: overrides.image_path ?? null,
    color: overrides.color ?? null,
    done: false,
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

describe('canPasteIntoPeripheral', () => {
  it('target が中心セル (position=4) → 常に true (中心の空判定は対象外)', () => {
    const cells = [cell(CENTER_POSITION)]  // 中心も空
    expect(canPasteIntoPeripheral(cell(CENTER_POSITION), cells)).toBe(true)
  })

  it('中心セル非空 → 周辺 paste 許可 (true)', () => {
    const cells = [cell(CENTER_POSITION, { text: 'center' }), cell(0)]
    expect(canPasteIntoPeripheral(cell(0), cells)).toBe(true)
  })

  it('中心セル空 → 周辺 paste 不可 (false)', () => {
    const cells = [cell(CENTER_POSITION), cell(0)]
    expect(canPasteIntoPeripheral(cell(0), cells)).toBe(false)
  })

  it('回帰: drilled child の merged 中心セル (grid_id が表示グリッドと異なるが内容あり) でも許可される', () => {
    // X=C drilled child: 表示グリッド id は 'child'、中心セルは親由来で grid_id='parent' のまま、
    // ただし merge により position=4 にセットされている (落とし穴 #10)。
    // grid_id 一致で探す旧実装はこれを取り逃して誤ブロックしていた。
    const mergedCenter = cell(CENTER_POSITION, { id: 'parent-peripheral', grid_id: 'parent', text: 'drilled' })
    const peripheral = cell(0, { grid_id: 'child' })
    const cells = [mergedCenter, peripheral]
    expect(canPasteIntoPeripheral(peripheral, cells)).toBe(true)
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

describe('isGridContentEmpty', () => {
  function makeGrid(overrides: Partial<Pick<Grid, 'center_cell_id' | 'memo'>> = {}) {
    return {
      center_cell_id: overrides.center_cell_id ?? 'center-id',
      memo: overrides.memo ?? null,
    }
  }

  describe('memo ガード', () => {
    it('memo 非空 + cells 全空 + self-centered → false (= 保持)', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        cell(i, i === CENTER_POSITION ? { id: 'center-id', grid_id: 'g1' } : { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid({ memo: 'note' }), cells, true)).toBe(false)
    })
    it('memo 非空 + cells 全空 + 非 self-centered → false (= 保持)', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        cell(i, i === CENTER_POSITION ? { id: 'center-id', grid_id: 'parent' } : { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid({ memo: 'note' }), cells, false)).toBe(false)
    })
    it('memo 空白のみ + cells 全空 + self-centered → true (= 削除可)', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        cell(i, i === CENTER_POSITION ? { id: 'center-id', grid_id: 'g1' } : { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid({ memo: '   \n  ' }), cells, true)).toBe(true)
    })
    it('memo null + cells 全空 + self-centered → true (= 削除可)', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        cell(i, i === CENTER_POSITION ? { id: 'center-id', grid_id: 'g1' } : { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid({ memo: null }), cells, true)).toBe(true)
    })
  })

  describe('self-centered (root / 独立並列)', () => {
    it('周辺セル 1 つでも非空なら false', () => {
      const cells = [
        cell(0, { text: 'x', grid_id: 'g1' }),
        cell(CENTER_POSITION, { id: 'center-id', grid_id: 'g1' }),
      ]
      expect(isGridContentEmpty(makeGrid(), cells, true)).toBe(false)
    })
    it('中心セルだけ非空でも false (= 保持)', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        i === CENTER_POSITION
          ? cell(i, { id: 'center-id', grid_id: 'g1', text: 'center' })
          : cell(i, { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid(), cells, true)).toBe(false)
    })
    it('全 9 セル空 → true', () => {
      const cells = Array.from({ length: GRID_CELL_COUNT }, (_, i) =>
        cell(i, i === CENTER_POSITION ? { id: 'center-id', grid_id: 'g1' } : { grid_id: 'g1' }),
      )
      expect(isGridContentEmpty(makeGrid(), cells, true)).toBe(true)
    })
  })

  describe('非 self-centered (X=C primary drilled)', () => {
    it('中心セル (親 grid 由来) は無視し、自 grid 所属の周辺が全空なら true', () => {
      // 中心は親由来 (grid_id !== self)、周辺 8 個は自 grid 所属で全空
      const cells: Cell[] = [
        ...Array.from({ length: 8 }, (_, i) => {
          const pos = i < 4 ? i : i + 1 // 0..3, 5..8
          return cell(pos, { grid_id: 'g1' })
        }),
        cell(CENTER_POSITION, { id: 'center-id', grid_id: 'parent', text: 'parent-content' }),
      ]
      expect(isGridContentEmpty(makeGrid({ center_cell_id: 'center-id' }), cells, false)).toBe(true)
    })
    it('周辺セルに 1 つでも内容あれば false', () => {
      const cells: Cell[] = [
        cell(0, { grid_id: 'g1', text: 'a' }),
        ...Array.from({ length: 7 }, (_, i) => {
          const pos = i < 3 ? i + 1 : i + 2
          return cell(pos, { grid_id: 'g1' })
        }),
        cell(CENTER_POSITION, { id: 'center-id', grid_id: 'parent' }),
      ]
      expect(isGridContentEmpty(makeGrid({ center_cell_id: 'center-id' }), cells, false)).toBe(false)
    })
  })
})
