import { supabase } from '../supabase/client'
import { generateId, now } from '@/lib/utils/id'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import { isCellEmpty } from '@/lib/utils/grid'
import { deleteGrid } from './grids'
import type { Cell } from '../../types'

function synced(): string {
  return now()
}

async function fetchCell(id: string): Promise<Cell | null> {
  const { data } = await supabase.from('cells').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  return data as unknown as Cell | null
}

export async function upsertCellAt(
  gridId: string,
  position: number,
  params: { text?: string; image_path?: string | null; color?: string | null },
): Promise<Cell> {
  const { data: existing } = await supabase
    .from('cells')
    .select('*')
    .eq('grid_id', gridId)
    .eq('position', position)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    return updateCell((existing as Cell).id, params)
  }

  const id = generateId()
  const ts = now()
  const s = synced()
  const { error } = await supabase.from('cells').insert({
    id, grid_id: gridId, position,
    text: params.text ?? '',
    image_path: params.image_path ?? null,
    color: params.color ?? null,
    done: false,
    created_at: ts, updated_at: ts, synced_at: s,
  })
  if (error) throw error
  const cell = await fetchCell(id)
  if (!cell) throw new Error(`upsertCellAt: cell not found after insert: ${id}`)
  return cell
}

export async function updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null },
): Promise<Cell> {
  const prevCell = await fetchCell(id)
  const wasEmpty = prevCell ? isCellEmpty(prevCell) : false

  const ts = now()
  const s = synced()
  const updates: Record<string, unknown> = { updated_at: ts, synced_at: s }
  if (params.text !== undefined) updates.text = params.text
  if (params.image_path !== undefined) updates.image_path = params.image_path
  if (params.color !== undefined) updates.color = params.color

  const { error } = await supabase.from('cells').update(updates).eq('id', id)
  if (error) throw error

  const cell = await fetchCell(id)
  if (!cell) throw new Error(`updateCell: cell not found after update: ${id}`)

  // root center cell の title ミラー
  if (params.text !== undefined) {
    const { data: rootOwner } = await supabase
      .from('mandalarts')
      .select('id')
      .eq('root_cell_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (rootOwner) {
      await supabase.from('mandalarts').update({ title: params.text, updated_at: ts, synced_at: s }).eq('id', (rootOwner as { id: string }).id)
    }
  }

  if (wasEmpty && !isCellEmpty(cell)) {
    if (Number(cell.done) === 1) {
      await supabase.from('cells').update({ done: false, updated_at: ts }).eq('id', cell.id)
      cell.done = false
    }
    await propagateUndoneUp(cell.id, ts)
  }

  return cell
}

export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void> {
  const [ca, cb] = await Promise.all([fetchCell(cellIdA), fetchCell(cellIdB)])
  if (!ca || !cb) return
  const ts = now()
  await supabase.from('cells').update({ text: cb.text, image_path: cb.image_path, color: cb.color, done: cb.done, updated_at: ts, synced_at: ts }).eq('id', cellIdA)
  await supabase.from('cells').update({ text: ca.text, image_path: ca.image_path, color: ca.color, done: ca.done, updated_at: ts, synced_at: ts }).eq('id', cellIdB)
}

