import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。クラウド機能は無効化されます。')
}

/**
 * Tauri デスクトップ用 Supabase クライアント
 * - PKCE フロー: OAuth コールバックを deep link で受け取るため
 * - persistSession: localStorage に保存
 * - autoRefreshToken: 期限切れ前に自動更新
 */
export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // deep link 経由で手動 exchange するので無効化
  },
})

export const isSupabaseConfigured = !!(url && anon)
