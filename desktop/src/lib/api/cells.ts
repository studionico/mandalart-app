import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION } from '@/constants/grid'
import { isCellEmpty } from '@/lib/utils/grid'
import type { Cell } from '../../types'

export async function updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell> {
  // 空 → 非空 への遷移を検出するため、更新前のセルを読む
  const prevRows = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [id])
  const prevCell = prevRows[0]
  const wasEmpty = prevCell ? isCellEmpty(prevCell) : false

  const fields: string[] = []
  const values: unknown[] = []
  if (params.text !== undefined) { fields.push('text = ?'); values.push(params.text) }
  if (params.image_path !== undefined) { fields.push('image_path = ?'); values.push(params.image_path) }
  if (params.color !== undefined) { fields.push('color = ?'); values.push(params.color) }
  const ts = now()
  fields.push('updated_at = ?'); values.push(ts)
  values.push(id)
  await execute(`UPDATE cells SET ${fields.join(', ')} WHERE id = ?`, values)
  const rows = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  const cell = rows[0]

  // ルートグリッド (parent_cell_id IS NULL, sort_order = 0) の中心セル (position 4)
  // が更新されたら、mandalarts.title をそのテキストにミラーする。
  // title は「ルート中心セルのキャッシュ」として扱い、
  // ダッシュボードの表示 / 検索 / ソートに使う。
  if (cell && cell.position === CENTER_POSITION && params.text !== undefined) {
    const grids = await query<{ mandalart_id: string; parent_cell_id: string | null; sort_order: number }>(
      'SELECT mandalart_id, parent_cell_id, sort_order FROM grids WHERE id = ?',
      [cell.grid_id],
    )
    const grid = grids[0]
    if (grid && grid.parent_cell_id === null && grid.sort_order === 0) {
      await execute(
        'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
        [params.text, ts, grid.mandalart_id],
      )
    }
  }

  // 空 → 非空 への遷移 + そのセルが done=0 のとき: 新しいタスクが生まれたので、
  // 親セルの done=1 を解除して invariant を維持する。
  // (drill-create の center 初期化で親の done を継承したい場合は、この path を
  // 通さず seedCellWithDone を使う)
  if (cell && wasEmpty && !isCellEmpty(cell) && Number(cell.done) !== 1) {
    await propagateUndoneUp(cell.id, ts)
  }

  return cell
}

/**
 * drill-down で新規作成した子グリッドの中心セルを、親セルの内容と done 状態で
 * 初期化する専用関数。
 *
 * updateCell は空→非空 transition 時に propagateUndoneUp を呼んで親を解除するが、
 * drill-create では「親 done を新 grid に継承する」のが正しい挙動なので、
 * この関数は propagate を行わず text + done を atomic に設定する。
 */
export async function seedCellWithDone(
  cellId: string,
  params: { text: string; image_path: string | null; color: string | null; done: boolean }
): Promise<void> {
  const ts = now()
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, done=?, updated_at=? WHERE id=?',
    [params.text, params.image_path, params.color, params.done ? 1 : 0, ts, cellId],
  )
}

export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void> {
  const [a, b] = await Promise.all([
    query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdA]),
    query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdB]),
  ])
  const ca = a[0]; const cb = b[0]
  const ts = now()
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [cb.text, cb.image_path, cb.color, ts, cellIdA])
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [ca.text, ca.image_path, ca.color, ts, cellIdB])
}

export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  // 子グリッド ID を先に取得してから付け替える（循環 FK 回避）
  const gridsOfA = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellIdA],
  )
  const gridsOfB = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellIdB],
  )
  const ts = now()
  for (const g of gridsOfA) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdB, ts, g.id])
  }
  for (const g of gridsOfB) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdA, ts, g.id])
  }
  await swapCellContent(cellIdA, cellIdB)
}

/**
 * クリップボード（カット/コピー）からのペースト。
 * copyCellSubtree で内容と子グリッドを複製し、mode='cut' のときは source を空にする。
 * cut 時の子グリッド整理はソフトデリート（deleted_at 設定）。
 */
