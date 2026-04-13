import { query, execute, generateId, now } from '../db'
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
 * - セル内容（text / image_path / color）を上書き
 * - スナップショットに含まれる子グリッドを再帰的に複製して target の子として追加
 * - 既存の target 子グリッドは削除しない（後続の並列グリッドとして追加される）
 */
export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items WHERE id = ?', [stockItemId])
  if (!rows[0]) return
  const snapshot: CellSnapshot = JSON.parse(rows[0].snapshot)

  // ターゲットの所属マンダラート ID を取得
  const targetCells = await query<{ grid_id: string }>(
    'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL', [targetCellId]
  )
  const targetGrid = targetCells[0]
  if (!targetGrid) return
  const grids = await query<{ mandalart_id: string }>(
    'SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL', [targetGrid.grid_id]
  )
  const mandalartId = grids[0]?.mandalart_id
  if (!mandalartId) return

  // 1) セル内容を上書き
  const ts = now()
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [snapshot.cell.text, snapshot.cell.image_path, snapshot.cell.color, ts, targetCellId],
  )

  // 2) 子グリッドを再帰的に挿入
  for (const child of snapshot.children) {
    await insertGridSnapshot(child, targetCellId, mandalartId)
  }
}

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
  for (let i = 0; i < 9; i++) {
    const c = byPos.get(i)
    const cellId = generateId()
    newCellIds.set(i, cellId)
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [cellId, gridId, i, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
  }

  // 子グリッドを各セルに紐付けて再帰挿入
  // CellSnapshot-based の children は GridSnapshot[]（対象 position が曖昧）なので
  // ここでは後方互換のため children を先頭セルの子として挿入するのではなく、
  // 同階層の並列グリッドとして parentCellId の下に並べる単純実装にとどめる。
  for (const child of snap.children) {
    await insertGridSnapshot(child, parentCellId, mandalartId)
  }
}

async function buildCellSnapshot(cellId: string): Promise<CellSnapshot> {
  const cells = await query<Pick<Cell, 'text' | 'image_path' | 'color' | 'position' | 'grid_id'>>(
    'SELECT text, image_path, color, position, grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const c = cells[0]
  if (!c) throw new Error(`Cell not found: ${cellId}`)

  const children: GridSnapshot[] = []

  if (c.position === 4) {
    const grids = await query<{ memo: string | null; sort_order: number }>(
      'SELECT memo, sort_order FROM grids WHERE id = ? AND deleted_at IS NULL',
      [c.grid_id],
    )
    if (grids[0]) {
      children.push(await buildGridSnapshot(c.grid_id, grids[0].memo, grids[0].sort_order))
    }
  } else {
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
      children.push(await buildGridSnapshot(subGrid.id, subGrid.memo, subGrid.sort_order))
    }
  }

  return {
    grid: { memo, sort_order: sortOrder },
    cells: cellSnaps,
    children,
  }
}
