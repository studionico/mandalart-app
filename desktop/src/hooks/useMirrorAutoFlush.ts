import { useEffect } from 'react'
import { onDbWrite } from '@/lib/db'
import { loadMirrorConfig } from '@/lib/mirror/mirrorConfig'
import { mirrorAllToFolder } from '@/lib/mirror/mirrorSync'
import { MIRROR_FLUSH_DEBOUNCE_MS } from '@/constants/timing'

/**
 * ローカル JSON ミラーの auto-flush (一方向 DB→ファイル)。
 *
 * DB 書込み (`execute`) のたびに通知を受け、静穏 (MIRROR_FLUSH_DEBOUNCE_MS) になってから
 * 選択フォルダへ各マンダラートの .json を書き出す。**DB は無改変・ファイルのみ書く**ため
 * canonical は DB のまま。取り込み (ファイル→DB) は行わない。
 *
 * 有効化はフォルダ設定 + トグル。flush 直前に毎回 `loadMirrorConfig()` を読むので、Settings
 * での変更が次回 flush から自動追従する。無効/フォルダ未設定なら即 return = ファイル書込みゼロ。
 *
 * **フィードバックループなし**: `mirrorAllToFolder` は読取 + ファイル書込みのみで `execute` を
 * 呼ばないため自分の書込みで再発火しない。エラーは console.error に留める。
 */
export function useMirrorAutoFlush() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let flushing = false
    let pending = false
    let disposed = false

    const run = async () => {
      timer = null
      if (disposed) return
      if (flushing) {
        pending = true
        return
      }
      flushing = true
      try {
        const cfg = await loadMirrorConfig()
        if (cfg.mirrorEnabled && cfg.mirrorPath) {
          await mirrorAllToFolder(cfg.mirrorPath)
        }
      } catch (e) {
        console.error('[mirror] auto-flush failed:', e)
      } finally {
        flushing = false
        if (pending && !disposed) {
          pending = false
          schedule()
        }
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void run(), MIRROR_FLUSH_DEBOUNCE_MS)
    }

    const unsubscribe = onDbWrite(() => {
      if (disposed) return
      if (flushing) {
        pending = true
        return
      }
      schedule()
    })

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}
