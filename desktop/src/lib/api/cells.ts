import { query, execute, now } from '../db'
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

  // ルート中心セル (mandalarts.root_cell_id が指すセル) のテキスト更新を
  // mandalarts.title にミラーする。title はダッシュボードの表示/検索/ソートで使う。
  if (cell && params.text !== undefined) {
    const rootOwners = await query<{ id: string }>(
      'SELECT id FROM mandalarts WHERE root_cell_id = ? AND deleted_at IS NULL',
      [id],
    )
    if (rootOwners[0]) {
      await execute(
        'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
        [params.text, ts, rootOwners[0].id],
      )
    }
  }

  // 空 → 非空 への遷移 + そのセルが done=0 のとき: 新しいタスクが生まれたので、
  // 親セルの done=1 を解除して invariant を維持する。
  if (cell && wasEmpty && !isCellEmpty(cell) && Number(cell.done) !== 1) {
    await propagateUndoneUp(cell.id, ts)
  }

  return cell
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

/**
 * 2 つの cell のサブツリー (drilled 子グリッド群) を入れ替える。
 *
 * 新モデル (center_cell_id ベース):
 *  - 自グリッドの center = 自セル (= root 中心) の grid は付け替え対象外 (自己参照を壊すため)
 *  - それ以外の、cell を center として指している grid の center_cell_id を入れ替える
 */
export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  const [aInfo, bInfo] = await Promise.all([
    query<{ grid_id: string }>('SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdA]),
    query<{ grid_id: string }>('SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdB]),
  ])
  const gridIdA = aInfo[0]?.grid_id ?? ''
  const gridIdB = bInfo[0]?.grid_id ?? ''

  const gridsOfA = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
    [cellIdA, gridIdA],
  )
  const gridsOfB = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
    [cellIdB, gridIdB],
  )
  const ts = now()
  for (const g of gridsOfA) {
    await execute('UPDATE grids SET center_cell_id=?, updated_at=? WHERE id=?', [cellIdB, ts, g.id])
  }
  for (const g of gridsOfB) {
    await execute('UPDATE grids SET center_cell_id=?, updated_at=? WHERE id=?', [cellIdA, ts, g.id])
  }
  await swapCellContent(cellIdA, cellIdB)
}

/**
 * クリップボード (カット/コピー) からのペースト。
 */
export async function pasteCell(
  sourceCellId: string,
  targetCellId: string,
  mode: 'cut' | 'copy',
): Promise<void> {
  if (sourceCellId === targetCellId) return

  const targetRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [targetCellId],
  )
  const target = targetRows[0]
  if (target && target.position !== CENTER_POSITION) {
    // 新モデル: 中心セル = 所属グリッドの center_cell_id が指すセル
    const gridRow = await query<{ center_cell_id: string }>(
      'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
      [target.grid_id],
    )
    const centerId = gridRow[0]?.center_cell_id
    const centerRows = centerId
      ? await query<{ text: string; image_path: string | null }>(
          'SELECT text, image_path FROM cells WHERE id = ? AND deleted_at IS NULL',
          [centerId],
        )
      : []
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
    const sourceGridRow = await query<{ grid_id: string }>(
      'SELECT grid_id FROM cells WHERE id = ?',
      [sourceCellId],
    )
    const sourceGridId = sourceGridRow[0]?.grid_id ?? ''
    const childGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
      [sourceCellId, sourceGridId],
    )
    for (const cg of childGrids) {
      const { deleteGrid } = await import('./grids')
      await deleteGrid(cg.id)
    }
  }
}

/**
 * source のサブツリー (drilled 子グリッド群) + content を target に複製する。
 */
export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const srcs = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [sourceCellId],
  )
  const src = srcs[0]
  if (!src) return

  // 新モデル: source cell を center として指しているすべての grid を複製。
  // peripheral なら drilled grids のみ、center (root center 等) なら自グリッドも含まれ、
  // "grid 全体を subtree として複製する" 旧挙動を自然に再現する。
  const centeringGrids = await query<{ id: string; sort_order: number }>(
    'SELECT id, sort_order FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
    [sourceCellId],
  )
  for (const cg of centeringGrids) {
    await copyGridRecursive(cg.id, targetCellId, cg.sort_order)
  }

  // target に source の content を上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [src.text, src.image_path, src.color, now(), targetCellId]
  )
}

/**
 * sourceGridId のサブツリーを複製し、新しいグリッドの中心を newCenterCellId にする。
 *
 * - 新グリッド G' は 8 peripherals のみ INSERT (center は newCenterCellId の既存 cell)
 * - source 側の center cell (旧 G.center) の content は複製せず skip:
 *   target cell = newCenterCellId が既に content を持っているか、
 *   呼び出し側 (copyCellSubtree) が src の content を後で target に上書きする
 * - 各 source cell の子グリッドを再帰的に複製
 *
 * ⚠ 子グリッド検索は NG を insert する**前**に snapshot する必要がある。後付けで query すると、
 * 「中心セル C を同一グリッド G 内の周辺セル P にドロップ」のような操作で、sc = P の反復時に
 * 今さっき挿入した NG (center_cell_id = P.id) 自身が「P の子グリッド」として hit して
 * 無限再帰 (NG → NG2 → NG3 ...) が発生する。
 */
