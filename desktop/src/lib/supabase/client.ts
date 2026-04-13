import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = !!(url && anon)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。' +
    'クラウド機能（サインイン・同期）は無効化されます。',
  )
}

/**
 * Tauri デスクトップ用 Supabase クライアント
 * - PKCE フロー: OAuth コールバックを deep link で受け取るため
 * - persistSession: localStorage に保存
 * - autoRefreshToken: 期限切れ前に自動更新
 *
 * 環境変数が未設定でもモジュール読み込み時にクラッシュしないよう、
 * ダミー URL でクライアントを作成する。実際の機能呼び出しは
 * `isSupabaseConfigured` でガードされる。
 */
export const supabase = createClient(
  url || 'https://missing.supabase.local',
  anon || 'missing-anon-key',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // deep link 経由で手動 exchange するので無効化
    },
  },
)
