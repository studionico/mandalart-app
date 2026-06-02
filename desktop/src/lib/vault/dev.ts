import { STORAGE_KEYS } from '@/constants/storage'
import {
  dryRunCompareVaultToDb,
  exportAllToVault,
  flushDbToVault,
  reconcileVaultToDb,
  type DryRunReport,
  type ExportReport,
  type FlushReport,
} from './_vaultSync'
import type { ApplyReport } from './applyToDb'
import { watchVault } from './io'
import { saveVaultConfig } from './config'

/**
 * Phase 2 vault モードの dev 専用エントリ (本番挙動オフ)。
 *
 * `localStorage['mandalart.vaultDevMode'] === '1'` のときだけ `window.__vault` にヘルパを生やす。
 * vault ルートは `localStorage['mandalart.vaultDevPath']` (fs:scope 内、$HOME 配下等)。
 * これで「アプリ編集 → flush → ファイル / Obsidian 編集 → startWatch・rebuildFromVault → DB」の
 * 双方向ループを手動でドッグフードできる。ユーザー向けの Settings トグル + フォルダ選択ダイアログ +
 * 起動時自動反転 + auto-flush は実機手動検証後に productize する (= 本ファイルはまだ自動反転しない)。
 *
 * 使い方 (DevTools コンソール):
 *   localStorage.setItem('mandalart.vaultDevMode','1')
 *   localStorage.setItem('mandalart.vaultDevPath','/Users/me/Documents/mandalart-vault')
 *   // リロード後
 *   await window.__vault.exportToVault()    // 初回: DB 全体を vault に書き出し
 *   await window.__vault.flush()            // 以降: 差分だけ vault に反映 (DB→file)
 *   await window.__vault.startWatch()       // Obsidian 等の外部編集を監視
 *   await window.__vault.rebuildFromVault() // file→DB 再構築 (実 DB 書込み)
 *   await window.__vault.dryRun()           // DB ⇄ vault 差分の確認 (無改変)
 */

type VaultDevApi = {
  /** 現在の vault ルートパス。 */
  path: () => string | null
  /** DB ⇄ vault の差分を計算してログ (DB 無改変)。 */
  dryRun: () => Promise<DryRunReport | null>
  /** DB 全マンダラートを vault に一方向書き出し (ファイルのみ、DB 無改変、非破壊)。 */
  exportToVault: () => Promise<ExportReport | null>
  /** DB→vault の差分 flush (変化したファイルだけ書く / 不要 .md を消す、DB 無改変)。 */
  flush: () => Promise<FlushReport | null>
  /** vault→DB 再構築 (**実 DB 書込み**)。deleteMissing=true で vault に無いマンダラートも削除。 */
  rebuildFromVault: (deleteMissing?: boolean) => Promise<ApplyReport | null>
  /** vault ルートを watch して変更パスをログ。 */
  startWatch: () => Promise<void>
  /** watch 停止。 */
  stopWatch: () => void
}

declare global {
  interface Window {
    __vault?: VaultDevApi
  }
}

let unwatch: (() => void) | null = null

function vaultPath(): string | null {
  return localStorage.getItem(STORAGE_KEYS.vaultDevPath)
}

export function initVaultDevMode(): void {
  if (localStorage.getItem(STORAGE_KEYS.vaultDevMode) !== '1') return

  window.__vault = {
    path: vaultPath,
    dryRun: async () => {
      const p = vaultPath()
      if (!p) {
        console.warn(`[vault] ${STORAGE_KEYS.vaultDevPath} に vault ルートを設定してください`)
        return null
      }
      return dryRunCompareVaultToDb(p)
    },
    exportToVault: async () => {
      const p = vaultPath()
      if (!p) {
        console.warn(`[vault] ${STORAGE_KEYS.vaultDevPath} に vault ルートを設定してください`)
        return null
      }
      const report = await exportAllToVault(p)
      // Stage 3b で使う永続 config にパスを記録 (vaultMode はまだ立てない = canonical 反転しない)
      await saveVaultConfig({ vaultMode: false, vaultPath: p })
      return report
    },
    flush: async () => {
      const p = vaultPath()
      if (!p) {
        console.warn(`[vault] ${STORAGE_KEYS.vaultDevPath} に vault ルートを設定してください`)
        return null
      }
      return flushDbToVault(p)
    },
    rebuildFromVault: async (deleteMissing = false) => {
      const p = vaultPath()
      if (!p) {
        console.warn(`[vault] ${STORAGE_KEYS.vaultDevPath} に vault ルートを設定してください`)
        return null
      }
      console.warn('[vault] ⚠️ vault→DB 再構築を実行します (実 DB 書込み)')
      return reconcileVaultToDb(p, { deleteMissingMandalarts: deleteMissing })
    },
    startWatch: async () => {
      const p = vaultPath()
      if (!p) {
        console.warn(`[vault] ${STORAGE_KEYS.vaultDevPath} に vault ルートを設定してください`)
        return
      }
      if (unwatch) unwatch()
      unwatch = await watchVault(p, (paths) => console.info('[vault] watch 変更:', paths))
      console.info('[vault] watching', p)
    },
    stopWatch: () => {
      if (unwatch) {
        unwatch()
        unwatch = null
        console.info('[vault] watch 停止')
      }
    },
  }
  console.info('[vault] dev mode 有効 — window.__vault.dryRun() / startWatch() / stopWatch()')
}
