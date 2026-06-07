import { useEffect } from 'react'
import { join } from '@tauri-apps/api/path'
import { useBootstrapStore } from '@/store/bootstrapStore'
import { useVaultStore } from '@/store/vaultStore'
import { watchVault, scanVault } from '@/lib/vault/io'
import { reconcileVaultToDb } from '@/lib/vault/_vaultSync'
import { hashContent } from '@/lib/vault/reconcile'
import { writeLedger } from '@/lib/vault/vaultWriteLedger'
import { createFlushScheduler } from '@/lib/vault/flushScheduler'
import { VAULT_IMPORT_DEBOUNCE_MS } from '@/constants/timing'

/**
 * vault のライブ取り込み完了を画面に伝える DOM event。DashboardPage / EditorLayout が listen して
 * DB を再フェッチする (外部編集は React が自動追従しないため)。`app:sync-pulled` は user gate が
 * 掛かっており vaultMode (未サインインでも使う) では発火しないので専用イベントにする。
 */
export const VAULT_IMPORTED_EVENT = 'app:vault-imported'

/**
 * vault を scan して ledger と 1 つでも異なる .md があるか (= 真の外部編集が未取り込みで残っているか)。
 * watcher の echo-skip 判定。**event のパス形式に依存しない** (macOS FSEvents はディレクトリ / 一時
 * ファイルのパスを返すことがあり、`.md` 拡張子フィルタだと外部編集イベントを取りこぼすため)。
 */
async function hasExternalChange(vaultRoot: string): Promise<boolean> {
  const dirs = await scanVault(vaultRoot)
  for (const d of dirs) {
    for (const f of d.files) {
      const abs = await join(vaultRoot, d.dirName, f.path)
      if (writeLedger.isExternallyModified(abs, await hashContent(f.content))) return true
    }
  }
  return false
}

/**
 * vault ライブ watcher (Phase 2 / 外部編集のライブ取り込み)。
 *
 * vaultMode ON + vaultPath 設定済みのとき、vault フォルダを `watch` し、外部 (Obsidian 等) の .md
 * 編集を検知して debounce 後に `reconcileVaultToDb` (vault→DB、本文ラウンドトリップ applyBody:true) を
 * 走らせる。取り込み後は `VAULT_IMPORTED_EVENT` を dispatch して画面を再フェッチさせる。
 *
 * **echo-skip**: 自分 (flush / 起動 reconcile) が書いた file の反響は無視する。判定は **vault を scan して
 * [writeLedger] と 1 つでも異なる .md があるか** で行う (event パスの形式に依存しない)。すべて台帳一致
 * (= 自分の書込み) なら reconcile しない。万一取りこぼしても続く auto-flush が「desired==disk で書込み
 * ゼロ」に収束するため無限ループにはならない。
 *
 * [useVaultAutoFlush] (DB→vault) とは [writeLedger] を介して clobber/echo を回避するので共存可。
 */
export function useVaultWatcher() {
  const ready = useBootstrapStore((s) => s.ready)
  const vaultMode = useVaultStore((s) => s.vaultMode)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  useEffect(() => {
    if (!ready || !vaultMode || !vaultPath) return
    let disposed = false
    let unwatch: (() => void) | null = null

    const scheduler = createFlushScheduler({
      debounceMs: VAULT_IMPORT_DEBOUNCE_MS,
      flush: async () => {
        if (!(await hasExternalChange(vaultPath))) {
          console.info('[vault] watcher: 外部変更なし (echo) → reconcile skip')
          return
        }
        const report = await reconcileVaultToDb(vaultPath)
        console.info('[vault] watcher import vault→DB:', report)
        // 取り込んだ DB 変更を画面に反映 (外部編集は React が自動追従しないため)。
        window.dispatchEvent(new CustomEvent(VAULT_IMPORTED_EVENT))
      },
    })

    const onChange = (paths: string[]) => {
      // dot ディレクトリ/ファイル (Obsidian の `.obsidian/workspace.json` 等) の変更は無視する。
      // 頻繁に書かれ、scanVault も `.` 始まりフォルダを対象外にしているので scan しても無駄。
      // 通常の .md / フォルダイベントが 1 つでもあれば取り込みを検討する (echo は scan で弾く)。
      if (!paths.some((p) => !p.includes('/.'))) return
      scheduler.notify()
    }

    watchVault(vaultPath, onChange)
      .then((fn) => {
        if (disposed) fn()
        else {
          unwatch = fn
          console.info('[vault] watcher started:', vaultPath)
        }
      })
      .catch((e) => console.error('[vault] watcher 開始失敗:', e))

    return () => {
      disposed = true
      unwatch?.()
      scheduler.dispose()
    }
  }, [ready, vaultMode, vaultPath])
}
