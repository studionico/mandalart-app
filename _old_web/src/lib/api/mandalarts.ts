import { createClient } from '@/lib/supabase/client'
import type { Mandalart, Grid, Cell } from '@/types'

export async function getMandalarts(): Promise<Mandalart[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getMandalart(id: string): Promise<Mandalart> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createMandalart(title = ''): Promise<Mandalart> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const { data, error } = await supabase
    .from('mandalarts')
    .insert({ user_id: user.id, title })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMandalartTitle(id: string, title: string): Promise<Mandalart> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mandalarts')
    .update({ title })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMandalart(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('mandalarts').delete().eq('id', id)
  if (error) throw error
}

export async function duplicateMandalart(id: string): Promise<Mandalart> {
  const supabase = createClient()

  // 元のマンダラートを取得
  const original = await getMandalart(id)
  const newMandalart = await createMandalart(`${original.title} (コピー)`)

  // grids・cells を再帰的にコピー
  type GridWithCells = Grid & { cells: Cell[]; children: GridWithCells[] }

  async function fetchGridTree(parentCellId: string | null, mandalartId: string): Promise<GridWithCells[]> {
    const { data: grids, error } = await supabase
      .from('grids')
      .select('*, cells(*)')
      .eq('mandalart_id', mandalartId)
      .is('parent_cell_id', parentCellId)
      .order('sort_order')
    if (error) throw error

    const result: GridWithCells[] = []
    for (const g of grids) {
      const children = await fetchGridTree(null, mandalartId) // 後で cell id で fetch
      result.push({ ...g, children })
    }
    return result
  }

  async function copyGrid(
    sourceGrid: GridWithCells,
    newMandalartId: string,
    newParentCellId: string | null,
    cellIdMap: Map<string, string>,
  ): Promise<void> {
    const { data: newGrid, error: gErr } = await supabase
      .from('grids')
      .insert({
        mandalart_id: newMandalartId,
        parent_cell_id: newParentCellId,
        sort_order: sourceGrid.sort_order,
        memo: sourceGrid.memo,
      })
      .select()
      .single()
    if (gErr) throw gErr

    for (const cell of sourceGrid.cells) {
      const { data: newCell, error: cErr } = await supabase
        .from('cells')
        .insert({
          grid_id: newGrid.id,
          position: cell.position,
          text: cell.text,
          image_path: cell.image_path,
          color: cell.color,
        })
        .select()
        .single()
      if (cErr) throw cErr
      cellIdMap.set(cell.id, newCell.id)
    }

    // 子グリッドを再帰的にコピー
    const { data: childGrids, error: cgErr } = await supabase
      .from('grids')
      .select('*, cells(*)')
      .eq('mandalart_id', id)
      .in('parent_cell_id', sourceGrid.cells.map((c) => c.id))
      .order('sort_order')
    if (cgErr) throw cgErr

    for (const childGrid of childGrids) {
      const newParent = cellIdMap.get(childGrid.parent_cell_id!) ?? null
      await copyGrid(childGrid as GridWithCells, newMandalartId, newParent, cellIdMap)
    }
  }

  const { data: rootGrids, error: rgErr } = await supabase
    .from('grids')
    .select('*, cells(*)')
    .eq('mandalart_id', id)
    .is('parent_cell_id', null)
    .order('sort_order')
  if (rgErr) throw rgErr

  const cellIdMap = new Map<string, string>()
  for (const rootGrid of rootGrids) {
    await copyGrid(rootGrid as GridWithCells, newMandalart.id, null, cellIdMap)
  }

  return newMandalart
}

export async function searchMandalarts(query: string): Promise<Mandalart[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .ilike('title', `%${query}%`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}
