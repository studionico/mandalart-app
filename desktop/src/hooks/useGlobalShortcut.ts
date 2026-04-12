import { useEffect } from 'react'
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut'
import { getCurrentWindow } from '@tauri-apps/api/window'

const SHORTCUT = 'CommandOrControl+Shift+M'

/**
 * アプリ起動時にグローバルショートカットを登録する。
 * - `⌘/Ctrl + Shift + M`: メインウィンドウを表示/非表示トグル
 */
export function useGlobalShortcut() {
  useEffect(() => {
    let cancelled = false

    async function setup() {
      try {
        // HMR などで二重登録されないように既存を解除してから再登録
        if (await isRegistered(SHORTCUT)) {
          await unregister(SHORTCUT)
        }
        if (cancelled) return

        await register(SHORTCUT, async (event) => {
          // keydown のみ反応（Pressed で重複発火を防ぐ）
          if (event.state !== 'Pressed') return
          const win = getCurrentWindow()
          const visible = await win.isVisible()
          if (visible) {
            await win.hide()
          } else {
            await win.show()
            await win.setFocus()
          }
        })
      } catch (e) {
        console.error('[global-shortcut] failed to register:', e)
      }
    }

    setup()

    return () => {
      cancelled = true
      unregister(SHORTCUT).catch(() => { /* ignore */ })
    }
  }, [])
}
