import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { generateId, now } from '@/lib/utils/id'
import { CENTER_POSITION } from '@/constants/grid'
import type { Grid, Cell } from '../../types'

function synced(): string {
  return now()
}

function withCenterPosition(cell: Cell): Cell {
  return { ...cell, position: CENTER_POSITION }
}

export async function getRootGrids(mandalartId: string): Promise<Grid[]> {
  const { data, error } = await supabase
    .from('grids')
    .select('*')
    .eq('mandalart_id', mandalartId)
    .is('parent_cell_id', null)
    .is('deleted_at', null)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as unknown as Grid[]
}

export async function getChildGrids(parentCellId: string): Promise<Grid[]> {
  const { data, error } = await supabase
    .from('grids')
    .select('*')
    .eq('parent_cell_id', parentCellId)
    .is('deleted_at', null)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as unknown as Grid[]
}

export async function getGrid(id: string): Promise<Grid & { cells: Cell[] }> {
  const [gridRes, cellsRes] = await Promise.all([
    supabase.from('grids').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    supabase.from('cells').select('*').eq('grid_id', id).is('deleted_at', null).order('position'),
  ])
  if (gridRes.error) throw gridRes.error
  if (cellsRes.error) throw cellsRes.error
  const grid = gridRes.data as unknown as Grid | null
  if (!grid) throw new Error(`Grid not found: ${id}`)
  const ownCells = (cellsRes.data ?? []) as unknown as Cell[]

  const hasCenter = ownCells.some((c) => c.id === grid.center_cell_id)
  if (hasCenter) {
    ownCells.sort((a, b) => a.position - b.position)
    return { ...grid, cells: ownCells }
  }

  const { data: centerData } = await supabase
    .from('cells')
    .select('*')
    .eq('id', grid.center_cell_id)
    .is('deleted_at', null)
    .maybeSingle()
  const merged: Cell[] = [...ownCells]
  if (centerData) {
    merged.push(withCenterPosition(centerData as unknown as Cell))
  }
  merged.sort((a, b) => a.position - b.position)
  return { ...grid, cells: merged }
}

export async function getGridAncestry(gridId: string): Promise<Array<Grid & { cells: Cell[] }> | null> {
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
    if (!grid.parent_cell_id) break
    const { data: cellRows } = await supabase
      .from('cells')
      .select('grid_id')
      .eq('id', grid.parent_cell_id)
      .is('deleted_at', null)
      .maybeSingle()
    const parentGridId = (cellRows as { grid_id: string } | null)?.grid_id
    if (!parentGridId) return null
    currentId = parentGridId
  }
  return ancestry
}

export async function createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  centerCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }> {
  const gridId = generateId()
  const ts = now()
  const s = synced()

  if (params.centerCellId === null) {
    const centerCellId = generateId()
    const { error: eG } = await supabase.from('grids').insert({
      id: gridId, mandalart_id: params.mandalartId,
      center_cell_id: centerCellId, parent_cell_id: params.parentCellId,
      sort_order: params.sortOrder,
      created_at: ts, updated_at: ts, synced_at: s,
    })
    if (eG) throw eG
    const { error: eC } = await supabase.from('cells').insert({
      id: centerCellId, grid_id: gridId, position: CENTER_POSITION, text: '',
      created_at: ts, updated_at: ts, synced_at: s,
    })
    if (eC) throw eC
  } else {
    const { error: eG } = await supabase.from('grids').insert({
      id: gridId, mandalart_id: params.mandalartId,
      center_cell_id: params.centerCellId, parent_cell_id: params.parentCellId,
      sort_order: params.sortOrder,
      created_at: ts, updated_at: ts, synced_at: s,
    })
    if (eG) throw eG
  }

  return getGrid(gridId)
}

export async function updateGridMemo(id: string, memo: string): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('grids').update({ memo, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function deleteGrid(id: string): Promise<void> {
  const ts = now()
  // 自 grid 所属の cells を取得して子グリッドを再帰削除
  const { data: cellsData } = await supabase
    .from('cells')
    .select('id')
    .eq('grid_id', id)
    .is('deleted_at', null)
  const cells = (cellsData ?? []) as { id: string }[]

  for (const c of cells) {
    const { data: subGridsData } = await supabase
      .from('grids')
      .select('id')
      .eq('center_cell_id', c.id)
      .neq('id', id)
      .is('deleted_at', null)
    for (const sg of ((subGridsData ?? []) as { id: string }[])) {
      await deleteGrid(sg.id)
    }
  }

  // 自 grid 所属の cells を soft delete
  await supabase.from('cells').update({ deleted_at: ts, updated_at: ts }).eq('grid_id', id).is('deleted_at', null)
  // grid 本体を soft delete
  await supabase.from('grids').update({ deleted_at: ts, updated_at: ts }).eq('id', id).is('deleted_at', null)
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('grids').update({ sort_order: sortOrder, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function permanentDeleteGrid(id: string): Promise<void> {
  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await supabase.from('cells').delete().eq('grid_id', id)
  await supabase.from('grids').delete().eq('id', id)
}

export async function cleanupEmptyCellsInCloud(): Promise<{ deletedCount: number }> {
  if (!isSupabaseConfigured) return { deletedCount: 0 }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { deletedCount: 0 }

  try {
    const { data: referencedRows } = await supabase.from('grids').select('center_cell_id')
    const referencedIds = new Set(
      ((referencedRows ?? []) as { center_cell_id: string }[])
        .map((r) => r.center_cell_id)
        .filter((v): v is string => v != null),
    )

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

    const toDelete = emptyIds.filter((id) => !referencedIds.has(id))
    const BATCH = 500
    for (let i = 0; i < toDelete.length; i += BATCH) {
      await supabase.from('cells').delete().in('id', toDelete.slice(i, i + BATCH))
    }
    return { deletedCount: toDelete.length }
  } catch (e) {
    console.warn('[cleanupEmptyCellsInCloud] failed:', e)
    return { deletedCount: 0 }
  }
}
