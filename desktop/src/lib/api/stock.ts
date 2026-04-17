import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import type { Cell, StockItem, CellSnapshot, GridSnapshot } from '../../types'

type RawStockItem = { id: string; snapshot: string; created_at: string }

export async function getStockItems(): Promise<StockItem[]> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items ORDER BY created_at DESC')
  return rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot), user_id: '' }))
}

export async function addToStock(cellId: string): Promise<StockItem> {
  const snapshot = await buildCellSnapshot(cellId)
  const id = generateId()
  const ts = now()
  await execute(
    'INSERT INTO stock_items (id, snapshot, created_at) VALUES (?, ?, ?)',
    [id, JSON.stringify(snapshot), ts],
  )
  return { id, snapshot, created_at: ts, user_id: '' }
}

export async function deleteStockItem(id: string): Promise<void> {
  await execute('DELETE FROM stock_items WHERE id = ?', [id])
}

/**
 * ストックアイテムをセルにペースト。
 *
 * - **周辺セル snapshot** (position !== 4): セル内容を上書き + children を
 *   ターゲットの子グリッドとして再帰挿入
 * - **中心セル snapshot** (position === 4): セル内容を上書き + children[0] の
 *   GridSnapshot をターゲットの所属グリッドに「展開」する (= 周辺セル 8 つの
 *   内容を上書き + 各セルの子グリッドを再帰挿入)
 *
 * ストックアイテムは消費されない (何度でもペースト可能)。
 */
export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items WHERE id = ?', [stockItemId])
  if (!rows[0]) return
  const snapshot: CellSnapshot = JSON.parse(rows[0].snapshot)

  const targetCells = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL', [targetCellId],
  )
  const targetCell = targetCells[0]
  if (!targetCell) return

  // 防御チェック: 周辺セルなのに中心セルが空ならペースト不可
  if (targetCell.position !== CENTER_POSITION) {
    const centerRows = await query<{ text: string; image_path: string | null }>(
      'SELECT text, image_path FROM cells WHERE grid_id = ? AND position = ? AND deleted_at IS NULL',
      [targetCell.grid_id, CENTER_POSITION],
    )
    const center = centerRows[0]
    if (!center || (center.text.trim() === '' && center.image_path === null)) {
      throw new Error('中心セルが空のグリッドの周辺セルにはペーストできません')
    }
  }

  const grids = await query<{ mandalart_id: string }>(
    'SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL', [targetCell.grid_id],
  )
  const mandalartId = grids[0]?.mandalart_id
  if (!mandalartId) return

  const ts = now()

  // 1) ターゲットセル内容を上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [snapshot.cell.text, snapshot.cell.image_path, snapshot.cell.color, ts, targetCellId],
  )

  // 2) 中心セル snapshot を検出する。
  //    新形式: snapshot.position === CENTER_POSITION
  //    旧形式 (position 未設定): children が 1 つの GridSnapshot で、その中に
  //    CENTER_POSITION セルが存在し snapshot.cell.text と一致する場合は中心セル snapshot と判定
  const isCenterSnapshot = snapshot.position === CENTER_POSITION
    || (snapshot.position === undefined
      && snapshot.children.length === 1
      && snapshot.children[0].cells.some(
        (c) => c.position === CENTER_POSITION && c.text === snapshot.cell.text,
      ))

  // 3) 中心セル snapshot かつターゲットも中心セル → グリッド展開
  //    (周辺 8 セルの内容を既存グリッドに上書き + 子グリッドを正しいセルに紐付け)
  //    ターゲットが周辺セルの場合は展開しない — 子グリッドとして挿入する (下の分岐)
  if (isCenterSnapshot && targetCell.position === CENTER_POSITION && snapshot.children.length > 0) {
    const gridSnap = snapshot.children[0]
    await expandGridSnapshotInto(gridSnap, targetCell.grid_id, mandalartId)
    return
  }

  // 4) それ以外: children を子グリッドとしてターゲットセル配下に再帰挿入
  for (const child of snapshot.children) {
    await insertGridSnapshot(child, targetCellId, mandalartId)
  }
}

/**
 * 中心セル snapshot のグリッド展開。
 * GridSnapshot の内容 (周辺セル 8 つ + 各セルの子グリッド) を、既存グリッドの
 * セルに上書きする。ターゲット中心セルの内容は既に pasteFromStock 側で更新済み。
 */
