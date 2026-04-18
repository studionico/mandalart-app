import { useEffect } from 'react'
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'
import { SYNC_DEBOUNCE_MS } from '@/constants/timing'

/**
 * 認証済みのときだけ Supabase Realtime を購読し、変更があれば onChange を呼ぶ。
 *
 * Supabase は自分自身の push もエコーバックするため、セル保存 → push → postgres_changes の
 * ループで onChange が連続発火し、UI 側の reload が雪崩を起こす。debounceMs 内に来た
 * burst を 1 回に間引くことで、ドリル中の SQLite 並行クエリ競合を抑える。
 */
export function useRealtime(onChange: () => void, debounceMs = SYNC_DEBOUNCE_MS) {
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    let pending: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeRemoteChanges(() => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        onChange()
      }, debounceMs)
    })
    return () => {
      if (pending) clearTimeout(pending)
      unsubscribe()
    }
  }, [user, onChange, debounceMs])
}
