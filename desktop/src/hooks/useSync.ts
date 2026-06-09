import { useCallback, useEffect, useRef, useState } from 'react'
import { syncAll, type SyncStats } from '@/lib/sync'
import { backfillUploadLocalImages } from '@/lib/api/imageSync'
import { useAuthStore } from '@/store/authStore'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export function useSync() {
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<SyncStats | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const inflight = useRef(false)

  const sync = useCallback(async () => {
    if (!user) return
    if (inflight.current) return
    inflight.current = true
    setStatus('syncing')
    setError(null)
    try {
      const result = await syncAll(user.id)
      setStats(result)
      setLastSync(new Date())
      setStatus('idle')
      setReloadKey((k) => k + 1)
      // ローカルにあるが Storage 未アップロードのセル画像を回収（best-effort、sync 状態に影響しない）
      void backfillUploadLocalImages(user.id)
    } catch (e) {
      // Supabase の error は plain object でも来るので、複数経路で文字列化
      console.error('[sync] error:', e)
      const msg =
        e instanceof Error ? e.message :
        (e && typeof e === 'object' && 'message' in e && (e as { message: unknown }).message)
          ? String((e as { message: unknown }).message) :
        typeof e === 'string' ? e :
        JSON.stringify(e) || 'unknown sync error'
      setError(msg)
      setStatus('error')
    } finally {
      inflight.current = false
    }
  }, [user])

  // 初回サインイン or 起動時にフル同期
  useEffect(() => {
    if (user) sync()
  }, [user, sync])

  // Realtime の購読は持たない: 購読は App レベルの useRealtimeSync に 1 本化されている
  // (落とし穴 #24)。useSync は購読 hook / useVisibilityResync が dispatch する `app:sync-pulled`
  // を listen して reloadKey を bump する reload 経路に徹する。
  // realtime 取りこぼしの保険同期で SQLite に追加された行を UI に反映させるため、
  // reloadKey を bump して dashboard 等の load() を再実行する (落とし穴 #22)。
  useEffect(() => {
    if (!user) return
    const onSyncPulled = () => setReloadKey((k) => k + 1)
    window.addEventListener('app:sync-pulled', onSyncPulled)
    return () => window.removeEventListener('app:sync-pulled', onSyncPulled)
  }, [user])

  return { status, lastSync, error, stats, sync, reloadKey }
}
