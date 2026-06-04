import { create } from 'zustand'

/**
 * アプリ起動時の bootstrap 状態 (Phase 2 productize P3)。
 *
 * `ready` が false の間 App は Routes を描画せず「初期化中…」を出す。vaultMode ON のときは
 * この間に vault→DB 再構築 (reconcileVaultToDb) をブロック実行し、完了後に `setReady()` する。
 * これで全ページの初回 DB 読取が再構築後の DB を見る。
 *
 * `ready` を [useVaultAutoFlush](../hooks/useVaultAutoFlush.ts) も購読し、**ready 後にのみ**
 * onDbWrite を購読する → 起動 rebuild 中の execute() が auto-flush を誤起動しない。
 *
 * `vaultRebuildError` は再構築失敗時のユーザー向けメッセージ (既存 DB で続行 + 警告 Toast)。
 */
type BootstrapState = {
  ready: boolean
  setReady: () => void
  vaultRebuildError: string | null
  setVaultRebuildError: (message: string | null) => void
}

export const useBootstrapStore = create<BootstrapState>((set) => ({
  ready: false,
  setReady: () => set({ ready: true }),
  vaultRebuildError: null,
  setVaultRebuildError: (message) => set({ vaultRebuildError: message }),
}))