export async function pasteCell(
  sourceCellId: string,
  targetCellId: string,
  mode: 'cut' | 'copy',
): Promise<void> {
  if (sourceCellId === targetCellId) return

  // 防御チェック: 周辺セルなのに中心セルが空ならペースト不可
  const targetRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [targetCellId],
  )
  const target = targetRows[0]
  if (target && target.position !== CENTER_POSITION) {
    const centerRows = await query<{ text: string; image_path: string | null }>(
      'SELECT text, image_path FROM cells WHERE grid_id = ? AND position = ? AND deleted_at IS NULL',
      [target.grid_id, CENTER_POSITION],
    )
    const center = centerRows[0]
    if (!center || (center.text.trim() === '' && center.image_path === null)) {
      throw new Error('中心セルが空のグリッドの周辺セルにはペーストできません')
    }
  }

  await copyCellSubtree(sourceCellId, targetCellId)

  if (mode === 'cut') {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      ['', null, null, ts, sourceCellId],
    )
    // source の子グリッドを再帰的に論理削除
    const childGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
      [sourceCellId],
    )
    for (const cg of childGrids) {
      const { deleteGrid } = await import('./grids')
      await deleteGrid(cg.id)
    }
  }
}

export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const srcs = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [sourceCellId],
  )
  const src = srcs[0]
  if (!src) return

  // 1) ソース側の子グリッドを複製（ターゲット更新より前に実行して
  //    スナップショットがターゲットの空状態を含むようにする）
  const childGrids = await query<{ id: string; sort_order: number }>(
    'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [sourceCellId],
  )
  for (const cg of childGrids) {
    await copyGridRecursive(cg.id, targetCellId, cg.sort_order)
  }

  // 2) 中心セルで子グリッドを持たない場合、
  //    「その中心セルがテーマとしているグリッド自体」を subtree として複製する。
  if (src.position === CENTER_POSITION && childGrids.length === 0) {
    await copyGridRecursive(src.grid_id, targetCellId, 0)
  }

  // 3) 最後にターゲットのコンテンツを上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [src.text, src.image_path, src.color, now(), targetCellId]
  )
}

async function copyGridRecursive(
  sourceGridId: string,
  newParentCellId: string,
  sortOrder: number
): Promise<string> {
  // ソース側の状態を INSERT 前にスナップショットする。
  const grids = await query<{ mandalart_id: string; memo: string | null }>(
    'SELECT mandalart_id, memo FROM grids WHERE id = ? AND deleted_at IS NULL',
    [sourceGridId],
  )
  const sg = grids[0]
  const sourceCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [sourceGridId],
  )
  const childGridsPerCell = new Map<string, { id: string; sort_order: number }[]>()
  for (const sc of sourceCells) {
    const cgs = await query<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
      [sc.id],
    )
    childGridsPerCell.set(sc.id, cgs)
  }

  // 新しいグリッドとセルを挿入
  const newGridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [newGridId, sg.mandalart_id, newParentCellId, sortOrder, sg.memo, ts, ts]
  )
  for (const sc of sourceCells) {
    const newCellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, sc.position, sc.text, sc.image_path, sc.color, ts, ts]
    )
    const cgs = childGridsPerCell.get(sc.id) ?? []
    for (const cg of cgs) {
      await copyGridRecursive(cg.id, newCellId, cg.sort_order)
    }
  }
  return newGridId
}

// ---------------------------------------------------------------------------
// チェックボックス (done) 関連
// ---------------------------------------------------------------------------

/**
 * 指定 grid の非空セルの done 状態を一括設定する (子グリッドへの再帰はしない)。
 * drill-down で新規サブグリッドを作った時に、親セルが done なら子グリッドの
 * 非空セル (= 中央セル: 親テキストをコピー済) だけ done で初期化する。
 * 空の周辺セルは「タスクではない」として触らず done=0 のまま残す。
 */
