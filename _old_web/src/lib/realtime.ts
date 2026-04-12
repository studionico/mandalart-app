import { createClient } from '@/lib/supabase/client'
import type { Cell, Grid } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function subscribeToCells(
  mandalartId: string,
  onUpdate: (cell: Cell) => void,
  onInsert: (cell: Cell) => void,
  onDelete: (cellId: string) => void,
): RealtimeChannel {
  const supabase = createClient()
  return supabase
    .channel(`cells:${mandalartId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'cells' },
      (payload) => onUpdate(payload.new as Cell),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'cells' },
      (payload) => onInsert(payload.new as Cell),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'cells' },
      (payload) => onDelete((payload.old as Cell).id),
    )
    .subscribe()
}

export function subscribeToGrids(
  mandalartId: string,
  onChange: (grid: Grid) => void,
): RealtimeChannel {
  const supabase = createClient()
  return supabase
    .channel(`grids:${mandalartId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'grids' },
      (payload) => onChange(payload.new as Grid),
    )
    .subscribe()
}

export function unsubscribe(channel: RealtimeChannel): void {
  const supabase = createClient()
  supabase.removeChannel(channel)
}
