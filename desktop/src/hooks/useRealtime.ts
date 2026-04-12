import { useEffect } from 'react'
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'

/**
 * 認証済みのときだけ Supabase Realtime を購読し、変更があれば onChange を呼ぶ。
 * 旧 API (subscribeToCells / subscribeToGrids 個別購読) は廃止され、
 * 単一の subscribeRemoteChanges で全テーブルを購読する。
 */
export function useRealtime(onChange: () => void) {
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    const unsubscribe = subscribeRemoteChanges(onChange)
    return () => { unsubscribe() }
  }, [user, onChange])
}
