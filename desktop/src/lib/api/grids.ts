import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION } from '@/constants/grid'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
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
 * migration 006 以降: `parent_cell_id IS NULL` が root の判定キー。
 * - 新規並列ルートは独自 center cell を持つので center_cell_id 比較では拾えない
 * - レガシー並列ルート (center_cell_id = root_cell_id) も parent_cell_id=NULL で統一的に拾える
 */
export async function getRootGrids(mandalartId: string): Promise<Grid[]> {
  return query<Grid>(
    `SELECT * FROM grids
     WHERE mandalart_id = ?
       AND parent_cell_id IS NULL
       AND deleted_at IS NULL
     ORDER BY sort_order`,
    [mandalartId],
  )
}

/**
 * ある cell を drill 元とする子グリッド群 (primary + 並列) を列挙する。
 * sort_order 昇順。
 *
 * migration 006 以降は `parent_cell_id = ?` で判定。primary は `center_cell_id = parent_cell_id`、
 * 並列は `center_cell_id` が独自 cell を指すが `parent_cell_id` は同じなので統一クエリで拾える。
 * レガシー並列も backfill で `parent_cell_id = center_cell_id` になっているため同じく拾える。
 */
export async function getChildGrids(parentCellId: string): Promise<Grid[]> {
  return query<Grid>(
    `SELECT * FROM grids
     WHERE parent_cell_id = ?
       AND deleted_at IS NULL
     ORDER BY sort_order`,
    [parentCellId],
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
 * グリッドを新規作成する。migration 006 以降の 3 モードをサポート。
 *
 * - `parentCellId = null, centerCellId = null`: root 初期作成 (createMandalart 経由)。
 *   新 center cell を generate して空コンテンツで INSERT。mandalarts.root_cell_id に保存される想定。
 * - `parentCellId = Y, centerCellId = Y`: primary drilled グリッド (X=C 維持)。
 *   新 cell 行は作らず、center_cell_id に親 peripheral cell id をそのまま入れる。
 * - `parentCellId = Y, centerCellId = null`: 並列グリッド (独立 center)。
 *   新 center cell を generate して空コンテンツで INSERT。parent_cell_id は Y を継承。
 */
export async function createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  centerCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }> {
  const gridId = generateId()
  const ts = now()

  if (params.centerCellId === null) {
    // root 初期作成 or 並列独立作成: 新 center cell を空で INSERT
    const centerCellId = generateId()
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, centerCellId, params.parentCellId, params.sortOrder, ts, ts],
    )
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [centerCellId, gridId, CENTER_POSITION, '', ts, ts],
    )
  } else {
    // primary drilled (X=C): 新 cell は作らず既存 cell を center に共有
    await execute(
      'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [gridId, params.mandalartId, params.centerCellId, params.parentCellId, params.sortOrder, ts, ts],
    )
  }

  return getGrid(gridId)
}

export async function updateGridMemo(id: string, memo: string): Promise<void> {
  await execute('UPDATE grids SET memo = ?, updated_at = ? WHERE id = ?', [memo, now(), id])
}

/**
 * grid とその配下のセル・サブグリッドを再帰的に削除する。
 *
 * 削除方式:
 * - **未同期行 (synced_at IS NULL)**: hard delete (物理削除)。cloud に存在しないので
 *   soft-delete すると永遠に dirty な orphan 行になる (push で RLS 403 を誘発)
 * - **同期済み行 (synced_at IS NOT NULL)**: soft-delete。push で cloud 側に deleted_at を伝播
 *
 * 新モデルの注意:
 * - 自グリッドの peripherals (grid_id = self.id) は全て削除対象
 * - 子グリッド (center_cell_id = peripheral.id で辿る) は再帰 delete
 * - 子グリッドの center cell は親グリッドに属する (grid_id = parent.id) ので、
 *   `DELETE/UPDATE cells WHERE grid_id = self.id` の対象外となり自動的に保全される
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
  // cells: 未同期 → hard delete, 同期済み → soft delete
  await execute('DELETE FROM cells WHERE grid_id = ? AND synced_at IS NULL', [id])
  await execute(
    'UPDATE cells SET deleted_at = ?, updated_at = ? WHERE grid_id = ? AND synced_at IS NOT NULL',
    [ts, ts, id],
  )
  // grid 本体: 同じく分岐
  await execute('DELETE FROM grids WHERE id = ? AND synced_at IS NULL', [id])
  await execute(
    'UPDATE grids SET deleted_at = ?, updated_at = ? WHERE id = ? AND synced_at IS NOT NULL',
    [ts, ts, id],
  )
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<void> {
  await execute('UPDATE grids SET sort_order = ?, updated_at = ? WHERE id = ?', [sortOrder, now(), id])
}

/**
 * grid を物理削除する (local + cloud)。
 *
 * 用途: 自動掃除 (`cleanupGridIfEmpty`) や整理ボタン (`cleanupOrphanGrids`) のように
 * 「復元の意図がない削除」で使う。`deleteGrid` の soft-delete では cloud に `deleted_at`
 * 付き行が永続的に残り、grid 単位の restore UI が存在しないまま storage を食い続けるため。
 *
 * mandalart のゴミ箱経由 (`deleteMandalart`) は引き続き `deleteGrid` の soft-delete を
 * 使う (restore のために残す)。
 *
 * 並列グリッドも `center_cell_id` を共有する兄弟。`DELETE FROM cells WHERE grid_id = ?`
 * は自 grid 所属の 8 peripherals のみを対象とし、共有 center cell は別の grid からも
 * 参照され続けるので巻き込み削除は起きない。
 */
