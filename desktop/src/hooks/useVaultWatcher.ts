import { useEffect } from 'react'
import { useBootstrapStore } from '@/store/bootstrapStore'
import { useVaultStore } from '@/store/vaultStore'
import { watchVault } from '@/lib/vault/io'
import { reconcileVaultDirs, flushDbToVault } from '@/lib/vault/_vaultSync'
import { createFlushScheduler } from '@/lib/vault/flushScheduler'
import { VAULT_IMPORT_DEBOUNCE_MS } from '@/constants/timing'

/**
 * vault のライブ取り込み完了を画面に伝える DOM event。DashboardPage / EditorLayout が listen して
 * DB を再フェッチする (外部編集は React が自動追従しないため)。`app:sync-pulled` は user gate が
 * 掛かっており vaultMode (未サインインでも使う) では発火しないので専用イベントにする。
 */
export const VAULT_IMPORTED_EVENT = 'app:vault-imported'

/**
 * watch イベントのパス群から、変更があった**マンダラートフォルダ名** (vault ルート直下の第1セグメント)
 * の集合を返す。
 *
 * macOS FSEvents は `.md` 1 ファイルの変更時に親ディレクトリ (vault ルート含む) のイベントも併せて
 * 報告する。dir パス (`/test` 等) や `.obsidian/workspace.json` を拾うと無駄な取り込みを誘発するので、
 * **vaultRoot 配下で rel に dot セグメントを含まない `.md` ファイルパス**だけを対象に、その直下フォルダ名
 * を抽出する (本物の `.md` 編集では実ファイルパスが配信されることを実機で確認済み)。
 */
export function changedMandalartDirs(vaultRoot: string, paths: string[]): string[] {
  const prefix = vaultRoot.endsWith('/') ? vaultRoot : `${vaultRoot}/`
  const dirs = new Set<string>()
  for (const p of paths) {
    if (!p.endsWith('.md') || !p.startsWith(prefix)) continue
    const rel = p.slice(prefix.length)
    const segments = rel.split('/')
    if (segments.some((s) => s.startsWith('.'))) continue // .obsidian/* 等 dot 配下を除外
    const dir = segments[0]
    if (dir && segments.length >= 2) dirs.add(dir) // <dir>/<file>.md の形のみ
  }
  return [...dirs]
}

/**
 * vault ライブ watcher (Phase 2 / 外部編集のライブ取り込み)。
 *
 * vaultMode ON + vaultPath 設定済みのとき、vault フォルダを `watch` し、外部 (Obsidian 等) の .md
 * 編集を検知して debounce 後に **変更があったマンダラートフォルダだけ** `reconcileVaultDirs` で取り込む
 * (vault→DB、本文ラウンドトリップ applyBody:true)。1 セル編集で vault 全体を再構築するコストを避ける。
 * 取り込み (mandalarts>0) 後は **取り込んだマンダラートを DB→vault へ即 flush** して、却下された削除
 * (子持ち親セル / 中心セルの見出し削除) の `##` を確実に書き戻す (auto-flush のタイミング依存を排除)。
 * その後 `VAULT_IMPORTED_EVENT` を dispatch して画面を再フェッチさせる。
 *
 * **echo-skip**: 自分 (flush / 起動 reconcile) が書いた file の反響は [reconcileVaultDirs] 内で
 * per-dir に [writeLedger] と照合して無視する (全 echo なら report.mandalarts===0)。
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
    const pendingDirs = new Set<string>() // debounce 窓の間に変更されたフォルダを集約

    const scheduler = createFlushScheduler({
      debounceMs: VAULT_IMPORT_DEBOUNCE_MS,
      flush: async () => {
        const dirs = [...pendingDirs]
        pendingDirs.clear()
        if (dirs.length === 0) return
        const { mandalartIds } = await reconcileVaultDirs(vaultPath, dirs)
        if (mandalartIds.length === 0) {
          console.info('[vault] watcher: 外部変更なし (echo) → reconcile skip', dirs)
          return
        }
        // 取り込んだマンダラートを DB→vault へ即 flush。却下された削除 (子持ち親 / 中心セルの ## 削除) の
        // 見出しを確実に書き戻し、本文編集を正準形に整える (ledger は reconcile が更新済なので clobber
        // ガードを通過する)。スコープ指定なので他マンダラート・フォルダ削除は行わない。
        await flushDbToVault(vaultPath, { onlyMandalartIds: new Set(mandalartIds) })
        // 取り込んだ DB 変更を画面に反映 (外部編集は React が自動追従しないため)。
        window.dispatchEvent(new CustomEvent(VAULT_IMPORTED_EVENT))
      },
    })

    const onChange = (paths: string[]) => {
      const dirs = changedMandalartDirs(vaultPath, paths)
      if (dirs.length === 0) return // .md ファイル変更以外 (dir イベント / .obsidian/*) は無視
      for (const d of dirs) pendingDirs.add(d)
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
