import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { adoptOrphanMandalartsToInbox } from '@/lib/api/folders'

const DEBOUNCE_MS = 5000

/**
 * タブが前面に戻ったとき (visibilitychange / window.focus) に `app:sync-pulled` を
 * dispatch して UI リフレッシュをトリガする。
 *
 * web 版に local SQLite + pullAll は存在しないため、Supabase への再フェッチは
 * `app:sync-pulled` を受信した各コンポーネントが自身で行う。
 * orphan mandalart の inbox 自動振り分けはここで引き続き実行する。
 */
export function useVisibilityResync() {
  const user = useAuthStore((s) => s.user)
  const lastRunRef = useRef(0)

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return

    const trigger = async (reason: string) => {
      const now = Date.now()
      if (now - lastRunRef.current < DEBOUNCE_MS) {
        console.debug(`[visibility-resync] skipped (debounce): ${reason}`)
        return
      }
      lastRunRef.current = now
      try {
        const adopted = await adoptOrphanMandalartsToInbox()
        console.debug('[visibility-resync] done, orphans adopted:', adopted)
        window.dispatchEvent(new CustomEvent('app:sync-pulled'))
      } catch (e) {
        console.error('[visibility-resync] failed:', e)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void trigger('visibilitychange')
    }
    const onFocus = () => void trigger('window:focus')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [user])
}
