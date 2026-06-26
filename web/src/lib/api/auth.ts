import { supabase } from '@/lib/supabase/client'

export function getAuthCallbackUrl(): string {
  return `${window.location.origin}/auth/callback`
}

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
    options: { emailRedirectTo: getAuthCallbackUrl() },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function signInWithOAuth(provider: 'google' | 'github') {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: getAuthCallbackUrl() },
  })
  if (error) return { error }
  return { error: null }
}
