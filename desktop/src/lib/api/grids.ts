import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import type { Grid, Cell } from '../../types'

/**
 * getGrid の内部ヘルパ。
 * 親グリッドに属する center cell (例: 親 grid の position=7 にあった cell X) を
 * 子グリッドの cells 配列へ入れるときに、UI 上は「中心 (position=4)」として
 * 扱わせたい。DB の position (=親内位置) をそのまま使うと:
 *   - 描画で中心スロットが空、親 X の元位置 (7 等) に二重表示
 *   - handleCellDrill の center click 判定 (position === CENTER_POSITION) が失敗して
 *     中心クリックで親に戻れない
 * ため、merged view では position を CENTER_POSITION に上書きする。
 * updateCell は id ベースで行うので DB 上の position は親グリッド値のまま保たれる。
 */
function withCenterPosition(cell: Cell): Cell {
  return { ...cell, position: CENTER_POSITION }
}

/**
 * 並列ルートグリッド群を列挙する。
 *
 * 新モデル (migration 004 以降):
 * - 並列ルートは全員 `center_cell_id = mandalarts.root_cell_id` を指す
 * - sort_order で順序付け
 */
export async function getRootGrids(mandalartId: string): Promise<Grid[]> {
  return query<Grid>(
    `SELECT g.* FROM grids g
     JOIN mandalarts m ON m.id = g.mandalart_id
     WHERE g.mandalart_id = ?
       AND g.center_cell_id = m.root_cell_id
       AND g.deleted_at IS NULL
     ORDER BY g.sort_order`,
    [mandalartId],
  )
}

/**
 * ある cell を中心 (drill 元) とする子グリッド群 (並列含む) を列挙する。
 * sort_order 昇順。
 *
 * 自己参照 (cell の所属 grid と同じ grid。= root 中心セルがその root grid を center として持つ) は
 * 「drill 元」としては意味を持たないので除外する。並列グリッドはすべて新規に作られた grid の
 * 行なので g.id != cell.grid_id となり、通常の drilled children と一緒に返される。
 */
export async function getChildGrids(parentCellId: string): Promise<Grid[]> {
  return query<Grid>(
    `SELECT g.* FROM grids g
     JOIN cells c ON c.id = ?
     WHERE g.center_cell_id = ?
       AND g.id != c.grid_id
       AND g.deleted_at IS NULL
     ORDER BY g.sort_order`,
    [parentCellId, parentCellId],
  )
}

/**
 * grid + cells (常に 9 要素) を返す。
 *
 * - root grid: 自 grid_id に 9 行 (position 0..8) → そのまま返す
 * - child grid: 自 grid_id に 8 行 (position 0-3, 5-8) + 親グリッドに属する center cell 1 行
 *   を merge して 9 要素にする
 */
export async function getGrid(id: string): Promise<Grid & { cells: Cell[] }> {
  const grids = await query<Grid>(
    'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  const grid = grids[0]
  if (!grid) throw new Error(`Grid not found: ${id}`)

  const ownCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [id],
  )

  // center cell が自 grid に含まれているか確認 (root なら含まれる、子なら含まれない)
  const hasCenter = ownCells.some((c) => c.id === grid.center_cell_id)
  if (hasCenter) {
    // root grid: center cell は既に position=4 で入っている
    ownCells.sort((a, b) => a.position - b.position)
    return { ...grid, cells: ownCells }
  }

  // 子 grid: 親の cell を「中心 (position=4)」として merge する
  const centers = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [grid.center_cell_id],
  )
  const merged: Cell[] = [...ownCells]
  if (centers[0]) {
    merged.push(withCenterPosition(centers[0]))
  }
  merged.sort((a, b) => a.position - b.position)
  return { ...grid, cells: merged }
}

/**
 * グリッドを新規作成する。
 *
 * - `centerCellId = null`: root グリッド作成。新規 center cell を生成し、8 peripherals と共に insert (計 9 cells)。
 *   戻り値の grid.center_cell_id は自動生成された center cell の id。
 *   呼び出し側 (createMandalart) は、初回 root 作成時にこの center_cell_id を mandalarts.root_cell_id に保存する。
 * - `centerCellId` 指定: 子 / 並列グリッド作成。center は既存 cell (親 peripheral or 並列共有中心) を再利用し、
 *   8 peripherals のみを insert (position=4 の cell 行は作らない)。
 */
export async function createGrid(params: {
  mandalartId: string
  centerCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }> {
  const gridId = generateId()
  const ts = now()

  if (params.centerCellId === null) {
    // root グリッド: 9 cells (center + 8 peripherals)
    const centerCellId = generateId()
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, centerCellId, params.sortOrder, ts, ts],
    )
    for (let i = 0; i < GRID_CELL_COUNT; i++) {
      const cellId = i === CENTER_POSITION ? centerCellId : generateId()
      await execute(
        'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [cellId, gridId, i, '', ts, ts],
      )
    }
  } else {
    // 子 / 並列グリッド: 8 peripherals のみ (center は親 grid の cell を共有)
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, params.centerCellId, params.sortOrder, ts, ts],
    )
    for (let i = 0; i < GRID_CELL_COUNT; i++) {
      if (i === CENTER_POSITION) continue
      await execute(
        'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [generateId(), gridId, i, '', ts, ts],
      )
    }
  }

  return getGrid(gridId)
}

export async function updateGridMemo(id: string, memo: string): Promise<void> {
  await execute('UPDATE grids SET memo = ?, updated_at = ? WHERE id = ?', [memo, now(), id])
}

/**
 * ソフトデリート: grid とその配下のセル・サブグリッドを再帰的に論理削除する。
 *
 * 注意 (新モデル):
 * - 自グリッドの peripherals (grid_id = self.id) は全て soft-delete 対象
 * - 子グリッド (center_cell_id = peripheral.id で辿る) は再帰 delete
 * - 子グリッドの center cell は親グリッドに属する (grid_id = parent.id) ので、
 *   `UPDATE cells SET deleted_at WHERE grid_id = self.id` の対象外となり自動的に保全される
 */
export async function deleteGrid(id: string): Promise<void> {
  const ts = now()
  const cells = await query<{ id: string }>(
    'SELECT id FROM cells WHERE grid_id = ? AND deleted_at IS NULL',
    [id],
  )
  for (const c of cells) {
    const subGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
      [c.id, id],
    )
    for (const sg of subGrids) {
      await deleteGrid(sg.id)
    }
  }
  await execute(
    'UPDATE cells SET deleted_at = ?, updated_at = ? WHERE grid_id = ?',
    [ts, ts, id],
  )
  await execute(
    'UPDATE grids SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [ts, ts, id],
  )
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<void> {
  await execute('UPDATE grids SET sort_order = ?, updated_at = ? WHERE id = ?', [sortOrder, now(), id])
}
