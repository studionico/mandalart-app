import { useEffect } from 'react'
import { cleanupEmptyCellsInCloud } from '@/lib/api/grids'
import { STORAGE_KEYS } from '@/constants/storage'

/**
 * cloud (Supabase) 側の空 cell を「アプリのバージョンアップ時に一度だけ」掃除する。
 *
 * これは local 側の migration 005 (`drop_empty_cells.sql`) と対をなす「cloud 側 migration」
 * 相当の仕組み。tauri-plugin-sql のマイグレーションは local 限定なので、cloud 側は
 * アプリ JS 層で同等のことを再現する必要がある。
 *
 * 動作:
 * - localStorage の `cloudEmptyCleanupVersion` を参照
 * - 起動時に現行の `CLOUD_CLEANUP_VERSION` と比較し、古ければ 1 回 cleanup を実行
 * - 完了後 localStorage を更新 → 以降この version では走らない
 *
 * 将来 cleanup ロジックを変更したら `CLOUD_CLEANUP_VERSION` を bump する。全 user の
 * 端末で次回起動時に再度 1 回だけ走る。
 *
 * App ルートで 1 度だけ呼び出す。失敗時は warn のみ (失敗しても次回起動で再試行されるので
 * 過剰な retry 機構は不要)。
 */
// v1: 初回 cleanup
// v2: createMandalart / duplicateMandalart の lazy 化漏れで作られた cloud 空 cell を再掃除
const CLOUD_CLEANUP_VERSION = 2

export function useCloudEmptyCellsCleanup(): void {
  useEffect(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEYS.cloudEmptyCleanupVersion) ?? 0)
    if (stored >= CLOUD_CLEANUP_VERSION) return

    let cancelled = false
    cleanupEmptyCellsInCloud()
      .then(({ deletedCount }) => {
        if (cancelled) return
        localStorage.setItem(STORAGE_KEYS.cloudEmptyCleanupVersion, String(CLOUD_CLEANUP_VERSION))
        if (deletedCount > 0) {
          console.log(`[cloud-cleanup] v${CLOUD_CLEANUP_VERSION}: deleted ${deletedCount} empty cells from cloud`)
        }
      })
      .catch((e) => {
        // 失敗しても version は更新しない → 次回起動で再試行される
        console.warn('[cloud-cleanup] failed (will retry next launch):', e)
      })

    return () => { cancelled = true }
  }, [])
}
