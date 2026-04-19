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
  // grids 本体と自 grid 所属の cells は互いに独立してクエリできるので Promise.all で並列化
  // (この関数は drill や画面遷移の critical path にいるので、ラウンドトリップを 1 本減らす)
  const [grids, ownCells] = await Promise.all([
    query<Grid>(
      'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
      [id],
    ),
    query<Cell>(
      'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
      [id],
    ),
  ])
  const grid = grids[0]
  if (!grid) throw new Error(`Grid not found: ${id}`)

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

  // 9 セル (root) / 8 セル (child・並列) を multi-row VALUES 1 文で一括 INSERT する。
  // 以前は for ループで 1 行ずつ await execute していたため毎回 8-9 往復していた。
  const cellRows: Array<[string, string, number, string, string, string]> = []
  if (params.centerCellId === null) {
    // root グリッド: 9 cells (center + 8 peripherals)
    const centerCellId = generateId()
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, centerCellId, params.sortOrder, ts, ts],
    )
    for (let i = 0; i < GRID_CELL_COUNT; i++) {
      const cellId = i === CENTER_POSITION ? centerCellId : generateId()
      cellRows.push([cellId, gridId, i, '', ts, ts])
    }
  } else {
    // 子 / 並列グリッド: 8 peripherals のみ (center は親 grid の cell を共有)
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, params.centerCellId, params.sortOrder, ts, ts],
    )
    for (let i = 0; i < GRID_CELL_COUNT; i++) {
      if (i === CENTER_POSITION) continue
      cellRows.push([generateId(), gridId, i, '', ts, ts])
    }
  }
  const valuesSql = cellRows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
  const flatParams = cellRows.flat()
  await execute(
    `INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES ${valuesSql}`,
    flatParams,
  )

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

// ---------------------------------------------------------------------------
// Orphan cleanup: 「表示上は root から辿れるが、内容が無く削除しても問題ない」
// 空グリッドを洗い出して soft-delete する。
//
// 対象:
//  1. **過去の無限再帰バグ (pre-b1ce52c 時代) のチェーン残骸** NG_1 → NG_2 → ... → NG_last
//  2. **auto-cleanup 対象外の「単独 drilled + 空のまま」grid**
//     cleanupGridIfEmpty (EditorLayout) は「兄弟が自分 1 つだけ (= 単独 drilled)」は削除しない
//     仕様 (X 保持のため drill してすぐ戻ったグリッドを残す設計)。結果として、ユーザーが
//     繰り返し drill して中身を埋めなかった場合に「単独の空 grid」が累積する。
//     この整理機能では cleanupGridIfEmpty が見逃す単独空 grid も削除対象に含める。
//
// 判定条件 (以下すべて満たすと orphan):
//   - root grid ではない (mandalart.root_cell_id != grid.center_cell_id)
//   - 周辺セルがすべて空 (text = '' AND image_path IS NULL)
//   - drilled children が全て orphan か、存在しない (反復で畳み込み)
//
// root の下で内容が実体として現れる grid (非空 peripheral / 子孫に非空あり) は除外される。
//
// パフォーマンス: DB 全体を最初に 3 クエリだけで読み、以降はメモリ内で処理。
// ---------------------------------------------------------------------------

export type OrphanStats = {
  orphanGridIds: string[]
  orphanCellIds: string[]
  totalGrids: number
  totalCells: number
}

