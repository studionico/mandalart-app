import { supabase } from '@/lib/supabase/client'
import { generateId, now } from '@/lib/utils/id'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/import-parser'
import { buildFrontmatter } from '@/lib/markdown-frontmatter'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import { TAB_ORDER } from '@/constants/tabOrder'
import { ensureInboxFolder } from './folders'
import { nextTopSortOrder } from './mandalarts'

export { parseTextToSnapshot }

const PERIPHERAL_POSITIONS = TAB_ORDER.filter((p) => p !== CENTER_POSITION)

export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  const visited = new Set<string>()

  async function fetchSnapshot(
    gId: string,
    sortOrder: number,
    parentPosition: number | undefined,
  ): Promise<GridSnapshot> {
    visited.add(gId)

    const { data: gridData } = await supabase
      .from('grids')
      .select('*')
      .eq('id', gId)
      .is('deleted_at', null)
      .maybeSingle()
    const grid = gridData as (Grid & { memo: string | null }) | null
    if (!grid) throw new Error('Grid not found')

    const { data: ownCellsData } = await supabase
      .from('cells')
      .select('*')
      .eq('grid_id', gId)
      .is('deleted_at', null)
      .order('position')
    const ownCells = (ownCellsData ?? []) as Cell[]

    const hasCenter = ownCells.some((c) => c.id === grid.center_cell_id)
    const allCells = [...ownCells]
    if (!hasCenter) {
      const { data: centerData } = await supabase
        .from('cells')
        .select('*')
        .eq('id', grid.center_cell_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (centerData) allCells.push({ ...(centerData as Cell), position: CENTER_POSITION })
    }
    allCells.sort((a, b) => a.position - b.position)

    const children: GridSnapshot[] = []

    // 1. drilled descendants
    for (const cell of allCells) {
      if (cell.position === CENTER_POSITION) continue
      const { data: drilledData } = await supabase
        .from('grids')
        .select('id, sort_order')
        .eq('parent_cell_id', cell.id)
        .is('deleted_at', null)
        .order('sort_order')
      for (const d of ((drilledData ?? []) as { id: string; sort_order: number }[])) {
        if (visited.has(d.id)) continue
        children.push(await fetchSnapshot(d.id, d.sort_order, cell.position))
      }
    }

    // 2. parallels (siblings with same parent_cell_id)
    let parallelsData: { id: string; sort_order: number }[] | null = null
    if (grid.parent_cell_id == null) {
      const { data } = await supabase
        .from('grids')
        .select('id, sort_order')
        .eq('mandalart_id', grid.mandalart_id)
        .is('parent_cell_id', null)
        .neq('id', gId)
        .is('deleted_at', null)
        .order('sort_order')
      parallelsData = (data ?? []) as { id: string; sort_order: number }[]
    } else {
      const { data } = await supabase
        .from('grids')
        .select('id, sort_order')
        .eq('parent_cell_id', grid.parent_cell_id)
        .neq('id', gId)
        .is('deleted_at', null)
        .order('sort_order')
      parallelsData = (data ?? []) as { id: string; sort_order: number }[]
    }
    for (const p of (parallelsData ?? [])) {
      if (visited.has(p.id)) continue
      children.push(await fetchSnapshot(p.id, p.sort_order, undefined))
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo ?? null },
      parentPosition,
      cells: allCells.map((c) => ({
        position: c.position, text: c.text, image_path: c.image_path, color: c.color, done: c.done,
      })),
      children,
    }
  }

  const { data: gridMeta } = await supabase
    .from('grids')
    .select('sort_order')
    .eq('id', gridId)
    .is('deleted_at', null)
    .maybeSingle()
  return fetchSnapshot(gridId, (gridMeta as { sort_order: number } | null)?.sort_order ?? 0, undefined)
}

type ExportNode = { text: string; memo?: string | null; children: ExportNode[] }

function snapshotToExportNode(snap: GridSnapshot): ExportNode {
  const byPosition = new Map(snap.cells.map((c) => [c.position, c]))
  const centerText = byPosition.get(CENTER_POSITION)?.text ?? ''

  const subsByPos = new Map<number, GridSnapshot[]>()
  const parallels: GridSnapshot[] = []
  for (const child of snap.children) {
    if (child.parentPosition === undefined) {
      parallels.push(child)
    } else {
      const arr = subsByPos.get(child.parentPosition) ?? []
      arr.push(child)
      subsByPos.set(child.parentPosition, arr)
    }
  }

  const children: ExportNode[] = []
  for (const pos of PERIPHERAL_POSITIONS) {
    const cell = byPosition.get(pos)
    const text = cell?.text ?? ''
    if (text.trim() === '') continue
    const subs = subsByPos.get(pos) ?? []
    const grandchildren = subs.flatMap((sg) => snapshotToExportNode(sg).children)
    const subMemo = subs.length > 0 ? subs[0].grid.memo : null
    children.push({ text, memo: subMemo, children: grandchildren })
  }

  for (const parallel of parallels) {
    children.push(...snapshotToExportNode(parallel).children)
  }

  return { text: centerText, memo: snap.grid.memo ?? null, children }
}

export function snapshotToMarkdown(snapshot: GridSnapshot): string {
  const root = snapshotToExportNode(snapshot)

  const lines: string[] = []
  function walk(node: ExportNode, level: number): void {
    if (level <= 6) {
      lines.push(`${'#'.repeat(level)} ${node.text}`)
    } else {
      const indent = '  '.repeat(level - 7)
      lines.push(`${indent}- ${node.text}`)
    }
    if (node.memo && node.memo.trim() !== '') {
      for (const memoLine of node.memo.split('\n')) {
        lines.push(`> ${memoLine}`)
      }
    }
    for (const child of node.children) {
      if (level < 6) lines.push('')
      walk(child, level + 1)
    }
  }
  walk(root, 1)
  return lines.join('\n')
}

