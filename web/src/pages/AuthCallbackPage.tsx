import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'

/**
 * OAuth 認証コールバックページ。
 * Supabase が /auth/callback?code=xxx にリダイレクトしてくるので、
 * code を session に交換してからダッシュボードへ遷移する。
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    async function exchange() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('[auth/callback] exchangeCodeForSession failed:', error)
      }
      navigate('/dashboard', { replace: true })
    }

    void exchange()
  }, [navigate])

  return (
    <div className="flex items-center justify-center h-screen text-sm text-neutral-500">
      認証中...
    </div>
  )
}
