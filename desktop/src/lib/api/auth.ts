import { supabase } from '@/lib/supabase/client'
import { openUrl } from '@tauri-apps/plugin-opener'

const REDIRECT_URI = 'mandalart://auth/callback'

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: REDIRECT_URI },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

/**
 * OAuth ログイン (Google / GitHub)
 * - skipBrowserRedirect で URL を取得
 * - tauri-plugin-opener でシステムブラウザを開く
 * - ユーザーが認証 → mandalart://auth/callback?code=xxx に redirect
 * - tauri-plugin-deep-link が URL を捕捉 → handleDeepLink で exchange
 */
export async function signInWithOAuth(provider: 'google' | 'github') {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: REDIRECT_URI,
      skipBrowserRedirect: true,
    },
  })
  if (error) return { error }
  if (!data.url) return { error: new Error('OAuth URL was not generated') }
  await openUrl(data.url)
  return { error: null }
}

/**
 * deep link で受け取った OAuth コールバック URL を処理し、code をセッションに変換する
 */
export async function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code')
    if (!code) return
    await supabase.auth.exchangeCodeForSession(code)
  } catch (e) {
    console.error('[auth] handleDeepLink failed:', e)
  }
}
