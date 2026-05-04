import { useEffect, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAuthStore } from '@/store/authStore'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { pullAll } from '@/lib/sync'
import { adoptOrphanMandalartsToInbox } from '@/lib/api/folders'

const DEBOUNCE_MS = 5000

/**
 * Tauri window が focus を取り戻したときに `pullAll` を発火する保険同期。
 *
 * **背景** (落とし穴 #22): Supabase realtime 購読は本来 `postgres_changes` で他端末からの
 * INSERT / UPDATE / DELETE を即時反映するが、以下のケースで silent drop が起き
 * 取りこぼしが発生する:
 * - macOS で desktop ウィンドウを長時間 hide / sleep 後復帰 (WebSocket 切断の検知漏れ)
 * - ネットワーク断 → 復帰 (auto reconnect の動作が不確実)
 * - auth token 期限切れ (refresh 直後の channel 再 subscribe 漏れ)
 *
 * realtime channel 自体の reconnect 機構を強化するより、**window が focus を取り戻した
 * タイミングで `pullAll` を 1 発打つ** ほうが堅牢で実装が単純。
 *
 * **Tauri 固有**: 通常の `document.visibilitychange` / `window.focus` は WebView 側の
 * イベントで、macOS app の hide/show / activate と連動しない。Tauri の native window
 * API (`getCurrentWindow().onFocusChanged`) を使い、OS レベルの window focus 変化を
 * subscribe する。
 *
 * **重要**: `pullAll()` は SQLite に書き込むだけで React 側の state 更新トリガにはならない。
 * `useSync` の reloadKey や `useRealtime` の onChange を再発火させるため、完了後に
 * カスタム DOM event `app:sync-pulled` を dispatch する。`useSync` / `useRealtime` 側で
 * これを listen して reload を起動する。
 *
 * - 5 秒以内の連続発火は最初の 1 回に丸める
 * - サインイン中 (= `user` あり) かつ `isSupabaseConfigured` のときのみ動作
 * - `pullAll` 失敗時は console.error のみ (UI を中断しない、次回発火で復旧する想定)
 */
export function useVisibilityResync() {
  const user = useAuthStore((s) => s.user)
  const lastRunRef = useRef(0)

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return

    let unlisten: (() => void) | undefined
    let cancelled = false

    const trigger = async (reason: string) => {
      const now = Date.now()
      if (now - lastRunRef.current < DEBOUNCE_MS) {
        console.debug(`[visibility-resync] skipped (debounce): ${reason}`)
        return
      }
      lastRunRef.current = now
      console.debug(`[visibility-resync] pullAll triggered by ${reason}`)
      try {
        const stats = await pullAll()
        // 他デバイス (iOS 等、folder API 未実装) が folder_id=null で push したマンダラートを
        // Inbox に振り分ける。これがないと Dashboard の folder filter でヒットせず宙ぶらりん。
        const adopted = await adoptOrphanMandalartsToInbox()
        console.debug('[visibility-resync] pullAll done:', stats, 'orphans adopted:', adopted)
        window.dispatchEvent(new CustomEvent('app:sync-pulled'))
      } catch (e) {
        console.error('[visibility-resync] pullAll failed:', e)
      }
    }

    // Tauri native window focus event (macOS app hide/show / Cmd+Tab に反応)
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void trigger('tauri:focus')
      })
      .then((u) => {
        if (cancelled) u()
        else unlisten = u
      })
      .catch((e) => {
        console.warn('[visibility-resync] tauri onFocusChanged unavailable:', e)
      })

    // フォールバック: WebView 内の visibilitychange (一部環境で発火する可能性)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void trigger('visibilitychange')
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      unlisten?.()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user])
}
