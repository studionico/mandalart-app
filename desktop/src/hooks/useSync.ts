import { useCallback, useEffect, useRef, useState } from 'react'
import { syncAll, type SyncStats } from '@/lib/sync'
import { subscribeRemoteChanges } from '@/lib/realtime'
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
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    } finally {
      inflight.current = false
    }
  }, [user])

  // 初回サインイン or 起動時にフル同期
  useEffect(() => {
    if (user) sync()
  }, [user, sync])

  // Realtime subscription (サインイン中のみ)
  useEffect(() => {
    if (!user) return
    const unsubscribe = subscribeRemoteChanges(() => {
      setReloadKey((k) => k + 1)
    })
    return () => { unsubscribe() }
  }, [user])

  return { status, lastSync, error, stats, sync, reloadKey }
}
