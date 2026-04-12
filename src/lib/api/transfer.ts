import { createClient } from '@/lib/supabase/client'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/utils/import-parser'

export { parseTextToSnapshot }

export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  const supabase = createClient()

  async function fetchSnapshot(gId: string, sortOrder: number): Promise<GridSnapshot> {
    const { data: grid } = await supabase.from('grids').select('*, cells(*)').eq('id', gId).single()
    if (!grid) throw new Error('Grid not found')

    const children: GridSnapshot[] = []
    for (const cell of (grid.cells as Cell[])) {
      const { data: childGrids } = await supabase
        .from('grids')
        .select('id, sort_order')
        .eq('parent_cell_id', cell.id)
        .order('sort_order')

      for (const cg of childGrids ?? []) {
        children.push(await fetchSnapshot(cg.id, cg.sort_order))
      }
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo },
      cells: (grid.cells as Cell[]).map((c) => ({
        position: c.position, text: c.text, image_path: c.image_path, color: c.color,
      })),
      children,
    }
  }

  const { data: grid } = await supabase.from('grids').select('sort_order').eq('id', gridId).single()
  return fetchSnapshot(gridId, grid?.sort_order ?? 0)
}

export async function exportToCSV(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  const rows: string[] = ['position,text,color,depth']

  function flatten(s: GridSnapshot, depth: number) {
    for (const cell of s.cells) {
      rows.push(`${cell.position},"${cell.text.replace(/"/g, '""')}",${cell.color ?? ''},${depth}`)
    }
    for (const child of s.children) {
      flatten(child, depth + 1)
    }
  }

  flatten(snapshot, 0)
  return rows.join('\n')
}

export async function importFromJSON(snapshot: GridSnapshot): Promise<Mandalart> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const centerText = snapshot.cells.find((c) => c.position === 4)?.text ?? ''
  const { data: mandalart } = await supabase
    .from('mandalarts')
    .insert({ user_id: user.id, title: centerText })
    .select()
    .single()
  if (!mandalart) throw new Error('Failed to create mandalart')

  await importIntoGrid(snapshot, mandalart.id, null, 0)
  return mandalart as Mandalart
}

async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  parentCellId: string | null,
  sortOrder: number,
) {
  const supabase = createClient()

  const { data: grid } = await supabase
    .from('grids')
    .insert({ mandalart_id: mandalartId, parent_cell_id: parentCellId, sort_order: sortOrder, memo: snapshot.grid.memo })
    .select()
    .single()
  if (!grid) throw new Error('Failed to create grid')

  const allPositions = Array.from({ length: 9 }, (_, i) => i)
  const insertCells = allPositions.map((pos) => {
    const c = snapshot.cells.find((c) => c.position === pos)
    return { grid_id: grid.id, position: pos, text: c?.text ?? '', image_path: c?.image_path ?? null, color: c?.color ?? null }
  })

  const { data: insertedCells } = await supabase.from('cells').insert(insertCells).select()

  for (const child of snapshot.children) {
    const parentPos = child.cells.find((c) => c.position === 4)?.position
    const matchCell = insertedCells?.find((c: Cell) => c.position === (parentPos ?? 4))
    if (matchCell) {
      await importIntoGrid(child, mandalartId, matchCell.id, child.grid.sort_order)
    }
  }
}

export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void> {
  const supabase = createClient()
  const { data: cell } = await supabase.from('cells').select('grid_id').eq('id', cellId).single()
  const { data: grid } = await supabase.from('grids').select('mandalart_id').eq('id', cell!.grid_id).single()

  await importIntoGrid(snapshot, grid!.mandalart_id, cellId, 0)
}
