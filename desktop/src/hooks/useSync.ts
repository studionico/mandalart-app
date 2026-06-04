import { useCallback, useEffect, useRef, useState } from 'react'
import { syncAll, type SyncStats } from '@/lib/sync'
import { backfillUploadLocalImages } from '@/lib/api/imageSync'
// EMERGENCY STOP (2026-05-04): subscribe 経路を停止中だが、復帰時に必要なので import は残す。
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'
import { useVaultStore } from '@/store/vaultStore'
import { SYNC_DEBOUNCE_MS } from '@/constants/timing'

// 緊急停止中の未使用 import 警告 (TS6133) 回避用 reference (復帰時に削除)
void subscribeRemoteChanges
void SYNC_DEBOUNCE_MS

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export function useSync() {
  const user = useAuthStore((s) => s.user)
  // vaultMode ON のときは Supabase 同期を完全オフ (vault が正なので pull が DB を上書きする衝突を防ぐ)。
  const vaultMode = useVaultStore((s) => s.vaultMode)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<SyncStats | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const inflight = useRef(false)

  const sync = useCallback(async () => {
    if (!user) return
    if (vaultMode) return // vaultMode 中はクラウド同期しない (手動経路が残っても発火させない防御)
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
  }, [user, vaultMode])

  // 初回サインイン or 起動時にフル同期 (vaultMode 中は走らせない)
  useEffect(() => {
    if (user && !vaultMode) sync()
  }, [user, vaultMode, sync])

  // ⚠️ EMERGENCY STOP (2026-05-04): Supabase Realtime Messages 過剰使用警告のため停止中。
  // useSync と useRealtime (EditorLayout) の 2 箇所で subscribeRemoteChanges を呼んでおり、
  // 1 user に対して 2 channels が並列購読 → 1 push で 2 倍の messages を受信していた。
  // Dashboard で使用量が止まったことを確認してから段階的に再有効化。復帰時は subscribe 経路を
  // 1 本に統合し、echo skip ロジックを完全実装すること。**かつ vaultMode 中は購読しないこと**
  // (P4: vaultMode はクラウド同期を完全オフにする)。
  // 詳細: /Users/maro02/.claude/plans/ios-swift-glistening-thacker.md
  // useEffect(() => {
  //   if (!user) return
  //   let pending: ReturnType<typeof setTimeout> | null = null
  //   const unsubscribe = subscribeRemoteChanges(() => {
  //     if (pending) return
  //     pending = setTimeout(() => {
  //       pending = null
  //       setReloadKey((k) => k + 1)
  //     }, SYNC_DEBOUNCE_MS)
  //   })
  //   return () => {
  //     if (pending) clearTimeout(pending)
  //     unsubscribe()
  //   }
  // }, [user])

  // useVisibilityResync が pullAll 完了後に dispatch する `app:sync-pulled` を listen。
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
