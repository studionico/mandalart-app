import { useCallback, useEffect, useRef, useState } from 'react'
import { syncAll, type SyncStats } from '@/lib/sync'
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'
import { SYNC_DEBOUNCE_MS } from '@/constants/timing'

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

  // Realtime subscription (サインイン中のみ)
  // 自分自身の push による postgres_changes イベントも戻ってくるので、
  // 連続発火を SYNC_DEBOUNCE_MS 内で 1 回に間引いて reloadKey の雪崩を防ぐ。
  useEffect(() => {
    if (!user) return
    let pending: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeRemoteChanges(() => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        setReloadKey((k) => k + 1)
      }, SYNC_DEBOUNCE_MS)
    })
    return () => {
      if (pending) clearTimeout(pending)
      unsubscribe()
    }
  }, [user])

  return { status, lastSync, error, stats, sync, reloadKey }
}