async function expandGridSnapshotInto(
  gridSnap: GridSnapshot,
  targetGridId: string,
  mandalartId: string,
): Promise<void> {
  const ts = now()

  // ターゲットグリッドの既存セルを取得
  const existingCells = await query<{ id: string; position: number }>(
    'SELECT id, position FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [targetGridId],
  )
  const cellIdByPos = new Map(existingCells.map((c) => [c.position, c.id]))

  // snapshot の周辺セル内容で既存セルを上書き (中心セルは既に更新済みなのでスキップ)
  const snapByPos = new Map(gridSnap.cells.map((c) => [c.position, c]))
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    if (pos === CENTER_POSITION) continue
    const existingId = cellIdByPos.get(pos)
    if (!existingId) continue
    const sc = snapByPos.get(pos)
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [sc?.text ?? '', sc?.image_path ?? null, sc?.color ?? null, ts, existingId],
    )
  }

  // snapshot の子グリッドを parentPosition に従って正しいセルに紐付け
  for (const child of gridSnap.children) {
    const parentPos = child.parentPosition
    const parentCellId = parentPos !== undefined ? cellIdByPos.get(parentPos) : null
    if (parentCellId) {
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

/**
 * GridSnapshot を新しいグリッドとして DB に挿入する (再帰)。
 * 各子グリッドは parentPosition を見て、新しく作ったセルの正しい ID に紐付ける。
 */
async function insertGridSnapshot(
  snap: GridSnapshot,
  parentCellId: string,
  mandalartId: string,
): Promise<void> {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [gridId, mandalartId, parentCellId, snap.grid.sort_order, snap.grid.memo, ts, ts],
  )

  // セル 0〜8 を挿入（スナップショット内に存在しない position は空セル）
  const byPos = new Map(snap.cells.map((c) => [c.position, c]))
  const newCellIds = new Map<number, string>()
  for (let i = 0; i < GRID_CELL_COUNT; i++) {
    const c = byPos.get(i)
    const cellId = generateId()
    newCellIds.set(i, cellId)
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [cellId, gridId, i, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
  }

  // 子グリッドを parentPosition に従って正しいセルに紐付けて再帰挿入
  for (const child of snap.children) {
    const parentPos = child.parentPosition
    if (parentPos !== undefined) {
      const cellId = newCellIds.get(parentPos)
      if (cellId) {
        await insertGridSnapshot(child, cellId, mandalartId)
      }
    } else {
      // parentPosition 未設定 = 並列グリッド (parentCellId と同じ親)
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

// ── snapshot 構築 ──

async function buildCellSnapshot(cellId: string): Promise<CellSnapshot> {
  const cells = await query<Pick<Cell, 'text' | 'image_path' | 'color' | 'position' | 'grid_id'>>(
    'SELECT text, image_path, color, position, grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const c = cells[0]
  if (!c) throw new Error(`Cell not found: ${cellId}`)

  const children: GridSnapshot[] = []

  if (c.position === CENTER_POSITION) {
    // 中心セル: 所属グリッド全体 (8 周辺セル + 全サブツリー) をスナップショット
    const grids = await query<{ memo: string | null; sort_order: number }>(
      'SELECT memo, sort_order FROM grids WHERE id = ? AND deleted_at IS NULL',
      [c.grid_id],
    )
    if (grids[0]) {
      children.push(await buildGridSnapshot(c.grid_id, grids[0].memo, grids[0].sort_order))
    }
  } else {
    // 周辺セル: そのセルの子グリッド群をスナップショット
    const childGrids = await query<{ id: string; memo: string | null; sort_order: number }>(
      'SELECT id, memo, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
      [cellId],
    )
    for (const g of childGrids) {
      children.push(await buildGridSnapshot(g.id, g.memo, g.sort_order))
    }
  }

  return {
    cell: { text: c.text, image_path: c.image_path, color: c.color },
    position: c.position,
    children,
  }
}

async function buildGridSnapshot(
  gridId: string,
  memo: string | null,
  sortOrder: number,
): Promise<GridSnapshot> {
  const gridCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [gridId],
  )
  const cellSnaps = gridCells.map((c) => ({
    position: c.position,
    text: c.text,
    image_path: c.image_path,
    color: c.color,
  }))

  const children: GridSnapshot[] = []
  for (const sc of gridCells) {
    const sub = await query<{ id: string; memo: string | null; sort_order: number }>(
      'SELECT id, memo, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
      [sc.id],
    )
    for (const subGrid of sub) {
      // parentPosition を設定: このサブグリッドは sc.position のセルにぶら下がる
      const childSnap = await buildGridSnapshot(subGrid.id, subGrid.memo, subGrid.sort_order)
      children.push({ ...childSnap, parentPosition: sc.position })
    }
  }

  return {
    grid: { memo, sort_order: sortOrder },
    cells: cellSnaps,
    children,
  }
}