export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  const [aInfo, bInfo] = await Promise.all([
    supabase.from('cells').select('grid_id').eq('id', cellIdA).is('deleted_at', null).maybeSingle(),
    supabase.from('cells').select('grid_id').eq('id', cellIdB).is('deleted_at', null).maybeSingle(),
  ])
  const gridIdA = (aInfo.data as { grid_id: string } | null)?.grid_id ?? ''
  const gridIdB = (bInfo.data as { grid_id: string } | null)?.grid_id ?? ''

  const [childrenOfA, childrenOfB, centeredOnA, centeredOnB] = await Promise.all([
    supabase.from('grids').select('id').eq('parent_cell_id', cellIdA).is('deleted_at', null),
    supabase.from('grids').select('id').eq('parent_cell_id', cellIdB).is('deleted_at', null),
    supabase.from('grids').select('id').eq('center_cell_id', cellIdA).neq('id', gridIdA).is('deleted_at', null),
    supabase.from('grids').select('id').eq('center_cell_id', cellIdB).neq('id', gridIdB).is('deleted_at', null),
  ])
  const ts = now()
  for (const g of ((childrenOfA.data ?? []) as { id: string }[])) {
    await supabase.from('grids').update({ parent_cell_id: cellIdB, updated_at: ts, synced_at: ts }).eq('id', g.id)
  }
  for (const g of ((childrenOfB.data ?? []) as { id: string }[])) {
    await supabase.from('grids').update({ parent_cell_id: cellIdA, updated_at: ts, synced_at: ts }).eq('id', g.id)
  }
  for (const g of ((centeredOnA.data ?? []) as { id: string }[])) {
    await supabase.from('grids').update({ center_cell_id: cellIdB, updated_at: ts, synced_at: ts }).eq('id', g.id)
  }
  for (const g of ((centeredOnB.data ?? []) as { id: string }[])) {
    await supabase.from('grids').update({ center_cell_id: cellIdA, updated_at: ts, synced_at: ts }).eq('id', g.id)
  }
  await swapCellContent(cellIdA, cellIdB)
}

export async function isSelfCenterWithPeripheralContent(cellId: string): Promise<boolean> {
  const { data: c } = await supabase.from('cells').select('grid_id, position').eq('id', cellId).is('deleted_at', null).maybeSingle()
  if (!c || (c as { position: number }).position !== CENTER_POSITION) return false
  const { data: peripherals } = await supabase
    .from('cells')
    .select('text, image_path')
    .eq('grid_id', (c as { grid_id: string }).grid_id)
    .neq('position', CENTER_POSITION)
    .is('deleted_at', null)
  return ((peripherals ?? []) as { text: string; image_path: string | null }[]).some((p) => !isCellEmpty(p))
}

