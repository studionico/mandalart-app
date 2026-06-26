import { supabase } from '../supabase/client'
import { generateId, now } from '@/lib/utils/id'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import { deleteGrid } from './grids'
import { shredCellSubtree } from './cells'
import type { Cell, StockItem, CellSnapshot, GridSnapshot } from '../../types'

function synced(): string {
  return now()
}

export async function getStockItems(): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as { id: string; snapshot: string; created_at: string }[]).map((r) => ({
    ...r,
    snapshot: JSON.parse(r.snapshot) as CellSnapshot,
    user_id: '',
  }))
}

export async function addToStock(cellId: string): Promise<StockItem> {
  const snapshot = await buildCellSnapshot(cellId)
  const id = generateId()
  const ts = now()
  const s = synced()
  const { error } = await supabase.from('stock_items').insert({
    id, snapshot: JSON.stringify(snapshot), created_at: ts, synced_at: s,
  })
  if (error) throw error
  return { id, snapshot, created_at: ts, user_id: '' }
}

export async function deleteStockItem(id: string): Promise<void> {
  await supabase.from('stock_items').delete().eq('id', id)
}

export async function moveCellToStock(cellId: string): Promise<StockItem> {
  const item = await addToStock(cellId)
  await shredCellSubtree(cellId)
  return item
}

export async function pasteFromStockReplacing(stockItemId: string, targetCellId: string): Promise<void> {
  const { data } = await supabase.from('stock_items').select('snapshot').eq('id', stockItemId).maybeSingle()
  if (!data) return
  const snapshot: CellSnapshot = JSON.parse((data as { snapshot: string }).snapshot)
  await pasteSnapshotReplacing(snapshot, targetCellId)
}

export async function pasteSnapshotReplacing(snapshot: CellSnapshot, targetCellId: string): Promise<void> {
  const { data: subGridsData } = await supabase
    .from('grids')
    .select('id')
    .eq('parent_cell_id', targetCellId)
    .is('deleted_at', null)
  for (const g of ((subGridsData ?? []) as { id: string }[])) {
    await deleteGrid(g.id)
  }
  await pasteSnapshot(snapshot, targetCellId)
}

export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const { data } = await supabase.from('stock_items').select('snapshot').eq('id', stockItemId).maybeSingle()
  if (!data) return
  const snapshot: CellSnapshot = JSON.parse((data as { snapshot: string }).snapshot)
  await pasteSnapshot(snapshot, targetCellId)
}

export async function pasteSnapshot(snapshot: CellSnapshot, targetCellId: string): Promise<void> {
  const { data: targetData } = await supabase
    .from('cells')
    .select('grid_id, position')
    .eq('id', targetCellId)
    .is('deleted_at', null)
    .maybeSingle()
  const targetCell = targetData as { grid_id: string; position: number } | null
  if (!targetCell) return

  if (targetCell.position !== CENTER_POSITION) {
    const { data: gridRow } = await supabase.from('grids').select('center_cell_id').eq('id', targetCell.grid_id).is('deleted_at', null).maybeSingle()
    const centerId = (gridRow as { center_cell_id: string } | null)?.center_cell_id
    if (centerId) {
      const { data: centerData } = await supabase.from('cells').select('text, image_path').eq('id', centerId).is('deleted_at', null).maybeSingle()
      const center = centerData as { text: string; image_path: string | null } | null
      if (!center || (center.text.trim() === '' && center.image_path === null)) {
        throw new Error('中心セルが空のグリッドの周辺セルにはペーストできません')
      }
    }
  }

  const { data: gridData } = await supabase.from('grids').select('mandalart_id').eq('id', targetCell.grid_id).is('deleted_at', null).maybeSingle()
  const mandalartId = (gridData as { mandalart_id: string } | null)?.mandalart_id
  if (!mandalartId) return

  const ts = now()
  await supabase.from('cells').update({ text: snapshot.cell.text, image_path: snapshot.cell.image_path, color: snapshot.cell.color, updated_at: ts, synced_at: ts }).eq('id', targetCellId)

  const { data: rootOwner } = await supabase.from('mandalarts').select('id').eq('root_cell_id', targetCellId).is('deleted_at', null).maybeSingle()
  if (rootOwner) {
    await supabase.from('mandalarts').update({ title: snapshot.cell.text, updated_at: ts, synced_at: ts }).eq('id', (rootOwner as { id: string }).id)
  }

  const isCenterSnapshot = snapshot.position === CENTER_POSITION
  if (isCenterSnapshot && targetCell.position === CENTER_POSITION && snapshot.children.length > 0) {
    await expandGridSnapshotInto(snapshot.children[0], targetCell.grid_id, mandalartId)
    return
  }

  for (const child of snapshot.children) {
    await insertGridSnapshot(child, targetCellId, mandalartId)
  }
}