export async function permanentDeleteGrid(id: string): Promise<void> {
  // 1. local: cells → grid の順で hard delete (自 grid の peripheral cells のみ)
  await execute('DELETE FROM cells WHERE grid_id = ?', [id])
  await execute('DELETE FROM grids WHERE id = ?', [id])

  // 2. cloud: 未サインイン / Supabase 未設定なら何もしない
  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  try {
    await supabase.from('cells').delete().eq('grid_id', id)
    await supabase.from('grids').delete().eq('id', id)
  } catch (e) {
    console.warn('[permanentDeleteGrid] cloud delete failed (local delete already succeeded):', e)
  }
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
  // 1. 必要なデータを 2 クエリだけで一括取得 (mandalarts は parent_cell_id による root 判定で不要になった)
  type GridRow = { id: string; mandalart_id: string; center_cell_id: string; parent_cell_id: string | null }
  type CellRow = { id: string; grid_id: string; position: number; text: string; image_path: string | null }

  const [allGrids, allCells] = await Promise.all([
    query<GridRow>(
      'SELECT id, mandalart_id, center_cell_id, parent_cell_id FROM grids WHERE deleted_at IS NULL',
    ),
    query<CellRow>(
      'SELECT id, grid_id, position, text, image_path FROM cells WHERE deleted_at IS NULL',
    ),
  ])

  // 2. インデックス構築 (全て O(N) で構築し、以降の反復は O(1) lookup)
  // grid_id → その grid が所有する cells (all cells, 中心含む)
  const ownCellsByGrid = new Map<string, CellRow[]>()
  for (const c of allCells) {
    const arr = ownCellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    ownCellsByGrid.set(c.grid_id, arr)
  }

  // parent_cell_id → その cell を drill 元とする grid id 群 (primary + 並列)。
  // 新モデルの並列グリッドは独自 center を持つので center_cell_id ベースでは拾えない。
  // parent_cell_id ベースなら primary / 並列 / レガシー全てを統一的に子として検出できる。
  const gridsByParentCellId = new Map<string, string[]>()
  for (const g of allGrids) {
    if (g.parent_cell_id == null) continue
    const arr = gridsByParentCellId.get(g.parent_cell_id) ?? []
    arr.push(g.id)
    gridsByParentCellId.set(g.parent_cell_id, arr)
  }

  // 各 grid の「drilled children grid ids」= 自 grid の cells を drill 元 (parent_cell_id) とする他 grid
  const drilledChildrenByGrid = new Map<string, string[]>()
  for (const g of allGrids) {
    const ownCells = ownCellsByGrid.get(g.id) ?? []
    const children: string[] = []
    for (const cell of ownCells) {
      const childGrids = gridsByParentCellId.get(cell.id) ?? []
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
    return g.parent_cell_id == null
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
 * 孤立グリッドと配下のセルを物理削除する (local + cloud)。
 *
 * 以前は「未同期 → hard delete / 同期済み → soft delete (cloud に deleted_at 伝播)」に
 * 分岐していたが、grid / cell 単位の restore UI が存在しないため soft-deleted 行は
 * cloud に永続的にゴミとして残り続ける問題があった。整理ボタンで掃除する対象なので
 * 「復元意図なし」と解釈し、local + cloud を一律 hard delete する方針に変更。
 */
export async function cleanupOrphanGrids(): Promise<{
  gridsDeleted: number
  cellsDeleted: number
}> {
  const { orphanGridIds, orphanCellIds } = await findOrphanGrids()
  const BATCH = 500

  // 1. local: cells → grids の順で hard delete
  for (let i = 0; i < orphanCellIds.length; i += BATCH) {
    const batch = orphanCellIds.slice(i, i + BATCH)
    const ph = batch.map(() => '?').join(',')
    await execute(`DELETE FROM cells WHERE id IN (${ph})`, batch)
  }
  for (let i = 0; i < orphanGridIds.length; i += BATCH) {
    const batch = orphanGridIds.slice(i, i + BATCH)
    const ph = batch.map(() => '?').join(',')
    await execute(`DELETE FROM grids WHERE id IN (${ph})`, batch)
  }

  // 2. cloud: 未サインイン / Supabase 未設定なら何もしない
  if (!isSupabaseConfigured) return { gridsDeleted: orphanGridIds.length, cellsDeleted: orphanCellIds.length }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { gridsDeleted: orphanGridIds.length, cellsDeleted: orphanCellIds.length }

  // Supabase の in() は一度に送れる引数数に実用上の上限がある (URI 長) ので同じ BATCH で刻む
  try {
    for (let i = 0; i < orphanCellIds.length; i += BATCH) {
      const batch = orphanCellIds.slice(i, i + BATCH)
      await supabase.from('cells').delete().in('id', batch)
    }
    for (let i = 0; i < orphanGridIds.length; i += BATCH) {
      const batch = orphanGridIds.slice(i, i + BATCH)
      await supabase.from('grids').delete().in('id', batch)
    }
  } catch (e) {
    console.warn('[cleanupOrphanGrids] cloud delete failed (local delete already succeeded):', e)
  }

  return { gridsDeleted: orphanGridIds.length, cellsDeleted: orphanCellIds.length }
}

/**
 * cloud (Supabase) 側の空 cell を物理削除する。
 *
 * 背景: lazy cell creation 設計で local 側は空 cell を作らない / migration 005 で既存も
 * 物理削除済。だが local の物理削除は sync の dirty 判定で拾えない (削除対象が SELECT で
 * 出てこない) ため、cloud には過去の空 cell が滞留する。これを定期的に掃除する。
 *
 * 残す条件:
 * - center_cell_id として grids から参照されている cell (root grid の中心セル等)
 * - 何らかの content (text 非空 / image_path / color / done=true) を持つ cell
 *
 * RLS により自分の所有データのみが対象になる。
 *
 * 失敗時は warn のみ (定期実行で user 体験を壊さない)。
 */
export async function cleanupEmptyCellsInCloud(): Promise<{ deletedCount: number }> {
  if (!isSupabaseConfigured) return { deletedCount: 0 }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { deletedCount: 0 }

  try {
    // 1. center_cell_id として参照されている cell id を全部集める
    const referencedRows = await supabase.from('grids').select('center_cell_id')
    if (referencedRows.error) throw referencedRows.error
    const referencedIds = new Set(
      ((referencedRows.data ?? []) as { center_cell_id: string }[])
        .map((r) => r.center_cell_id)
        .filter((v): v is string => v != null),
    )

    // 2. 空 cell を pagination で全件回収 (Supabase の select はデフォルト 1000 行上限)
    const PAGE = 1000
    const emptyIds: string[] = []
    let pageStart = 0
    for (;;) {
      const page = await supabase
        .from('cells')
        .select('id')
        .eq('text', '')
        .is('image_path', null)
        .is('color', null)
        .eq('done', false)
        .range(pageStart, pageStart + PAGE - 1)
      if (page.error) throw page.error
      const ids = ((page.data ?? []) as { id: string }[]).map((r) => r.id)
      emptyIds.push(...ids)
      if (ids.length < PAGE) break
      pageStart += PAGE
    }

    // 3. 参照されていない id だけ削除対象
    const toDelete = emptyIds.filter((id) => !referencedIds.has(id))

    // 4. 500 件ずつ batch DELETE
    const BATCH = 500
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH)
      const res = await supabase.from('cells').delete().in('id', batch)
      if (res.error) throw res.error
    }
    return { deletedCount: toDelete.length }
  } catch (e) {
    console.warn('[cleanupEmptyCellsInCloud] failed:', e)
    return { deletedCount: 0 }
  }
}
