import { createClient } from '@/lib/supabase/client'
import type { StockItem, CellSnapshot, Cell, Grid } from '@/types'

export async function getStockItems(): Promise<StockItem[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as StockItem[]
}

async function buildCellSnapshot(cellId: string): Promise<CellSnapshot> {
  const supabase = createClient()

  const { data: cell } = await supabase.from('cells').select('*').eq('id', cellId).single()
  if (!cell) throw new Error('Cell not found')

  const childGrids = await buildChildGridSnapshots(cellId)

  return {
    cell: { text: cell.text, image_path: cell.image_path, color: cell.color },
    children: childGrids,
  }
}

type GridSnapshotItem = { grid: { sort_order: number; memo: string | null }; cells: { position: number; text: string; image_path: string | null; color: string | null }[]; children: GridSnapshotItem[] }

async function buildChildGridSnapshots(cellId: string): Promise<GridSnapshotItem[]> {
  const supabase = createClient()
  const { data: grids } = await supabase
    .from('grids')
    .select('*, cells(*)')
    .eq('parent_cell_id', cellId)
    .order('sort_order')
  if (!grids || grids.length === 0) return []

  const result = []
  for (const g of grids) {
    const cellSnapshots = []
    for (const c of (g.cells as Cell[])) {
      const grandChildren = await buildChildGridSnapshots(c.id)
      cellSnapshots.push({ position: c.position, text: c.text, image_path: c.image_path, color: c.color })
    }
    const children = []
    for (const c of (g.cells as Cell[])) {
      children.push(...(await buildChildGridSnapshots(c.id)))
    }
    result.push({
      grid: { sort_order: g.sort_order, memo: g.memo },
      cells: (g.cells as Cell[]).map((c) => ({ position: c.position, text: c.text, image_path: c.image_path, color: c.color })),
      children,
    })
  }
  return result
}

export async function addToStock(cellId: string): Promise<StockItem> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const snapshot = await buildCellSnapshot(cellId)

  const { data, error } = await supabase
    .from('stock_items')
    .insert({ user_id: user.id, snapshot })
    .select()
    .single()
  if (error) throw error
  return data as StockItem
}

export async function deleteStockItem(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('stock_items').delete().eq('id', id)
  if (error) throw error
}

export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const supabase = createClient()
  const { data: item } = await supabase.from('stock_items').select('*').eq('id', stockItemId).single()
  if (!item) throw new Error('Stock item not found')

  const snapshot = item.snapshot as CellSnapshot

  // ターゲットセルに内容を書き込み
  await supabase.from('cells').update({
    text: snapshot.cell.text,
    image_path: snapshot.cell.image_path,
    color: snapshot.cell.color,
  }).eq('id', targetCellId)

  // 子グリッドを再帰的に作成
  const { data: targetCell } = await supabase.from('cells').select('grid_id').eq('id', targetCellId).single()
  const { data: targetGrid } = await supabase.from('grids').select('mandalart_id').eq('id', targetCell!.grid_id).single()

  async function createGridFromSnapshot(snapshot: CellSnapshot['children'][number], parentCellId: string) {
    const { data: newGrid } = await supabase
      .from('grids')
      .insert({ mandalart_id: targetGrid!.mandalart_id, parent_cell_id: parentCellId, sort_order: snapshot.grid.sort_order, memo: snapshot.grid.memo })
      .select()
      .single()
    if (!newGrid) return

    const insertedCells = await supabase
      .from('cells')
      .insert(snapshot.cells.map((c) => ({ grid_id: newGrid.id, position: c.position, text: c.text, image_path: c.image_path, color: c.color })))
      .select()

    for (const child of snapshot.children) {
      const matchCell = insertedCells.data?.find((c: Cell) => c.position === child.grid.sort_order)
      if (matchCell) await createGridFromSnapshot(child, matchCell.id)
    }
  }

  for (const child of snapshot.children) {
    await createGridFromSnapshot(child, targetCellId)
  }
}
