import type { Cell } from '@/types'

/** セルが「空」かどうか（text が空 かつ image_path が null） */
export function isCellEmpty(cell: Pick<Cell, 'text' | 'image_path'>): boolean {
  return cell.text.trim() === '' && cell.image_path === null
}

/** 中心セル（position 4）を取得 */
export function getCenterCell(cells: Cell[]): Cell | undefined {
  return cells.find((c) => c.position === 4)
}

/** 周辺セル（position 0-3, 5-8）を取得 */
export function getPeripheralCells(cells: Cell[]): Cell[] {
  return cells.filter((c) => c.position !== 4)
}

/** 周辺セルに入力があるか（中心クリア可否チェック） */
export function hasPeripheralContent(cells: Cell[]): boolean {
  return getPeripheralCells(cells).some((c) => !isCellEmpty(c))
}

/** 9セルの配列から position → Cell のマップを作る */
export function cellMap(cells: Cell[]): Map<number, Cell> {
  return new Map(cells.map((c) => [c.position, c]))
}

/** グリッドの全セルが空か */
export function isGridEmpty(cells: Cell[]): boolean {
  return cells.every((c) => isCellEmpty(c))
}
