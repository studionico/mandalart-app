import { CENTER_POSITION } from '@/constants/grid'
import type { Cell, Grid } from '@/types'

/** セルが「空」かどうか（text が空 かつ image_path が null） */
export function isCellEmpty(cell: Pick<Cell, 'text' | 'image_path'>): boolean {
  return cell.text.trim() === '' && cell.image_path === null
}

/** 中心セル（position 4）を取得 */
export function getCenterCell(cells: Cell[]): Cell | undefined {
  return cells.find((c) => c.position === CENTER_POSITION)
}

/** 周辺セル（position 0-3, 5-8）を取得 */
export function getPeripheralCells(cells: Cell[]): Cell[] {
  return cells.filter((c) => c.position !== CENTER_POSITION)
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

/**
 * グリッドが「内容なし」(= 自動 cleanup 対象) かどうかを判定する純関数。
 *
 * memo (サイドパネル記述) は cells と独立した内容として扱う。memo が trim 後非空なら
 * 周辺セル全空でも grid を保持する (= サブグリッドの中心セルにだけ memo を入れた状態
 * を保護する)。memo の有無を見ない判定だけだと drill-up / breadcrumb / 並列 / Home の
 * 各経路で `cleanupGridIfEmpty` に巻き込まれて memo ごと hard-delete される。
 *
 * 引数の `cells` は `getGrid` が返す merge 済 9 要素配列を想定 (中心は親 grid 由来含む)。
 * `isSelfCentered` は呼出側で `cells.find(c => c.id === grid.center_cell_id)?.grid_id === grid.id`
 * 相当を計算して渡す (落とし穴 #10 の中心セル 3 パターンを反映するため)。
 */
export function isGridContentEmpty(
  grid: Pick<Grid, 'center_cell_id' | 'memo'>,
  cells: Cell[],
  isSelfCentered: boolean,
): boolean {
  if ((grid.memo ?? '').trim() !== '') return false
  if (isSelfCentered) {
    const center = getCenterCell(cells)
    const peripherals = getPeripheralCells(cells)
    const centerEmpty = !center || isCellEmpty(center)
    return centerEmpty && peripherals.every(isCellEmpty)
  }
  // 非 self-centered: 自 grid 所属の peripherals (centerCellId 以外) が全空か
  const peripherals = cells.filter((c) => c.id !== grid.center_cell_id)
  return peripherals.every(isCellEmpty)
}
