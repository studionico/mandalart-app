import { useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/authStore'

/**
 * アプリ起動時に
 *  1. 既存セッションを Supabase から復元
 *  2. onAuthStateChange を購読してストアに反映
 *
 * OAuth コールバックは AuthCallbackPage (/auth/callback) で処理する。
 */
export function useAuthBootstrap() {
  const setSession = useAuthStore((s) => s.setSession)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => { sub.subscription.unsubscribe() }
  }, [setSession, setLoading])
}
