import { create } from 'zustand'

/**
 * vault 設定 (vaultMode / vaultPath) の **in-memory 反応的ミラー** (Phase 2 productize P4)。
 *
 * 永続化の正は AppData の vault-config.json ([config.ts](../lib/vault/config.ts)) のまま。本ストアは
 * 同期フック等が **同期的に** vaultMode を読めるようにするためのミラー。App 起動 bootstrap で
 * loadVaultConfig() の結果を setVault() し、SettingsDialog のトグル/フォルダ選択でも更新する。
 *
 * 主用途: [useSync](../hooks/useSync.ts) が `vaultMode` ON のとき Supabase 同期を完全オフにする
 * (vaultMode 中はファイルが正なので pull が起動再構築した DB を上書きする衝突を防ぐ)。
 */
type VaultState = {
  vaultMode: boolean
  vaultPath: string | null
  setVault: (cfg: { vaultMode: boolean; vaultPath: string | null }) => void
}

export const useVaultStore = create<VaultState>((set) => ({
  vaultMode: false,
  vaultPath: null,
  setVault: (cfg) => set({ vaultMode: cfg.vaultMode, vaultPath: cfg.vaultPath }),
}))
