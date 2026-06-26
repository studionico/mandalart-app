import { supabase, isSupabaseConfigured } from '../supabase/client'
import { generateId, now } from '@/lib/utils/id'
import { CENTER_POSITION } from '@/constants/grid'
import { pasteFromStock } from './stock'
import type { Mandalart } from '../../types'

function synced(): string {
  return now()
}

export async function getMandalarts(folderId?: string): Promise<Mandalart[]> {
  let q = supabase
    .from('mandalarts')
    .select('*')
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (folderId) {
    q = q.eq('folder_id', folderId)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as Mandalart[]
}

export async function getMandalart(id: string): Promise<Mandalart | null> {
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as unknown as Mandalart | null
}

export async function nextTopSortOrder(folderId: string): Promise<number> {
  const { data } = await supabase
    .from('mandalarts')
    .select('sort_order')
    .eq('folder_id', folderId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .limit(1)
  const min = (data?.[0] as { sort_order: number | null } | undefined)?.sort_order
  return (min ?? 0) - 1
}

export async function createMandalart(title = '', folderId?: string | null): Promise<Mandalart> {
  const mandalartId = generateId()
  const rootGridId = generateId()
  const rootCenterCellId = generateId()
  const ts = now()
  const s = synced()

  const sortOrder = folderId ? await nextTopSortOrder(folderId) : null

  const { error: eM } = await supabase.from('mandalarts').insert({
    id: mandalartId, title, root_cell_id: rootCenterCellId,
    folder_id: folderId ?? null, sort_order: sortOrder,
    created_at: ts, updated_at: ts, synced_at: s,
  })
  if (eM) throw eM

  const { error: eG } = await supabase.from('grids').insert({
    id: rootGridId, mandalart_id: mandalartId, center_cell_id: rootCenterCellId,
    parent_cell_id: null, sort_order: 0,
    created_at: ts, updated_at: ts, synced_at: s,
  })
  if (eG) throw eG

  const { error: eC } = await supabase.from('cells').insert({
    id: rootCenterCellId, grid_id: rootGridId, position: CENTER_POSITION, text: '',
    created_at: ts, updated_at: ts, synced_at: s,
  })
  if (eC) throw eC

  return {
    id: mandalartId, title, root_cell_id: rootCenterCellId,
    show_checkbox: false, last_grid_id: null, sort_order: sortOrder,
    pinned: false, folder_id: folderId ?? null, locked: false,
    created_at: ts, updated_at: ts, user_id: '',
  }
}

export async function updateMandalartTitle(id: string, title: string): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ title, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function updateMandalartShowCheckbox(id: string, show: boolean): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ show_checkbox: show, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function updateMandalartPinned(id: string, pinned: boolean): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ pinned, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function updateMandalartLocked(id: string, locked: boolean): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ locked, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function updateMandalartSortOrder(id: string, sortOrder: number): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ sort_order: sortOrder, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function reorderMandalarts(orderedIds: string[]): Promise<void> {
  const ts = now()
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('mandalarts').update({ sort_order: i, updated_at: ts, synced_at: ts }).eq('id', id),
    ),
  )
}

export async function updateMandalartFolderId(id: string, folderId: string): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ folder_id: folderId, sort_order: null, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function createMandalartFromStockItem(stockItemId: string, folderId?: string | null): Promise<Mandalart> {
  const m = await createMandalart('', folderId)
  await pasteFromStock(stockItemId, m.root_cell_id)
  return (await getMandalart(m.id)) ?? m
}