export async function exportToMarkdown(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  return `${buildFrontmatter(snapshot)}\n\n${snapshotToMarkdown(snapshot)}`
}

export function snapshotToIndentText(snapshot: GridSnapshot): string {
  const root = snapshotToExportNode(snapshot)

  const lines: string[] = []
  function walk(node: ExportNode, depth: number): void {
    const indent = '  '.repeat(depth)
    lines.push(`${indent}${node.text}`)
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}

export async function exportToIndentText(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  return snapshotToIndentText(snapshot)
}

export async function importFromJSON(
  snapshot: GridSnapshot,
  targetFolderId?: string,
): Promise<Mandalart> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) throw new Error('Not authenticated')

  const mandalartId = generateId()
  const ts = now()
  const centerText = snapshot.cells.find((c) => c.position === CENTER_POSITION)?.text ?? ''
  const folderId = targetFolderId ?? await ensureInboxFolder()
  const sortOrder = await nextTopSortOrder(folderId)

  const rootCenterCellId = generateId()
  const { error: mErr } = await supabase.from('mandalarts').insert({
    id: mandalartId, title: centerText, root_cell_id: rootCenterCellId,
    folder_id: folderId, sort_order: sortOrder,
    created_at: ts, updated_at: ts, synced_at: ts,
    user_id: userId,
  })
  if (mErr) throw mErr

  await importIntoGrid(snapshot, mandalartId, rootCenterCellId, null, 0, true)
  return {
    id: mandalartId, title: centerText, root_cell_id: rootCenterCellId,
    show_checkbox: false, pinned: false, sort_order: sortOrder,
    folder_id: folderId, locked: false, created_at: ts, updated_at: ts, user_id: userId,
  }
}

async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  centerCellId: string,
  parentCellId: string | null,
  sortOrder: number,
  ownsCenter = false,
): Promise<void> {
  const gridId = generateId()
  const ts = now()
  const { error: gErr } = await supabase.from('grids').insert({
    id: gridId, mandalart_id: mandalartId,
    center_cell_id: centerCellId, parent_cell_id: parentCellId,
    sort_order: sortOrder, memo: snapshot.grid.memo ?? null,
    created_at: ts, updated_at: ts, synced_at: ts,
  })
  if (gErr) throw gErr

  const insertedCellIdByPosition = new Map<number, string>()
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    const c = snapshot.cells.find((cc) => cc.position === pos)
    if (pos === CENTER_POSITION) {
      if (ownsCenter) {
        const { error } = await supabase.from('cells').insert({
          id: centerCellId, grid_id: gridId, position: pos,
          text: c?.text ?? '', image_path: c?.image_path ?? null,
          color: c?.color ?? null, done: c?.done ?? false,
          created_at: ts, updated_at: ts, synced_at: ts,
        })
        if (error) throw error
        insertedCellIdByPosition.set(pos, centerCellId)
      }
      continue
    }
    const text = c?.text ?? ''
    const imagePath = c?.image_path ?? null
    const color = c?.color ?? null
    const done = c?.done ?? false
    const isPopulated = text !== '' || imagePath !== null || color !== null || done
    const referencedByChild = snapshot.children.some((child) => child.parentPosition === pos)
    if (!isPopulated && !referencedByChild) continue
    const cellId = generateId()
    const { error } = await supabase.from('cells').insert({
      id: cellId, grid_id: gridId, position: pos,
      text, image_path: imagePath, color, done,
      created_at: ts, updated_at: ts, synced_at: ts,
    })
    if (error) throw error
    insertedCellIdByPosition.set(pos, cellId)
  }

  for (const child of snapshot.children) {
    const parentPos = child.parentPosition
    if (parentPos === undefined || parentPos === null || parentPos === CENTER_POSITION) {
      const newCenterCellId = generateId()
      await importIntoGrid(child, mandalartId, newCenterCellId, parentCellId, child.grid.sort_order, true)
      continue
    }
    const parentCellIdForDrill = insertedCellIdByPosition.get(parentPos)
    if (!parentCellIdForDrill) continue
    await importIntoGrid(child, mandalartId, parentCellIdForDrill, parentCellIdForDrill, child.grid.sort_order, false)
  }
}

export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void> {
  const { data: cellData } = await supabase
    .from('cells')
    .select('grid_id')
    .eq('id', cellId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!cellData) throw new Error('Cell not found')
  const cell = cellData as { grid_id: string }

  const { data: gridData } = await supabase
    .from('grids')
    .select('mandalart_id, center_cell_id')
    .eq('id', cell.grid_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!gridData) throw new Error('Grid not found')
  const grid = gridData as { mandalart_id: string; center_cell_id: string }

  if (grid.center_cell_id === cellId) {
    throw new Error('中心セルにはインポートできません')
  }

  const root = snapshot.cells.find((c) => c.position === CENTER_POSITION)
  if (root && (root.text.trim() || root.image_path || root.color || root.done)) {
    const ts = now()
    await supabase.from('cells').update({
      text: root.text, image_path: root.image_path,
      color: root.color, done: root.done ?? false, updated_at: ts, synced_at: ts,
    }).eq('id', cellId)
  }

  await importIntoGrid(snapshot, grid.mandalart_id, cellId, cellId, 0, false)
}
