import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEYS } from '@/constants/storage'
import { WELCOME_VERSION } from '@/constants/welcome'

/**
 * 初回起動 / WELCOME_VERSION bump 時に「Welcome モーダルを出すべきか」を判定する hook。
 *
 * 動作 (既存 [`useCloudFoldersCleanup`](./useCloudFoldersCleanup.ts) の version-bump pattern と同じ):
 * - mount 時に `localStorage.welcomeSeenVersion` を読み、現行 `WELCOME_VERSION` と比較
 * - 異なる (= 未表示 / bump 済) なら `shouldShow = true` を返す
 * - user が「次回以降表示しない」を check して close したら `dismiss(true)` を呼んで
 *   localStorage に現行 version を保存。次回以降は `shouldShow = false`
 * - check せず close した場合は `dismiss(false)` を呼ぶ。localStorage は更新されない
 *   ので、次回起動時に再度 `shouldShow = true` で表示される
 *
 * `WELCOME_VERSION` を bump すると全 user で 1 回だけ再表示される (新機能告知 / welcome
 * 内容の刷新時に使う)。
 *
 * App ルートで 1 度だけ呼び出す。
 */
export function useWelcomeOnFirstRun(): {
  shouldShow: boolean
  dismiss: (persist: boolean) => void
} {
  const [shouldShow, setShouldShow] = useState<boolean>(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEYS.welcomeSeenVersion) ?? 0)
      return stored < WELCOME_VERSION
    } catch {
      // localStorage 不可な環境 (private mode 等) でもクラッシュさせず、welcome 未表示とする
      return false
    }
  })

  // mount 時に再評価 (StrictMode の二重 effect / hot reload 後の状態ズレ対策)
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEYS.welcomeSeenVersion) ?? 0)
      setShouldShow(stored < WELCOME_VERSION)
    } catch {
      setShouldShow(false)
    }
  }, [])

  const dismiss = useCallback((persist: boolean) => {
    setShouldShow(false)
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEYS.welcomeSeenVersion, String(WELCOME_VERSION))
      } catch {
        /* noop */
      }
    }
  }, [])

  return { shouldShow, dismiss }
}
