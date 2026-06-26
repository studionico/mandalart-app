import { useEffect } from 'react'
import { cleanupSoftDeletedFolders } from '@/lib/api/folders'
import { STORAGE_KEYS } from '@/constants/storage'

/**
 * 旧 `deleteFolder` が `syncAwareDelete` 経由で残した cloud の deleted_at 付き folder 行を
 * 「アプリのバージョンアップ時に一度だけ」掃除する。
 *
 * 経緯: フォルダにはゴミ箱 / 復元 UI が無いのに soft delete (deleted_at セット) が
 * cloud に滞留していた。`deleteFolder` を hard delete 両側に変更したので新規発生は
 * 止まるが、既に残ってしまった行はこの hook が起動時 1 回だけ掃除する。
 *
 * 動作 ([`useCloudEmptyCellsCleanup`](useCloudEmptyCellsCleanup.ts) と同じ pattern):
 * - localStorage の `foldersCleanupVersion` を参照し、現行版より古ければ 1 回 cleanup を実行
 * - 完了後 localStorage を更新 → 以降この version では走らない
 * - 失敗時は version を更新せず、次回起動でリトライ
 *
 * App ルートで 1 度だけ呼び出す。
 */
const FOLDERS_CLEANUP_VERSION = 1

export function useCloudFoldersCleanup(): void {
  useEffect(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEYS.foldersCleanupVersion) ?? 0)
    if (stored >= FOLDERS_CLEANUP_VERSION) return

    let cancelled = false
    cleanupSoftDeletedFolders()
      .then((result) => {
        if (cancelled) return
        localStorage.setItem(STORAGE_KEYS.foldersCleanupVersion, String(FOLDERS_CLEANUP_VERSION))
        if (result.localDeleted > 0 || result.cloudDeleted > 0) {
          console.log(
            `[folders-cleanup] v${FOLDERS_CLEANUP_VERSION}: local=${result.localDeleted}, cloud=${result.cloudDeleted}`,
          )
        }
      })
      .catch((e) => {
        // 失敗しても version は更新しない → 次回起動で再試行される
        console.warn('[folders-cleanup] failed (will retry next launch):', e)
      })

    return () => { cancelled = true }
  }, [])
}
