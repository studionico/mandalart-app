import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/authStore'
import { handleDeepLink } from '@/lib/api/auth'

/**
 * アプリ起動時に
 *  1. 既存セッションを Supabase から復元
 *  2. onAuthStateChange を購読してストアに反映
 *  3. tauri-plugin-deep-link 経由の OAuth コールバックをハンドル
 */
export function useAuthBootstrap() {
  const setSession = useAuthStore((s) => s.setSession)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    let unlistenDeepLink: (() => void) | undefined

    async function init() {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
      setLoading(false)
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    // Deep link listener: アプリが既に起動中に OAuth から戻ってきた場合
    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl, getCurrent }) => {
      onOpenUrl((urls) => {
        for (const u of urls) handleDeepLink(u)
      }).then((u) => { unlistenDeepLink = u })

      // アプリが OAuth コールバックで起動された場合は getCurrent から取れる
      getCurrent().then((urls) => {
        if (urls) {
          for (const u of urls) handleDeepLink(u)
        }
      }).catch(() => { /* not launched via deep link */ })
    }).catch((e) => {
      console.warn('[auth] deep-link plugin unavailable:', e)
    })

    return () => {
      sub.subscription.unsubscribe()
      unlistenDeepLink?.()
    }
  }, [setSession, setLoading])
}
