import { useEffect } from 'react'
import { onDbWrite } from '@/lib/db'
import { loadVaultConfig } from '@/lib/vault/config'
import { flushDbToVault } from '@/lib/vault/_vaultSync'
import { createFlushScheduler } from '@/lib/vault/flushScheduler'
import { VAULT_FLUSH_DEBOUNCE_MS } from '@/constants/timing'

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
 */
export function useVaultAutoFlush() {
  useEffect(() => {
    const scheduler = createFlushScheduler({
      debounceMs: VAULT_FLUSH_DEBOUNCE_MS,
      flush: async () => {
        const cfg = await loadVaultConfig()
        if (!cfg.vaultPath) return // フォルダ未設定 = 機能オフ
        await flushDbToVault(cfg.vaultPath)
      },
    })
    const unsubscribe = onDbWrite(() => scheduler.notify())
    return () => {
      unsubscribe()
      scheduler.dispose()
    }
  }, [])
}