async function expandGridSnapshotInto(gridSnap: GridSnapshot, targetGridId: string, mandalartId: string): Promise<void> {
  const ts = now()
  const { data: existingData } = await supabase.from('cells').select('id, position').eq('grid_id', targetGridId).is('deleted_at', null).order('position')
  const existingCells = (existingData ?? []) as { id: string; position: number }[]
  const cellIdByPos = new Map(existingCells.map((c) => [c.position, c.id]))
  const snapByPos = new Map(gridSnap.cells.map((c) => [c.position, c]))

  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    if (pos === CENTER_POSITION) continue
    const sc = snapByPos.get(pos)
    const existingId = cellIdByPos.get(pos)
    if (existingId) {
      await supabase.from('cells').update({ text: sc?.text ?? '', image_path: sc?.image_path ?? null, color: sc?.color ?? null, updated_at: ts, synced_at: ts }).eq('id', existingId)
    } else if (sc && (sc.text !== '' || sc.image_path !== null || sc.color !== null)) {
      const newCellId = generateId()
      const s = synced()
      await supabase.from('cells').insert({
        id: newCellId, grid_id: targetGridId, position: pos,
        text: sc.text, image_path: sc.image_path, color: sc.color,
        created_at: ts, updated_at: ts, synced_at: s,
      })
      cellIdByPos.set(pos, newCellId)
    }
  }

  for (const child of gridSnap.children) {
    const parentPos = child.parentPosition
    const parentCellId = parentPos !== undefined ? cellIdByPos.get(parentPos) : null
    if (parentCellId) {
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

async function insertGridSnapshot(snap: GridSnapshot, parentCellId: string, mandalartId: string): Promise<void> {
  const gridId = generateId()
  const ts = now()
  const s = synced()
  await supabase.from('grids').insert({
    id: gridId, mandalart_id: mandalartId,
    center_cell_id: parentCellId, parent_cell_id: parentCellId,
    sort_order: snap.grid.sort_order, memo: snap.grid.memo,
    created_at: ts, updated_at: ts, synced_at: s,
  })

  const byPos = new Map(snap.cells.map((c) => [c.position, c]))
  const newCellIds = new Map<number, string>()
  for (let i = 0; i < GRID_CELL_COUNT; i++) {
    if (i === CENTER_POSITION) continue
    const c = byPos.get(i)
    const cellId = generateId()
    newCellIds.set(i, cellId)
    await supabase.from('cells').insert({
      id: cellId, grid_id: gridId, position: i,
      text: c?.text ?? '', image_path: c?.image_path ?? null, color: c?.color ?? null,
      created_at: ts, updated_at: ts, synced_at: s,
    })
  }

  for (const child of snap.children) {
    const parentPos = child.parentPosition
    if (parentPos !== undefined) {
      if (parentPos === CENTER_POSITION) {
        await insertGridSnapshot(child, parentCellId, mandalartId)
      } else {
        const cellId = newCellIds.get(parentPos)
        if (cellId) await insertGridSnapshot(child, cellId, mandalartId)
      }
    } else {
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

export async function buildCellSnapshot(cellId: string): Promise<CellSnapshot> {
  const { data: cellData } = await supabase
    .from('cells')
    .select('text, image_path, color, position, grid_id')
    .eq('id', cellId)
    .is('deleted_at', null)
    .maybeSingle()
  const c = cellData as { text: string; image_path: string | null; color: string | null; position: number; grid_id: string } | null
  if (!c) throw new Error(`Cell not found: ${cellId}`)

  const children: GridSnapshot[] = []
  const targetGridsRes = c.position === CENTER_POSITION
    ? await supabase.from('grids').select('id, memo, sort_order').eq('center_cell_id', cellId).is('deleted_at', null).order('sort_order')
    : await supabase.from('grids').select('id, memo, sort_order').eq('parent_cell_id', cellId).is('deleted_at', null).order('sort_order')

  for (const g of ((targetGridsRes.data ?? []) as { id: string; memo: string | null; sort_order: number }[])) {
    children.push(await buildGridSnapshot(g.id, g.memo, g.sort_order))
  }

  return { cell: { text: c.text, image_path: c.image_path, color: c.color }, position: c.position, children }
}

async function buildGridSnapshot(gridId: string, memo: string | null, sortOrder: number): Promise<GridSnapshot> {
  const { data: gridRow } = await supabase.from('grids').select('center_cell_id').eq('id', gridId).is('deleted_at', null).maybeSingle()
  const centerId = (gridRow as { center_cell_id: string } | null)?.center_cell_id

  const { data: cellsData } = await supabase.from('cells').select('*').eq('grid_id', gridId).is('deleted_at', null).order('position')
  const gridCells = (cellsData ?? []) as Cell[]
  const peripherals = gridCells.filter((c) => c.id !== centerId)
  const cellSnaps = peripherals.map((c) => ({
    position: c.position, text: c.text, image_path: c.image_path, color: c.color, done: c.done,
  }))

  const children: GridSnapshot[] = []
  for (const sc of peripherals) {
    const { data: subData } = await supabase
      .from('grids')
      .select('id, memo, sort_order')
      .eq('parent_cell_id', sc.id)
      .neq('id', gridId)
      .is('deleted_at', null)
      .order('sort_order')
    for (const subGrid of ((subData ?? []) as { id: string; memo: string | null; sort_order: number }[])) {
      const childSnap = await buildGridSnapshot(subGrid.id, subGrid.memo, subGrid.sort_order)
      children.push({ ...childSnap, parentPosition: sc.position })
    }
  }

  return { grid: { memo, sort_order: sortOrder }, cells: cellSnaps, children }
}