export async function findOrphanGrids(): Promise<OrphanStats> {
  // 1. 必要なデータを 3 クエリだけで一括取得
  type GridRow = { id: string; mandalart_id: string; center_cell_id: string }
  type CellRow = { id: string; grid_id: string; position: number; text: string; image_path: string | null }
  type MandalartRow = { id: string; root_cell_id: string }

  const [allGrids, allCells, allMandalarts] = await Promise.all([
    query<GridRow>(
      'SELECT id, mandalart_id, center_cell_id FROM grids WHERE deleted_at IS NULL',
    ),
    query<CellRow>(
      'SELECT id, grid_id, position, text, image_path FROM cells WHERE deleted_at IS NULL',
    ),
    query<MandalartRow>(
      'SELECT id, root_cell_id FROM mandalarts WHERE deleted_at IS NULL',
    ),
  ])

  // 2. インデックス構築 (全て O(N) で構築し、以降の反復は O(1) lookup)
  const rootCellIdByMandalart = new Map<string, string>()
  for (const m of allMandalarts) rootCellIdByMandalart.set(m.id, m.root_cell_id)

  // grid_id → その grid が所有する cells (all cells, 中心含む)
  const ownCellsByGrid = new Map<string, CellRow[]>()
  for (const c of allCells) {
    const arr = ownCellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    ownCellsByGrid.set(c.grid_id, arr)
  }

  // center_cell_id → その cell を center にしている grid id 群
  const gridsByCenterCellId = new Map<string, string[]>()
  for (const g of allGrids) {
    const arr = gridsByCenterCellId.get(g.center_cell_id) ?? []
    arr.push(g.id)
    gridsByCenterCellId.set(g.center_cell_id, arr)
  }

  // 各 grid の「drilled children grid ids」= 自 grid の cells を center にしている他 grid
  const drilledChildrenByGrid = new Map<string, string[]>()
  for (const g of allGrids) {
    const ownCells = ownCellsByGrid.get(g.id) ?? []
    const children: string[] = []
    for (const cell of ownCells) {
      const childGrids = gridsByCenterCellId.get(cell.id) ?? []
      for (const chId of childGrids) {
        if (chId !== g.id) children.push(chId)
      }
    }
    drilledChildrenByGrid.set(g.id, children)
  }

  // 3. 候補抽出: "非 root + 全 peripheral が空" な grid
  function isEmptyPeripherals(gridId: string): boolean {
    const cells = ownCellsByGrid.get(gridId) ?? []
    // cells には中心も含まれるので、peripheral (position != 4) だけをチェック
    const peripherals = cells.filter((c) => c.position !== 4)
    if (peripherals.length === 0) return true
    return peripherals.every((c) => c.text === '' && c.image_path === null)
  }
  function isRoot(g: GridRow): boolean {
    return rootCellIdByMandalart.get(g.mandalart_id) === g.center_cell_id
  }
  const candidateIds: string[] = []
  for (const g of allGrids) {
    if (isRoot(g)) continue
    if (isEmptyPeripherals(g.id)) candidateIds.push(g.id)
  }

  // 4. 反復: "drilled children が全て orphan" な候補を畳み込み
  //    末端 (children なし) は即時 orphan 確定、チェーンは末端から逆向きに伝播する。
  //    正当な「中身のある子孫がある」drilled grid は、非 orphan な子孫を持つので
  //    isEmptyPeripherals が true でも ここで orphan 扱いされない。
  const orphanSet = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const gid of candidateIds) {
      if (orphanSet.has(gid)) continue
      const children = drilledChildrenByGrid.get(gid) ?? []
      const hasNonOrphanChild = children.some((c) => !orphanSet.has(c))
      if (!hasNonOrphanChild) {
        orphanSet.add(gid)
        changed = true
      }
    }
  }

  const orphanGridIds = [...orphanSet]
  // 5. orphan grid に属する cells (grid_id が orphan のもの) を抽出
  const orphanCellIds: string[] = []
  for (const gid of orphanGridIds) {
    const cells = ownCellsByGrid.get(gid) ?? []
    for (const c of cells) orphanCellIds.push(c.id)
  }

  return {
    orphanGridIds,
    orphanCellIds,
    totalGrids: allGrids.length,
    totalCells: allCells.length,
  }
}

/**
 * 孤立グリッドと配下のセルを soft-delete する。
 * 同期経由で cloud 側にも deleted_at が伝播する (RLS に弾かれる行は push エラーとして残るが、
 * local データの整合性は取れる)。
 */
export async function cleanupOrphanGrids(): Promise<{
  gridsDeleted: number
  cellsDeleted: number
}> {
  const { orphanGridIds, orphanCellIds } = await findOrphanGrids()
  const ts = now()
  // cells 先行 (親 grid の deleted_at 設定前に子 cells をマーク)
  const BATCH = 500
  for (let i = 0; i < orphanCellIds.length; i += BATCH) {
    const batch = orphanCellIds.slice(i, i + BATCH)
    const ph = batch.map(() => '?').join(',')
    await execute(
      `UPDATE cells SET deleted_at = ?, updated_at = ? WHERE id IN (${ph})`,
      [ts, ts, ...batch],
    )
  }
  for (let i = 0; i < orphanGridIds.length; i += BATCH) {
    const batch = orphanGridIds.slice(i, i + BATCH)
    const ph = batch.map(() => '?').join(',')
    await execute(
      `UPDATE grids SET deleted_at = ?, updated_at = ? WHERE id IN (${ph})`,
      [ts, ts, ...batch],
    )
  }
  return { gridsDeleted: orphanGridIds.length, cellsDeleted: orphanCellIds.length }
}