export async function updateMandalartLastGridId(id: string, lastGridId: string | null): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('mandalarts').update({ last_grid_id: lastGridId, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function deleteMandalart(id: string): Promise<void> {
  const ts = now()
  const { data: grids } = await supabase.from('grids').select('id').eq('mandalart_id', id).is('deleted_at', null)
  const gridIds = ((grids ?? []) as { id: string }[]).map((g) => g.id)
  if (gridIds.length > 0) {
    await supabase.from('cells').update({ deleted_at: ts, updated_at: ts }).in('grid_id', gridIds).is('deleted_at', null)
  }
  await supabase.from('grids').update({ deleted_at: ts, updated_at: ts }).eq('mandalart_id', id).is('deleted_at', null)
  await supabase.from('mandalarts').update({ deleted_at: ts, updated_at: ts }).eq('id', id).is('deleted_at', null)
}

export async function getDeletedMandalarts(): Promise<Mandalart[]> {
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Mandalart[]
}

export async function restoreMandalart(id: string): Promise<void> {
  const ts = now()
  const { data: grids } = await supabase.from('grids').select('id').eq('mandalart_id', id)
  const gridIds = ((grids ?? []) as { id: string }[]).map((g) => g.id)
  if (gridIds.length > 0) {
    await supabase.from('cells').update({ deleted_at: null, updated_at: ts }).in('grid_id', gridIds)
  }
  await supabase.from('grids').update({ deleted_at: null, updated_at: ts }).eq('mandalart_id', id)
  await supabase.from('mandalarts').update({ deleted_at: null, updated_at: ts }).eq('id', id)
}

export async function permanentDeleteMandalart(id: string): Promise<void> {
  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const { data: m } = await supabase.from('mandalarts').select('locked').eq('id', id).maybeSingle()
  if ((m as { locked?: boolean } | null)?.locked) {
    console.warn('[permanentDelete] skipped: mandalart is locked', id)
    return
  }

  const { data: cloudGrids } = await supabase.from('grids').select('id').eq('mandalart_id', id)
  const gridIds = ((cloudGrids ?? []) as { id: string }[]).map((g) => g.id)
  if (gridIds.length > 0) {
    await supabase.from('cells').delete().in('grid_id', gridIds)
  }
  await supabase.from('grids').delete().eq('mandalart_id', id)
  await supabase.from('mandalarts').delete().eq('id', id)
}

export async function searchMandalarts(q: string): Promise<Mandalart[]> {
  const trimmed = q.trim()
  if (!trimmed) return getMandalarts()
  const { data, error } = await supabase
    .from('mandalarts')
    .select('*')
    .is('deleted_at', null)
    .ilike('title', `%${trimmed}%`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Mandalart[]
}

export async function duplicateMandalart(sourceId: string): Promise<Mandalart> {
  const src = await getMandalart(sourceId)
  if (!src) throw new Error(`Mandalart not found: ${sourceId}`)

  const newMandalartId = generateId()
  const ts = now()
  const s = synced()

  const cellIdMap = new Map<string, string>()
  const gridIdMap = new Map<string, string>()

  const { data: allGridsData } = await supabase
    .from('grids')
    .select('id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo')
    .eq('mandalart_id', sourceId)
    .is('deleted_at', null)
  const allGrids = (allGridsData ?? []) as Array<{ id: string; mandalart_id: string; center_cell_id: string; parent_cell_id: string | null; sort_order: number; memo: string | null }>

  const gridIds = allGrids.map((g) => g.id)
  let allCells: Array<{ id: string; grid_id: string; position: number; text: string; image_path: string | null; color: string | null; done: boolean }> = []
  if (gridIds.length > 0) {
    const { data: cellsData } = await supabase
      .from('cells')
      .select('id, grid_id, position, text, image_path, color, done')
      .in('grid_id', gridIds)
      .is('deleted_at', null)
    allCells = (cellsData ?? []) as typeof allCells
  }

  for (const c of allCells) cellIdMap.set(c.id, generateId())
  for (const g of allGrids) gridIdMap.set(g.id, generateId())

  const newRootCellId = cellIdMap.get(src.root_cell_id)
  if (!newRootCellId) throw new Error(`root_cell_id not found: ${src.root_cell_id}`)

  const sortOrder = src.folder_id ? await nextTopSortOrder(src.folder_id) : null
  const { error: eMErr } = await supabase.from('mandalarts').insert({
    id: newMandalartId, title: src.title, root_cell_id: newRootCellId,
    show_checkbox: src.show_checkbox, folder_id: src.folder_id ?? null,
    sort_order: sortOrder, locked: src.locked,
    created_at: ts, updated_at: ts, synced_at: s,
  })
  if (eMErr) throw eMErr

  for (const g of allGrids) {
    const newGridId = gridIdMap.get(g.id)!
    const newCenterCellId = cellIdMap.get(g.center_cell_id)
    if (!newCenterCellId) throw new Error(`Grid ${g.id} orphan center_cell_id`)
    const newParentCellId = g.parent_cell_id == null ? null : cellIdMap.get(g.parent_cell_id) ?? null
    const { error: eGErr } = await supabase.from('grids').insert({
      id: newGridId, mandalart_id: newMandalartId,
      center_cell_id: newCenterCellId, parent_cell_id: newParentCellId,
      sort_order: g.sort_order, memo: g.memo,
      created_at: ts, updated_at: ts, synced_at: s,
    })
    if (eGErr) throw eGErr
  }

  const newCenterCellIdSet = new Set(
    allGrids.map((g) => cellIdMap.get(g.center_cell_id)).filter((v): v is string => v != null),
  )
  const cellsToInsert = []
  for (const c of allCells) {
    const newCellId = cellIdMap.get(c.id)!
    const newGridId = gridIdMap.get(c.grid_id)!
    const isPopulated = c.text !== '' || c.image_path !== null || c.color !== null
    const isReferenced = newCenterCellIdSet.has(newCellId)
    if (!isPopulated && !isReferenced) continue
    cellsToInsert.push({
      id: newCellId, grid_id: newGridId, position: c.position,
      text: c.text, image_path: c.image_path, color: c.color, done: c.done,
      created_at: ts, updated_at: ts, synced_at: s,
    })
  }
  if (cellsToInsert.length > 0) {
    const { error: eCErr } = await supabase.from('cells').insert(cellsToInsert)
    if (eCErr) throw eCErr
  }

  return {
    id: newMandalartId, title: src.title, root_cell_id: newRootCellId,
    show_checkbox: src.show_checkbox, last_grid_id: null, sort_order: sortOrder,
    pinned: false, folder_id: src.folder_id ?? null, locked: src.locked,
    created_at: ts, updated_at: ts, user_id: '',
  }
}
