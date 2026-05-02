import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION } from '@/constants/grid'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { syncAwareDelete } from './_softDelete'
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
 * 指定 gridId から root までの ancestry を返す (root が先頭、leaf=引数 gridId が末尾)。
 *
 * 用途: ダッシュボードからマンダラート再オープン時に `mandalarts.last_grid_id` を読んで
 * 復元するときに、breadcrumb を「全段一括 set」するための材料を取る。
 *
 * - parent_cell_id を辿って、その cell が属する `grid_id` を逆引きしながら遡る
 * - 途中で grid / cell が見つからない (削除済み等の stale 参照) 場合は null を返す → 呼出側で
 *   root にフォールバック + DB 側の last_grid_id を null に戻す cleanup を行う
 * - 循環参照は理論上起きないが防衛的に Set で検出して null 返却
 */
export async function getGridAncestry(
  gridId: string,
): Promise<Array<Grid & { cells: Cell[] }> | null> {
  const ancestry: Array<Grid & { cells: Cell[] }> = []
  const seen = new Set<string>()
  let currentId: string | null = gridId
  while (currentId) {
    if (seen.has(currentId)) return null
    seen.add(currentId)
    let grid: (Grid & { cells: Cell[] }) | null
    try {
      grid = await getGrid(currentId)
    } catch {
      return null
    }
    if (!grid) return null
    ancestry.unshift(grid)
    if (!grid.parent_cell_id) break  // root 到達
    const rows = await query<{ grid_id: string }>(
      'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
      [grid.parent_cell_id],
    )
    const parentGridId = rows[0]?.grid_id
    if (!parentGridId) return null  // parent_cell_id が指す cell が消えている
    currentId = parentGridId
  }
  return ancestry
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
  // 自 grid 所属の cells → grid 本体の順で sync-aware delete (落とし穴 #12 対策)
  await syncAwareDelete('cells', 'grid_id = ?', [id], ts)
  await syncAwareDelete('grids', 'id = ?', [id], ts)
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<void> {
  await execute('UPDATE grids SET sort_order = ?, updated_at = ? WHERE id = ?', [sortOrder, now(), id])
}

/**
 * grid を物理削除する (local + cloud)。
 *
 * 用途: 自動掃除 (`cleanupGridIfEmpty`) のように「復元の意図がない削除」で使う。
 * `deleteGrid` の soft-delete では cloud に `deleted_at` 付き行が永続的に残り、
 * grid 単位の restore UI が存在しないまま storage を食い続けるため。
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
