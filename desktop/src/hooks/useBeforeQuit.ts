import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { supabase } from '@/lib/supabase/client'

/**
 * Tauri の CloseRequested (⌘Q / ウィンドウ close) を検知して、webview が破棄される前に
 * フロント側の外部リソースを proactively 解放する。
 *
 * React の useEffect cleanup は unmount 時に走るが、CloseRequested → webview teardown の
 * 順序によっては cleanup が十分に走らないことがある。特に Supabase realtime の WebSocket
 * は自然切断に任せると dangling しやすいので、ここで明示的に撤去する。
 */
export function useBeforeQuit() {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen('before-quit', () => {
      try {
        supabase.removeAllChannels()
      } catch (e) {
        console.error('[before-quit] removeAllChannels failed:', e)
      }
    }).then((un) => { unlisten = un })
    return () => { unlisten?.() }
  }, [])
}
