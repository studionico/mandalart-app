import { useEffect, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: Update }
  | { kind: 'none' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'installed' }
  | { kind: 'error'; message: string }

/**
 * 起動時に Tauri updater で新バージョンをチェックする。
 * - pubkey / endpoints の設定前は check() が例外を投げるので
 *   try/catch で握りつぶし、UI には何も出さない
 * - 新バージョンがあれば UpdateDialog を表示、ユーザー操作でインストール
 */
export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false

    async function run() {
      setStatus({ kind: 'checking' })
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (cancelled) return
        if (update) {
          setStatus({ kind: 'available', update })
        } else {
          setStatus({ kind: 'none' })
        }
      } catch (e) {
        // 設定未完了（pubkey 未設定 / エンドポイント未公開等）は
        // 開発初期フェーズで当たり前に起こるので警告に留める
        console.warn('[updater] check failed:', e)
        if (!cancelled) setStatus({ kind: 'error', message: (e as Error).message })
      }
    }

    run()
    return () => { cancelled = true }
  }, [])

  async function downloadAndInstall() {
    if (status.kind !== 'available') return
    const update = status.update
    try {
      setStatus({ kind: 'downloading', progress: 0 })
      let downloaded = 0
      let total = 0
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0
          setStatus({ kind: 'downloading', progress: pct })
        } else if (event.event === 'Finished') {
          setStatus({ kind: 'installed' })
        }
      })
      // macOS/Linux はアプリ再起動が必要（Windows は自動）
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  function dismiss() {
    setStatus({ kind: 'idle' })
  }

  return { status, downloadAndInstall, dismiss }
}
