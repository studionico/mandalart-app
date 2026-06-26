import { supabase } from '@/lib/supabase/client'
import { useEditorStore } from '@/store/editorStore'
import type { Mandalart } from '@/types'

/**
 * Supabase Realtime: 別デバイスでの変更を購読する (web 版)。
 *
 * web 版はローカル SQLite を持たないため、変更が届いたら onChange() を呼ぶだけでよい。
 * 各コンポーネントは `app:sync-pulled` イベントを受けて Supabase から再フェッチする。
 *
 * 注: ES256 JWT 移行後 postgres_changes が配信不達になるケースあり (CLAUDE.md 参照)。
 * その場合 heartbeat のみで quota への影響は無視できる。
 */
export function subscribeRemoteChanges(onChange: () => void): () => void {
  const channel = supabase.channel('mandalart-sync')

  const tables = ['folders', 'mandalarts', 'grids', 'cells'] as const
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      // currentMandalart が削除されたらクリア
      if (table === 'mandalarts' && payload.eventType === 'DELETE') {
        const id = (payload.old as { id?: string }).id
        const current = useEditorStore.getState().currentMandalart
        if (id && current?.id === id) {
          useEditorStore.getState().setCurrentMandalart(null)
        }
      }
      if (table === 'mandalarts' && payload.eventType !== 'DELETE') {
        const m = payload.new as Partial<Mandalart>
        const current = useEditorStore.getState().currentMandalart
        if (m.id && current?.id === m.id) {
          useEditorStore.getState().setCurrentMandalart({ ...current, ...m } as Mandalart)
        }
      }
      onChange()
    })
  }

  channel.subscribe()
  return () => { supabase.removeChannel(channel) }
}

// 互換性のために export (useRealtimeSync.ts が直接インポートしている場合)
export async function applyMandalartChange(_payload: unknown): Promise<boolean> { return false }
export async function applyFolderChange(_payload: unknown): Promise<boolean> { return false }
export async function applyGridChange(_payload: unknown): Promise<boolean> { return false }
export async function applyCellChange(_payload: unknown): Promise<boolean> { return false }
