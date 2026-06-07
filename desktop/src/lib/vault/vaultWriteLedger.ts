/**
 * vault ファイルごとの「自分が最後に同期した content の hash」を持つ in-memory 台帳 (Phase 2 productize / clobber 安全化)。
 * iOS [VaultWriteLedger.swift](../../../../ios/Mandalart/Vault/VaultWriteLedger.swift) 相当。
 *
 * 1 つの台帳を 2 目的に使う:
 *  1. **flush の clobber ガード** (DB→vault): file を上書きする前に disk の現在 hash と照合し、
 *     不一致 (= 前回同期以降に外部編集された) なら **上書きしない** ([_vaultSync.flushDbToVault])。
 *  2. **watcher の echo-skip** (vault→DB): watcher 発火パスの disk hash が一致 (= 自分の書込みの反響)
 *     なら reconcile しない ([useVaultWatcher])。
 *
 * **更新タイミング**: flush 書込み時 (record) と reconcile 取り込み時 (record) の両方。これにより
 * 「外部編集が未取り込み」(skip して保護) と「同期済み」(安全に正準化書き戻し) を区別できる。
 *
 * key は **絶対パス** (`_mandalart.md` がフォルダ間で衝突するため相対 path は不可)。
 * プロセスメモリのみ (永続化しない)。起動時は空だが、bootstrap reconcile / 初回 export が record する。
 */

export type WriteLedger = {
  /** file を同期した (書いた or 取り込んだ) ことを記録する。 */
  record: (key: string, hash: string) => void
  /** 前回同期以降に外部で変更されたか。台帳に無い key は false (= 初回 export を妨げない)。 */
  isExternallyModified: (key: string, currentHash: string) => boolean
  /** 台帳に key が記録済みか。 */
  has: (key: string) => boolean
  /** 全消去 (テスト用)。 */
  clear: () => void
}

export function createWriteLedger(): WriteLedger {
  const hashByKey = new Map<string, string>()
  return {
    record(key, hash) {
      hashByKey.set(key, hash)
    },
    isExternallyModified(key, currentHash) {
      const known = hashByKey.get(key)
      return known !== undefined && known !== currentHash
    },
    has(key) {
      return hashByKey.has(key)
    },
    clear() {
      hashByKey.clear()
    },
  }
}

/** flush (_vaultSync) と watcher (useVaultWatcher) が共有する default singleton。 */
export const writeLedger = createWriteLedger()
