import { supabase, isSupabaseConfigured } from '../supabase/client'
import { generateId, now } from '@/lib/utils/id'
import type { Folder } from '../../types'

function synced(): string {
  return now()
}

export async function getFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Folder[]
}

export async function createFolder(name: string): Promise<Folder> {
  const id = generateId()
  const ts = now()
  const s = synced()
  const { data: existing } = await supabase
    .from('folders')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
  const maxSort = ((existing ?? []) as { sort_order: number }[])[0]?.sort_order ?? -1
  const sortOrder = maxSort + 1

  const { data, error } = await supabase.from('folders').insert({
    id, name, sort_order: sortOrder, is_system: false,
    created_at: ts, updated_at: ts, synced_at: s,
  }).select().single()
  if (error) throw error
  return data as unknown as Folder
}

export async function updateFolderName(id: string, name: string): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('folders').update({ name, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function updateFolderSortOrder(id: string, sortOrder: number): Promise<void> {
  const ts = now()
  const { error } = await supabase.from('folders').update({ sort_order: sortOrder, updated_at: ts, synced_at: ts }).eq('id', id)
  if (error) throw error
}

export async function deleteFolder(id: string): Promise<void> {
  const { data: target } = await supabase.from('folders').select('is_system').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!target) return
  if ((target as { is_system: boolean }).is_system) {
    throw new Error('Inbox など system folder は削除できません')
  }

  const inboxId = await ensureInboxFolder()
  const ts = now()
  await supabase.from('mandalarts').update({ folder_id: inboxId, updated_at: ts, synced_at: ts }).eq('folder_id', id)

  if (!isSupabaseConfigured) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.from('folders').delete().eq('id', id)
}

export async function cleanupSoftDeletedFolders(): Promise<{ localDeleted: number; cloudDeleted: number }> {
  if (!isSupabaseConfigured) return { localDeleted: 0, cloudDeleted: 0 }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { localDeleted: 0, cloudDeleted: 0 }

  try {
    const { data, error } = await supabase.from('folders').select('id').not('deleted_at', 'is', null)
    if (error) throw error
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return { localDeleted: 0, cloudDeleted: 0 }
    await supabase.from('folders').delete().in('id', ids)
    return { localDeleted: 0, cloudDeleted: ids.length }
  } catch (e) {
    console.warn('[cleanupSoftDeletedFolders] failed:', e)
    return { localDeleted: 0, cloudDeleted: 0 }
  }
}

export function ensureInboxFolder(): Promise<string> {
  if (!inboxBootstrapPromise) {
    inboxBootstrapPromise = doEnsureInboxFolder().catch((e) => {
      inboxBootstrapPromise = null
      throw e
    })
  }
  return inboxBootstrapPromise
}

let inboxBootstrapPromise: Promise<string> | null = null

export function _resetInboxBootstrap(): void {
  inboxBootstrapPromise = null
}

export async function adoptOrphanMandalartsToInbox(): Promise<number> {
  const inboxId = await ensureInboxFolder()
  const { data: orphans } = await supabase
    .from('mandalarts')
    .select('id')
    .is('folder_id', null)
    .is('deleted_at', null)
  if (!orphans || orphans.length === 0) return 0
  const ts = now()
  await supabase.from('mandalarts').update({ folder_id: inboxId, updated_at: ts, synced_at: ts }).is('folder_id', null).is('deleted_at', null)
  return orphans.length
}

async function doEnsureInboxFolder(): Promise<string> {
  const { data: all } = await supabase
    .from('folders')
    .select('id')
    .eq('is_system', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  const systemFolders = (all ?? []) as { id: string }[]
  let inboxId: string

  if (systemFolders.length > 0) {
    inboxId = systemFolders[0].id
    if (systemFolders.length > 1) {
      const dupIds = systemFolders.slice(1).map((f) => f.id)
      const ts = now()
      await supabase.from('mandalarts').update({ folder_id: inboxId, updated_at: ts, synced_at: ts }).in('folder_id', dupIds)
      await supabase.from('folders').delete().in('id', dupIds)
    }
  } else {
    inboxId = generateId()
    const ts = now()
    const s = synced()
    const { error } = await supabase.from('folders').insert({
      id: inboxId, name: 'Inbox', sort_order: 0, is_system: true,
      created_at: ts, updated_at: ts, synced_at: s,
    })
    if (error) throw error
  }

  const ts = now()
  await supabase.from('mandalarts').update({ folder_id: inboxId, updated_at: ts, synced_at: ts }).is('folder_id', null).is('deleted_at', null)
  return inboxId
}