async function copyGridRecursive(
  sourceGridId: string,
  newCenterCellId: string,
  sortOrder: number,
): Promise<string> {
  const { generateId } = await import('../db')
  const gridRows = await query<{ mandalart_id: string; memo: string | null; center_cell_id: string }>(
    'SELECT mandalart_id, memo, center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [sourceGridId],
  )
  const sg = gridRows[0]
  if (!sg) return ''

  // getGrid で center merged な 9 cells を取得 (root grid なら 9、child grid でも 9)
  const { getGrid } = await import('./grids')
  const sourceGrid = await getGrid(sourceGridId)
  const sourceCenterId = sg.center_cell_id

  // NG 作成前に snapshot: 各 source cell が現時点で持つ child grids を固定する。
  // こうしないと NG 挿入後の query で NG 自身を誤って "P の子グリッド" と認識して無限再帰する。
  const childGridsBySourceCellId = new Map<string, Array<{ id: string; sort_order: number }>>()
  for (const sc of sourceGrid.cells) {
    const childGrids = await query<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
      [sc.id, sourceGridId],
    )
    childGridsBySourceCellId.set(sc.id, childGrids)
  }

  const newGridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [newGridId, sg.mandalart_id, newCenterCellId, sortOrder, sg.memo, ts, ts],
  )

  // source cell id → new cell id のマッピング
  const cellIdMap = new Map<string, string>()
  cellIdMap.set(sourceCenterId, newCenterCellId)

  // 8 peripherals (source の center は skip)
  for (const sc of sourceGrid.cells) {
    if (sc.id === sourceCenterId) continue
    const newCellId = generateId()
    cellIdMap.set(sc.id, newCellId)
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [newCellId, newGridId, sc.position, sc.text, sc.image_path, sc.color, sc.done ? 1 : 0, ts, ts],
    )
  }

  // 各 source cell の drilled grids を再帰コピー (snapshot を参照)
  for (const sc of sourceGrid.cells) {
    const childGrids = childGridsBySourceCellId.get(sc.id) ?? []
    const newParentCellId = cellIdMap.get(sc.id)!
    for (const cg of childGrids) {
      await copyGridRecursive(cg.id, newParentCellId, cg.sort_order)
    }
  }
  return newGridId
}

// ---------------------------------------------------------------------------
// チェックボックス (done) 関連
// ---------------------------------------------------------------------------

/**
 * 指定 grid の非空セルの done 状態を一括設定する (子グリッドへの再帰はしない)。
 * 新モデル: child grid は 8 cells (center 行なし) なので、この UPDATE は peripherals のみ対象。
 * root grid は 9 cells なので center も含まれる。
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
 * 新モデル (center_cell_id ベース) のツリー:
 *  - Cell C の子 = すべての grid g (WHERE g.center_cell_id = C.id) の peripheral cells
 *  - Cell C の親 = C.grid_id の grid の center_cell (自分自身なら親なし = root 中心)
 *
 * (旧モデルの「中心/周辺」二分岐は廃止 — 新モデルでは peripheral と center の役割が
 *  同じ cell で両立し、ツリー操作は一般化できる)
 */
export async function toggleCellDone(cellId: string): Promise<void> {
  const cells = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellId])
  const cell = cells[0]
  if (!cell) return
  const nextDone: 0 | 1 = Number(cell.done) === 1 ? 0 : 1
  const ts = now()

  await markSubtreeDone(cellId, nextDone, ts)

  if (nextDone === 1) {
    await propagateDoneUp(cellId, ts)
  } else {
    await propagateUndoneUp(cellId, ts)
  }
}

/**
 * 指定セルのサブツリー全体 (自身 + 子孫) を done に設定する。
 * 空セルは done 更新の対象外 (= skip) だが、再帰対象にはしない。
 */
async function markSubtreeDone(cellId: string, done: 0 | 1, ts: string): Promise<void> {
  // 自身
  await execute(
    `UPDATE cells SET done = ?, updated_at = ?
     WHERE id = ? AND done != ?
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [done, ts, cellId, done],
  )
  // この cell を center とする grid 群の peripherals に再帰
  const centeringGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of centeringGrids) {
    const peripherals = await query<{ id: string }>(
      `SELECT id FROM cells WHERE grid_id = ? AND id != ? AND deleted_at IS NULL
         AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
      [g.id, cellId],
    )
    for (const p of peripherals) {
      await markSubtreeDone(p.id, done, ts)
    }
  }
}

/**
 * ツリー上の親セルを取得する。
 *  - 自グリッドの center_cell_id が自 cell と同じなら root 中心 → 親なし
 *  - それ以外は自グリッドの center cell が親
 */
async function getParentCellInTree(cellId: string): Promise<{ id: string } | null> {
  const cellRows = await query<{ grid_id: string }>(
    'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cellRows[0]
  if (!cell) return null
  const grids = await query<{ center_cell_id: string }>(
    'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [cell.grid_id],
  )
  const centerCellId = grids[0]?.center_cell_id
  if (!centerCellId || centerCellId === cellId) return null
  return { id: centerCellId }
}

/**
 * 指定セルの子孫 (= 自身を除く配下すべて) が全て done=1 か判定する。
 * 空セルは「タスクではない」として判定から除外する (= done 扱い)。
 */
async function areDescendantsAllDone(cellId: string): Promise<boolean> {
  const centeringGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of centeringGrids) {
    const peripherals = await query<{ id: string; done: number; text: string; image_path: string | null }>(
      `SELECT id, done, text, image_path FROM cells WHERE grid_id = ? AND id != ? AND deleted_at IS NULL`,
      [g.id, cellId],
    )
    for (const p of peripherals) {
      if (isCellEmpty(p)) continue
      if (Number(p.done) !== 1) return false
      if (!(await areDescendantsAllDone(p.id))) return false
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
