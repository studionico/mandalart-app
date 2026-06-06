import Foundation

/// 自分が最後に各 vault ファイルへ書いた content の SHA-256 を覚えておく台帳 (echo-skip / clobber 安全化、Stage ④)。
///
/// flush (DB→vault) は disk と DB の差分を見て DB 内容で上書きするため、アプリ前面中に外部編集が disk に届くと
/// 取り込み前の auto-flush がそれを潰す (iOS は watcher が無く取り込みは「背面=flush / 復帰=reconcile」の 2 点のみ)。
/// flush 直前に **disk の hash がこの台帳と違えば外部編集とみなして上書きを skip** することでこれを防ぐ。
///
/// reconcile (vault→DB 取り込み) は取り込み後に現 disk の hash を seed する。これが無いと Stage ③ の
/// 「取り込み → 次回 flush で frontmatter を本文に整合」書込み自体が外部編集と誤判定され永久 skip される。
///
/// process メモリのみ (永続化しない): cold start で必ず起動時 reconcile が現 disk から再 seed するため。
@MainActor
final class VaultWriteLedger {
    private var hashes: [String: String] = [:]   // key = dirName + "/" + path

    func storedHash(_ key: String) -> String? { hashes[key] }
    func record(_ key: String, hash: String) { hashes[key] = hash }
    func remove(_ key: String) { hashes.removeValue(forKey: key) }
}

/// 台帳キー。`VaultFile.path` は bare filename でマンダラート間で衝突するので dirName を畳む。
/// flush / reconcile 双方が同一に算出する (どちらも dirName と path を持つ)。
func vaultLedgerKey(dirName: String, path: String) -> String { dirName + "/" + path }