export async function setGridDone(gridId: string, done: boolean): Promise<void> {
  const ts = now()
  const flag = done ? 1 : 0
  await execute(
    `UPDATE cells SET done = ?, updated_at = ?
     WHERE grid_id = ? AND deleted_at IS NULL AND done != ?
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [flag, ts, gridId, flag],
  )
}

/**
 * セルの done 状態をトグルし、階層全体にカスケード適用する。
 *
 * マンダラートの階層ツリーの親子関係 (zigzag):
 *  - 周辺セル P (grid G) の「親」 = G の中心セル
 *  - 中心セル C (grid G) の「親」 = G.parent_cell_id (祖父 grid の周辺セル)、
 *                                    ルートグリッドの中心なら親なし
 *
 * 「サブツリー」:
 *  - 中心セル C のサブツリー = C が属する grid の全セル + 各周辺の子グリッドのサブツリー
 *    (中心セルが grid 全体の代表という semantic — stock.ts の buildCellSnapshot と同じ)
 *  - 周辺セル P のサブツリー = P + P の子グリッド (あれば) の全セル + その中の周辺の子グリッドのサブツリー
 *
 * トグル方向による挙動 (対称):
 *  - **チェック (0 → 1)**: セル自身のサブツリーを全部 done=1、
 *    親方向にも「サブツリー全 done なら親も done=1」を再帰的に伝搬
 *  - **アンチェック (1 → 0)**: セル自身のサブツリーを全部 done=0、
 *    親方向にも「done なら done=0」を再帰的に伝搬 (invariant 維持)
 *
 * updated_at を進めて sync 対象化する。
 */
export async function toggleCellDone(cellId: string): Promise<void> {
  const cells = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellId])
  const cell = cells[0]
  if (!cell) return
  const nextDone = Number(cell.done) === 1 ? 0 : 1
  const ts = now()

  // サブツリー全体を done に (チェック/アンチェック どちらも同じ方向の更新)
  await markSubtreeDone(cellId, nextDone, ts)

  // 親方向への伝搬
  if (nextDone === 1) {
    await propagateDoneUp(cellId, ts)
  } else {
    await propagateUndoneUp(cellId, ts)
  }
}

/**
 * 指定セルのサブツリー全体を done に設定する。中心セルと周辺セルで subtree の
 * 定義が異なる (doc 参照)。done は 0 or 1。更新があった行のみ updated_at を進める。
 */
async function markSubtreeDone(cellId: string, done: 0 | 1, ts: string): Promise<void> {
  const cellRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cellRows[0]
  if (!cell) return

  if (cell.position === CENTER_POSITION) {
    // 中心セル: 所属グリッド全体 + 周辺の子グリッドのサブツリー
    await markGridSubtreeDone(cell.grid_id, done, ts)
  } else {
    // 周辺セル: 自身 + 子グリッドのサブツリー
    await execute(
      'UPDATE cells SET done = ?, updated_at = ? WHERE id = ? AND done != ?',
      [done, ts, cellId, done],
    )
    const childGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
      [cellId],
    )
    for (const g of childGrids) {
      await markGridSubtreeDone(g.id, done, ts)
    }
  }
}

/**
 * 指定 grid の **非空** セルを done に設定し、非空の周辺セルの子グリッドを再帰処理。
 *
 * 空セルを意図的にスキップする理由:
 *  - 空セルは「タスクではない」ので done 状態を持たない
 *  - ユーザーが後から空セルに入力した時、done=0 のままなので「新しいタスク (未完了)」
 *    として checkbox が未チェック表示される (期待挙動)
 *  - up-cascade 判定側 (areDescendantsAllDone) も空セルを無視するので対称性が保たれる
 */
async function markGridSubtreeDone(gridId: string, done: 0 | 1, ts: string): Promise<void> {
  await execute(
    `UPDATE cells SET done = ?, updated_at = ?
     WHERE grid_id = ? AND deleted_at IS NULL AND done != ?
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [done, ts, gridId, done],
  )
  const peripheralCells = await query<{ id: string }>(
    `SELECT id FROM cells WHERE grid_id = ? AND position != ? AND deleted_at IS NULL
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [gridId, CENTER_POSITION],
  )
  for (const c of peripheralCells) {
    const childGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
      [c.id],
    )
    for (const g of childGrids) {
      await markGridSubtreeDone(g.id, done, ts)
    }
  }
}

/**
 * ツリー上の親セル (zigzag) を取得する。
 *  - 周辺セル → 同じ grid の中心セル
 *  - 中心セル → 所属 grid の parent_cell (祖父 grid の周辺セル)、ルートなら null
 */
async function getParentCellInTree(
  cellId: string,
): Promise<{ id: string; grid_id: string; position: number } | null> {
  const cellRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cellRows[0]
  if (!cell) return null

  if (cell.position !== CENTER_POSITION) {
    // 周辺セル → 同グリッドの中心セル
    const centers = await query<{ id: string; grid_id: string; position: number }>(
      'SELECT id, grid_id, position FROM cells WHERE grid_id = ? AND position = ? AND deleted_at IS NULL',
      [cell.grid_id, CENTER_POSITION],
    )
    return centers[0] ?? null
  }
  // 中心セル → 所属 grid の parent_cell (なければ null)
  const grids = await query<{ parent_cell_id: string | null }>(
    'SELECT parent_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [cell.grid_id],
  )
  const parentCellId = grids[0]?.parent_cell_id
  if (!parentCellId) return null
  const parents = await query<{ id: string; grid_id: string; position: number }>(
    'SELECT id, grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [parentCellId],
  )
  return parents[0] ?? null
}

/**
 * 指定セルの「子孫」(= 自身を除く配下すべて) が全て done=1 か判定する。
 * これを使うことで「このセルを done=1 にマークしても invariant が崩れないか」を
 * propagateDoneUp のループで調べる。
 *
 * ツリー上の子孫定義:
 *  - 中心セル C (grid G) の子孫 = G の 8 周辺 + それぞれの周辺の子孫
 *  - 周辺セル P の子孫 = P の子グリッド (あれば) の中央セルと 8 周辺 + その子孫
 */
async function areDescendantsAllDone(cellId: string): Promise<boolean> {
  const cellRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cellRows[0]
  if (!cell) return false

  // 空セルは「タスクではない」として判定から除外する (= done 扱い)。
  // これにより空の周辺セルが多数あっても、入力ある兄弟が全 done なら親も done 判定される。
  if (cell.position === CENTER_POSITION) {
    // 中心セルの子孫 = 同じ grid の周辺セル (空は無視) + それぞれの子孫
    const peripherals = await query<{ id: string; done: number; text: string; image_path: string | null }>(
      'SELECT id, done, text, image_path FROM cells WHERE grid_id = ? AND position != ? AND deleted_at IS NULL',
      [cell.grid_id, CENTER_POSITION],
    )
    for (const p of peripherals) {
      if (isCellEmpty(p)) continue
      if (Number(p.done) !== 1) return false
      if (!(await areDescendantsAllDone(p.id))) return false
    }
    return true
  }
  // 周辺セルの子孫 = 子グリッド (あれば) の全セル (空は無視) + それぞれの子孫
  const childGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of childGrids) {
    const gridCells = await query<{ id: string; position: number; done: number; text: string; image_path: string | null }>(
      'SELECT id, position, done, text, image_path FROM cells WHERE grid_id = ? AND deleted_at IS NULL',
      [g.id],
    )
    for (const c of gridCells) {
      if (isCellEmpty(c)) continue
      if (Number(c.done) !== 1) return false
    }
    // 各周辺セルの子グリッドも再帰 (空セルは飛ばす)
    for (const c of gridCells) {
      if (c.position === CENTER_POSITION) continue
      if (isCellEmpty(c)) continue
      if (!(await areDescendantsAllDone(c.id))) return false
    }
  }
  return true
}

/**
 * セルの done=1 を受けて親方向へ伝搬。
 * 親のすべての子孫が done=1 (= 親を done にしても invariant OK) なら親も done=1。
 */
async function propagateDoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  if (!(await areDescendantsAllDone(parent.id))) return
  await execute(
    'UPDATE cells SET done = 1, updated_at = ? WHERE id = ? AND done = 0',
    [ts, parent.id],
  )
  await propagateDoneUp(parent.id, ts)
}

/** セルの done=0 を受けて親方向へ伝搬: 親が done=1 なら done=0 に解除し再帰。 */
async function propagateUndoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  const parentDone = await query<{ done: number }>(
    'SELECT done FROM cells WHERE id = ? AND deleted_at IS NULL',
    [parent.id],
  )
  if (!parentDone[0] || Number(parentDone[0].done) !== 1) return
  await execute(
    'UPDATE cells SET done = 0, updated_at = ? WHERE id = ?',
    [ts, parent.id],
  )
  await propagateUndoneUp(parent.id, ts)
}
