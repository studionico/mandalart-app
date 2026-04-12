import { createClient } from '@/lib/supabase/client'

export async function signUp(email: string, password: string) {
  const supabase = createClient()
  return supabase.auth.signUp({ email, password })
}

export async function signIn(email: string, password: string) {
  const supabase = createClient()
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signInWithGoogle() {
  const supabase = createClient()
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/api/auth/callback` },
  })
}

export async function signInWithGitHub() {
  const supabase = createClient()
  return supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${location.origin}/api/auth/callback` },
  })
}

export async function signOut() {
  const supabase = createClient()
  return supabase.auth.signOut()
}

export async function getSession() {
  const supabase = createClient()
  return supabase.auth.getSession()
}