export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const src = await fetchCell(sourceCellId)
  if (!src) return

  type AnyGrid = { id: string; center_cell_id: string; sort_order: number; mandalart_id: string; memo: string | null }

  const { data: gridOfSrc } = await supabase
    .from('grids')
    .select('mandalart_id')
    .eq('id', src.grid_id)
    .is('deleted_at', null)
    .maybeSingle()
  const mandalartId = (gridOfSrc as { mandalart_id: string } | null)?.mandalart_id
  if (!mandalartId) return

  const { data: allGridsData } = await supabase
    .from('grids')
    .select('id, center_cell_id, sort_order, mandalart_id, memo')
    .eq('mandalart_id', mandalartId)
    .is('deleted_at', null)
  const allGridsInMandalart = (allGridsData ?? []) as AnyGrid[]

  const topLevelGrids = allGridsInMandalart.filter((g) => g.center_cell_id === sourceCellId)
  if (topLevelGrids.length === 0) {
    const ts = now()
    await supabase.from('cells').update({ text: src.text, image_path: src.image_path, color: src.color, updated_at: ts, synced_at: ts }).eq('id', targetCellId)
    return
  }

  const allGridIds = allGridsInMandalart.map((g) => g.id)
  type NarrowCell = Pick<Cell, 'id' | 'grid_id' | 'position' | 'text' | 'image_path' | 'color' | 'done'>
  let allCells: NarrowCell[] = []
  const CHUNK = 500
  for (let i = 0; i < allGridIds.length; i += CHUNK) {
    const { data: chunk } = await supabase
      .from('cells')
      .select('id, grid_id, position, text, image_path, color, done')
      .in('grid_id', allGridIds.slice(i, i + CHUNK))
      .is('deleted_at', null)
    allCells = allCells.concat((chunk ?? []) as NarrowCell[])
  }

  const cellsByGrid = new Map<string, NarrowCell[]>()
  for (const c of allCells) {
    const arr = cellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    cellsByGrid.set(c.grid_id, arr)
  }
  const gridsByCenterCell = new Map<string, AnyGrid[]>()
  for (const g of allGridsInMandalart) {
    const arr = gridsByCenterCell.get(g.center_cell_id) ?? []
    arr.push(g)
    gridsByCenterCell.set(g.center_cell_id, arr)
  }

  const ts = now()
  const s = synced()
  const cellIdMap = new Map<string, string>()
  const gridInserts: Record<string, unknown>[] = []
  const cellInserts: Record<string, unknown>[] = []
  const processedGridIds = new Set<string>()

  type Node = { sourceGridId: string; newGridId: string; newCenterCellId: string; sortOrder: number; mandalartId: string; memo: string | null; sourceCenterId: string }

  let queue: Node[] = topLevelGrids.map((g) => ({
    sourceGridId: g.id, newGridId: generateId(), newCenterCellId: targetCellId,
    sortOrder: g.sort_order, mandalartId: g.mandalart_id, memo: g.memo, sourceCenterId: g.center_cell_id,
  }))

  while (queue.length > 0) {
    const batch = queue
    queue = []
    for (const n of batch) {
      if (processedGridIds.has(n.sourceGridId)) continue
      processedGridIds.add(n.sourceGridId)
      gridInserts.push({
        id: n.newGridId, mandalart_id: n.mandalartId,
        center_cell_id: n.newCenterCellId, parent_cell_id: n.newCenterCellId,
        sort_order: n.sortOrder, memo: n.memo,
        created_at: ts, updated_at: ts, synced_at: s,
      })
      cellIdMap.set(n.sourceCenterId, n.newCenterCellId)
      const ownCells = cellsByGrid.get(n.sourceGridId) ?? []
      for (const sc of ownCells) {
        if (sc.id === n.sourceCenterId) continue
        const newCellId = generateId()
        cellIdMap.set(sc.id, newCellId)
        const children = (gridsByCenterCell.get(sc.id) ?? []).filter((c) => c.id !== n.sourceGridId)
        const isPopulated = sc.text !== '' || sc.image_path !== null || sc.color !== null
        if (isPopulated || children.length > 0) {
          cellInserts.push({
            id: newCellId, grid_id: n.newGridId, position: sc.position,
            text: sc.text, image_path: sc.image_path, color: sc.color, done: sc.done,
            created_at: ts, updated_at: ts, synced_at: s,
          })
        }
        for (const child of children) {
          if (processedGridIds.has(child.id)) continue
          queue.push({
            sourceGridId: child.id, newGridId: generateId(), newCenterCellId: newCellId,
            sortOrder: child.sort_order, mandalartId: child.mandalart_id, memo: child.memo, sourceCenterId: child.center_cell_id,
          })
        }
      }
    }
  }

  const BATCH = 100
  for (let i = 0; i < gridInserts.length; i += BATCH) {
    const { error } = await supabase.from('grids').insert(gridInserts.slice(i, i + BATCH))
    if (error) throw error
  }
  for (let i = 0; i < cellInserts.length; i += BATCH) {
    const { error } = await supabase.from('cells').insert(cellInserts.slice(i, i + BATCH))
    if (error) throw error
  }

  await supabase.from('cells').update({ text: src.text, image_path: src.image_path, color: src.color, updated_at: ts }).eq('id', targetCellId)
}

export async function shredCellSubtree(cellId: string): Promise<void> {
  const { data: subGridsData } = await supabase
    .from('grids')
    .select('id')
    .eq('parent_cell_id', cellId)
    .is('deleted_at', null)
  for (const g of ((subGridsData ?? []) as { id: string }[])) {
    await deleteGrid(g.id)
  }
  const ts = now()
  await supabase.from('cells').update({ text: '', image_path: null, color: null, done: false, updated_at: ts, synced_at: ts }).eq('id', cellId)
  await propagateDoneUp(cellId, ts)
}

