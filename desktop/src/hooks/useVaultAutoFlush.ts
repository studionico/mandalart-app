import { useEffect } from 'react'
import { onDbWrite } from '@/lib/db'
import { loadVaultConfig } from '@/lib/vault/config'
import { flushDbToVault } from '@/lib/vault/_vaultSync'
import { createFlushScheduler } from '@/lib/vault/flushScheduler'
import { VAULT_FLUSH_DEBOUNCE_MS } from '@/constants/timing'
import { useBootstrapStore } from '@/store/bootstrapStore'
import { useVaultStore } from '@/store/vaultStore'

/**
 * vault auto-flush (Phase 2 productize P2)。
 *
 * DB 書込み (`execute`) のたびに通知を受け、静穏 (VAULT_FLUSH_DEBOUNCE_MS) になってから
 * vault へ差分 flush する。**DB は無改変・ファイルのみ書く**ので canonical は DB のまま。
 *
 * 有効化はユーザー選択により **vault フォルダ設定済み (vaultPath 非 null) なら常に ON**。
 * 専用トグルは持たず、flush の直前に毎回 `loadVaultConfig()` を読んで判定するので、
 * Settings でのフォルダ変更/解除も次回 flush から自動追従する (config 変更イベント不要)。
 * フォルダ未設定なら flush は即 return = ファイル書込みゼロ (機能オフ)。
 *
 * **フィードバックループなし**: `flushDbToVault` は読取 + ファイル書込みのみで `execute` を
 * 呼ばないため、自分の書込みで再発火しない。エラーは scheduler 側で console.error に留める。
 *
 * **bootstrap 後に限定** (P3): `ready` が true のときだけ onDbWrite を購読する。これにより起動時の
 * vault→DB 再構築 (reconcileVaultToDb) の execute() が auto-flush を誤起動しない (購読者ゼロ)。
 *
 * **vaultMode 必須** (外部編集対応で追加): vaultMode OFF のときは購読しない。vaultMode OFF +
 * vaultPath 設定済みで auto-flush だけ走ると、import 系 (起動 reconcile / watcher) が vaultMode で
 * gate されているため「DB→vault 書き出しだけ・取り込み無し」になり、外部 (Obsidian) 編集を上書きで
 * 消してしまう (= 非対称 footgun)。vaultMode を master switch にして flush と import を対称化する。
 * vaultMode OFF でも Settings の手動「今すぐ flush」/「書き出す」は使える (一方向 export として)。
 */
export function useVaultAutoFlush() {
  const ready = useBootstrapStore((s) => s.ready)
  const vaultMode = useVaultStore((s) => s.vaultMode)

  useEffect(() => {
    if (!ready || !vaultMode) return // 起動 rebuild 完了 & vaultMode ON のときだけ購読
    const scheduler = createFlushScheduler({
      debounceMs: VAULT_FLUSH_DEBOUNCE_MS,
      flush: async () => {
        const cfg = await loadVaultConfig()
        if (!cfg.vaultMode || !cfg.vaultPath) return // vaultMode OFF / フォルダ未設定 = 機能オフ
        await flushDbToVault(cfg.vaultPath)
      },
    })
    const unsubscribe = onDbWrite(() => scheduler.notify())
    return () => {
      unsubscribe()
      scheduler.dispose()
    }
  }, [ready, vaultMode])
}
