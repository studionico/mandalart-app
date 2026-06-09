import { useEffect } from 'react'
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'
import { SYNC_DEBOUNCE_MS } from '@/constants/timing'

/**
 * Supabase Realtime を **App 全体で 1 本だけ** 購読する hook。
 *
 * **背景** (落とし穴 #24): かつて `useSync` (DashboardPage) と `useRealtime` (EditorLayout) の
 * 2 箇所で `subscribeRemoteChanges` を呼んでおり、1 user に対して複数 channel が並列購読される
 * → 1 push で channel 数ぶんの messages を受信し、Realtime Messages quota を約 5 倍超過した。
 *
 * **対策**: 購読責務を本 hook 1 箇所に集約し、[`App.tsx`](../App.tsx) でマウントする。
 * `useSync` / `useRealtime` は購読を持たず、本 hook が dispatch する `app:sync-pulled` を
 * listen して各画面の reload (Dashboard の reloadKey / Editor の reload+reloadSubGrids) を
 * 起動する。これで「画面に依らず購読は常時 1 本」を保ちつつ既存の reload 配線を再利用できる。
 *
 * echo skip (自分の push のエコー判定) は [`realtime.ts`](../lib/realtime.ts) 側で content 比較
 * 済み。`subscribeRemoteChanges` の onChange は **content が実際に変わった (= 他デバイスの編集)**
 * ときだけ呼ばれるので、本 hook はそれを `SYNC_DEBOUNCE_MS` で間引いて 1 回の reload にまとめる。
 */
export function useRealtimeSync() {
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    let pending: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeRemoteChanges(() => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        window.dispatchEvent(new CustomEvent('app:sync-pulled'))
      }, SYNC_DEBOUNCE_MS)
    })
    return () => {
      if (pending) clearTimeout(pending)
      unsubscribe()
    }
  }, [user])
}
