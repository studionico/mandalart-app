import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * `app:sync-pulled` を listen して、別デバイスの変更が来たときに onChange を呼ぶ hook。
 *
 * **購読は持たない**: Supabase Realtime の購読は App レベルの [`useRealtimeSync`](./useRealtimeSync.ts)
 * に 1 本化されている (落とし穴 #24: かつて useSync と本 hook の 2 箇所で並列購読し Realtime
 * Messages quota を約 5 倍超過した)。本 hook は購読 hook が dispatch する `app:sync-pulled`
 * (realtime 受信 / visibility resync の pullAll 完了) を受けて、EditorLayout の reload を再発火
 * させる reload 経路に徹する。
 */
export function useRealtime(onChange: () => void) {
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    const onSyncPulled = () => onChange()
    window.addEventListener('app:sync-pulled', onSyncPulled)
    return () => window.removeEventListener('app:sync-pulled', onSyncPulled)
  }, [user, onChange])
}