export async function clearGridPeripherals(gridId: string): Promise<void> {
  const { data: peripherals } = await supabase
    .from('cells')
    .select('id')
    .eq('grid_id', gridId)
    .neq('position', CENTER_POSITION)
    .is('deleted_at', null)
  for (const c of ((peripherals ?? []) as { id: string }[])) {
    await shredCellSubtree(c.id)
  }
}

export async function setGridDone(gridId: string, done: boolean): Promise<void> {
  const ts = now()
  const q = supabase.from('cells')
    .update({ done, updated_at: ts, synced_at: ts })
    .eq('grid_id', gridId)
    .is('deleted_at', null)
    .neq('done', done)
    .or('text.neq.,image_path.not.is.null')
  await q
}

export async function toggleCellDone(cellId: string): Promise<void> {
  const cell = await fetchCell(cellId)
  if (!cell) return
  const nextDone = !cell.done
  const ts = now()
  await markSubtreeDone(cellId, nextDone, ts)
  if (nextDone) {
    await propagateDoneUp(cellId, ts)
  } else {
    await propagateUndoneUp(cellId, ts)
  }
}

async function markSubtreeDone(cellId: string, done: boolean, ts: string): Promise<void> {
  const cell = await fetchCell(cellId)
  if (!cell) return
  if (!isCellEmpty(cell)) {
    await supabase.from('cells').update({ done, updated_at: ts, synced_at: ts }).eq('id', cellId).neq('done', done)
  }
  const { data: centeringGrids } = await supabase
    .from('grids')
    .select('id')
    .eq('center_cell_id', cellId)
    .is('deleted_at', null)
  for (const g of ((centeringGrids ?? []) as { id: string }[])) {
    const { data: peripherals } = await supabase
      .from('cells')
      .select('id')
      .eq('grid_id', g.id)
      .neq('id', cellId)
      .is('deleted_at', null)
      .or('text.neq.,image_path.not.is.null')
    for (const p of ((peripherals ?? []) as { id: string }[])) {
      await markSubtreeDone(p.id, done, ts)
    }
  }
}

async function getParentCellInTree(cellId: string): Promise<{ id: string } | null> {
  const { data: cellRow } = await supabase.from('cells').select('grid_id').eq('id', cellId).is('deleted_at', null).maybeSingle()
  if (!cellRow) return null
  const { data: gridRow } = await supabase.from('grids').select('center_cell_id').eq('id', (cellRow as { grid_id: string }).grid_id).is('deleted_at', null).maybeSingle()
  const centerCellId = (gridRow as { center_cell_id: string } | null)?.center_cell_id
  if (!centerCellId || centerCellId === cellId) return null
  return { id: centerCellId }
}

async function areDescendantsAllDone(cellId: string): Promise<boolean> {
  const { data: centeringGrids } = await supabase.from('grids').select('id').eq('center_cell_id', cellId).is('deleted_at', null)
  for (const g of ((centeringGrids ?? []) as { id: string }[])) {
    const { data: peripherals } = await supabase
      .from('cells')
      .select('id, done, text, image_path')
      .eq('grid_id', g.id)
      .neq('id', cellId)
      .is('deleted_at', null)
    for (const p of ((peripherals ?? []) as { id: string; done: boolean; text: string; image_path: string | null }[])) {
      if (isCellEmpty(p)) continue
      if (!p.done) return false
      if (!(await areDescendantsAllDone(p.id))) return false
    }
  }
  return true
}

async function propagateDoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  if (!(await areDescendantsAllDone(parent.id))) return
  await supabase.from('cells').update({ done: true, updated_at: ts, synced_at: ts }).eq('id', parent.id).eq('done', false)
  await propagateDoneUp(parent.id, ts)
}

async function propagateUndoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  const parentCell = await fetchCell(parent.id)
  if (!parentCell || !parentCell.done) return
  await supabase.from('cells').update({ done: false, updated_at: ts, synced_at: ts }).eq('id', parent.id)
  await propagateUndoneUp(parent.id, ts)
}

// stock.ts からも使われる内部ヘルパー
export { GRID_CELL_COUNT }
