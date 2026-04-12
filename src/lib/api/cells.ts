import { createClient } from '@/lib/supabase/client'
import type { Cell } from '@/types'

export async function updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null },
): Promise<Cell> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cells')
    .update(params)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void> {
  const supabase = createClient()

  const { data: cells, error } = await supabase
    .from('cells')
    .select('*')
    .in('id', [cellIdA, cellIdB])
  if (error) throw error

  const a = cells.find((c: Cell) => c.id === cellIdA)!
  const b = cells.find((c: Cell) => c.id === cellIdB)!

  await Promise.all([
    supabase.from('cells').update({ text: b.text, image_path: b.image_path, color: b.color }).eq('id', cellIdA),
    supabase.from('cells').update({ text: a.text, image_path: a.image_path, color: a.color }).eq('id', cellIdB),
  ])
}

export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  const supabase = createClient()

  // 内容を入れ替え
  await swapCellContent(cellIdA, cellIdB)

  // 子グリッドの parent_cell_id を付け替え
  const { data: gridsA } = await supabase.from('grids').select('id').eq('parent_cell_id', cellIdA)
  const { data: gridsB } = await supabase.from('grids').select('id').eq('parent_cell_id', cellIdB)

  // 一時 ID を使って swap（FK 制約回避のため sequential）
  const TEMP = '00000000-0000-0000-0000-000000000000'

  if (gridsA && gridsA.length > 0) {
    await supabase.from('grids').update({ parent_cell_id: TEMP }).in('id', gridsA.map((g: {id: string}) => g.id))
  }
  if (gridsB && gridsB.length > 0) {
    await supabase.from('grids').update({ parent_cell_id: cellIdA }).in('id', gridsB.map((g: {id: string}) => g.id))
  }
  if (gridsA && gridsA.length > 0) {
    await supabase.from('grids').update({ parent_cell_id: cellIdB }).in('id', gridsA.map((g: {id: string}) => g.id))
  }
}

export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const supabase = createClient()

  // ターゲットセルの mandalart_id を取得
  const { data: targetCell } = await supabase
    .from('cells')
    .select('grid_id')
    .eq('id', targetCellId)
    .single()
  if (!targetCell) throw new Error('Target cell not found')

  const { data: targetGrid } = await supabase
    .from('grids')
    .select('mandalart_id')
    .eq('id', targetCell!.grid_id)
    .single()
  if (!targetGrid) throw new Error('Target grid not found')

  // ソースの子グリッド以下を再帰コピー
  async function copyChildGrids(fromCellId: string, toCellId: string): Promise<void> {
    const { data: childGrids } = await supabase
      .from('grids')
      .select('*, cells(*)')
      .eq('parent_cell_id', fromCellId)
      .order('sort_order')
    if (!childGrids) return

    for (const cg of childGrids) {
      const { data: newGrid } = await supabase
        .from('grids')
        .insert({
          mandalart_id: targetGrid!.mandalart_id,
          parent_cell_id: toCellId,
          sort_order: cg.sort_order,
          memo: cg.memo,
        })
        .select()
        .single()
      if (!newGrid) continue

      const cellIdMap = new Map<string, string>()
      for (const cell of cg.cells as Cell[]) {
        const { data: newCell } = await supabase
          .from('cells')
          .insert({ grid_id: newGrid.id, position: cell.position, text: cell.text, image_path: cell.image_path, color: cell.color })
          .select()
          .single()
        if (newCell) cellIdMap.set(cell.id, newCell.id)
      }

      for (const [origId, newId] of cellIdMap) {
        await copyChildGrids(origId, newId)
      }
    }
  }

  await copyChildGrids(sourceCellId, targetCellId)
}
