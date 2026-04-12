import { createClient } from '@/lib/supabase/client'
import type { Grid, Cell } from '@/types'

export async function getRootGrids(mandalartId: string): Promise<Grid[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('grids')
    .select('*')
    .eq('mandalart_id', mandalartId)
    .is('parent_cell_id', null)
    .order('sort_order')
  if (error) throw error
  return data
}

export async function getChildGrids(parentCellId: string): Promise<Grid[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('grids')
    .select('*')
    .eq('parent_cell_id', parentCellId)
    .order('sort_order')
  if (error) throw error
  return data
}

export async function getGrid(id: string): Promise<Grid & { cells: Cell[] }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('grids')
    .select('*, cells!cells_grid_id_fkey(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as Grid & { cells: Cell[] }
}

export async function createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }> {
  const supabase = createClient()

  const { data: grid, error: gErr } = await supabase
    .from('grids')
    .insert({
      mandalart_id: params.mandalartId,
      parent_cell_id: params.parentCellId,
      sort_order: params.sortOrder,
    })
    .select()
    .single()
  if (gErr) throw gErr

  const cellInserts = Array.from({ length: 9 }).map((_, i) => ({
    grid_id: grid.id,
    position: i,
    text: '',
  }))

  const { data: cells, error: cErr } = await supabase
    .from('cells')
    .insert(cellInserts)
    .select()
  if (cErr) throw cErr

  return { ...grid, cells: cells as Cell[] }
}

export async function updateGridMemo(id: string, memo: string): Promise<Grid> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('grids')
    .update({ memo })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteGrid(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('grids').delete().eq('id', id)
  if (error) throw error
}

export async function updateGridSortOrder(id: string, sortOrder: number): Promise<Grid> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('grids')
    .update({ sort_order: sortOrder })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
