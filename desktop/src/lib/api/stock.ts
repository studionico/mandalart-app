import { query, execute, generateId, now } from '../db'
import type { StockItem, CellSnapshot, GridSnapshot } from '../../types'
import { getChildGrids, getGrid } from './grids'

type RawStockItem = { id: string; snapshot: string; created_at: string }

export async function getStockItems(): Promise<StockItem[]> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items ORDER BY created_at DESC')
  return rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot), user_id: '' }))
}

export async function addToStock(cellId: string): Promise<StockItem> {
  const { db: _db, ...cellData } = await buildSnapshot(cellId)
  const id = generateId()
  const ts = now()
  const snapshot = JSON.stringify(cellData)
  await execute('INSERT INTO stock_items (id, snapshot, created_at) VALUES (?, ?, ?)', [id, snapshot, ts])
  return { id, snapshot: cellData, created_at: ts, user_id: '' }
}

export async function deleteStockItem(id: string): Promise<void> {
  await execute('DELETE FROM stock_items WHERE id = ?', [id])
}

export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items WHERE id = ?', [stockItemId])
  if (!rows[0]) return
  const snapshot: CellSnapshot = JSON.parse(rows[0].snapshot)
  const { updateCell } = await import('./cells')
  await updateCell(targetCellId, {
    text: snapshot.cell.text,
    image_path: snapshot.cell.image_path,
    color: snapshot.cell.color,
  })
}

async function buildSnapshot(cellId: string): Promise<{ db: null } & CellSnapshot> {
  const cells = await query<{ id: string; text: string; image_path: string | null; color: string | null }>(
    'SELECT id, text, image_path, color FROM cells WHERE id = ?', [cellId]
  )
  const c = cells[0]
  const childGrids = await getChildGrids(cellId)
  const children = await Promise.all(
    childGrids.map(async (g) => {
      const full = await getGrid(g.id)
      return {
        grid: { memo: g.memo, sort_order: g.sort_order },
        cells: full.cells,
        children: [] as GridSnapshot[],
      }
    })
  )
  return {
    db: null,
    cell: { text: c.text, image_path: c.image_path, color: c.color },
    children,
  }
}
