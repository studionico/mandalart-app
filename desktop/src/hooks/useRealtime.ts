import { useEffect } from 'react'
// EMERGENCY STOP (2026-05-04): subscribe 経路を停止中だが、復帰時に必要なので import は残す。
import { subscribeRemoteChanges } from '@/lib/realtime'
import { useAuthStore } from '@/store/authStore'
import { SYNC_DEBOUNCE_MS } from '@/constants/timing'

// 緊急停止中の未使用 import 警告 (TS6133) 回避用 reference (復帰時に削除)
void subscribeRemoteChanges

/**
 * 認証済みのときだけ Supabase Realtime を購読し、変更があれば onChange を呼ぶ。
 *
 * Supabase は自分自身の push もエコーバックするため、セル保存 → push → postgres_changes の
 * ループで onChange が連続発火し、UI 側の reload が雪崩を起こす。debounceMs 内に来た
 * burst を 1 回に間引くことで、ドリル中の SQLite 並行クエリ競合を抑える。
 */
export function useRealtime(onChange: () => void, debounceMs = SYNC_DEBOUNCE_MS) {
  const user = useAuthStore((s) => s.user)

  // ⚠️ EMERGENCY STOP (2026-05-04): Supabase Realtime Messages 過剰使用警告のため停止中。
  // EditorLayout で呼ばれる useRealtime と useSync の 2 箇所で並列購読していたのが暴走主因。
  // Dashboard で使用量が止まったことを確認してから段階的に再有効化。復帰時は useSync 側に
  // subscribe 経路を 1 本化し、echo skip を完全実装すること。
  // 詳細: /Users/maro02/.claude/plans/ios-swift-glistening-thacker.md
  // useEffect(() => {
  //   if (!user) return
  //   let pending: ReturnType<typeof setTimeout> | null = null
  //   const unsubscribe = subscribeRemoteChanges(() => {
  //     if (pending) return
  //     pending = setTimeout(() => {
  //       pending = null
  //       onChange()
  //     }, debounceMs)
  //   })
  //   return () => {
  //     if (pending) clearTimeout(pending)
  //     unsubscribe()
  //   }
  // }, [user, onChange, debounceMs])

  // useVisibilityResync が pullAll 完了後に dispatch する `app:sync-pulled` を listen。
  // editor 等で表示中 grid の reload を再発火させる (落とし穴 #22)。
  // 緊急停止中は visibility resync の pullAll もコメントアウトしているので発火しないが、
  // listener は残しておく (= 復帰時の差分最小化、手動同期ボタンの reload 経路としても活用可)。
  useEffect(() => {
    if (!user) return
    const onSyncPulled = () => onChange()
    window.addEventListener('app:sync-pulled', onSyncPulled)
    return () => window.removeEventListener('app:sync-pulled', onSyncPulled)
  }, [user, onChange])

  // 緊急停止中の未使用 import 警告を回避するための ref (削除しないこと、復帰時に必要)
  void debounceMs
}
