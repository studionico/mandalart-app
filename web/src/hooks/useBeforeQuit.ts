import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * ページアンロード前に Supabase realtime チャネルを明示解放する。
 */
export function useBeforeQuit() {
  useEffect(() => {
    const onUnload = () => {
      try {
        supabase.removeAllChannels()
      } catch (e) {
        console.error('[before-quit] removeAllChannels failed:', e)
      }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])
}
