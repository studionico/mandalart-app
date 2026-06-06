import Foundation
import CryptoKit

/// リコンシリエーションのピュア部分 (I/O なし)。実際の SQLite / ファイル書き込みは後段の I/O 層が
/// この計画 (plan) を適用する。
/// desktop [`src/lib/vault/reconcile.ts`](../../../desktop/src/lib/vault/reconcile.ts) の Swift 移植。
///
/// desktop は Web Crypto の都合で async だが、Swift は CryptoKit `SHA256` が同期なので `hashContent`
/// も同期 API にしている。

/// SHA-256 16 進ダイジェスト (64 桁)。
func hashContent(_ content: String) -> String {
    let digest = SHA256.hash(data: Data(content.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

/// id + hash を持つ差分対象。
struct Diffable: Equatable {
    var id: String
    var hash: String
}

/// id ベースの差分計画。
struct DiffPlan: Equatable {
    var upsertIds: [String]
    var deleteIds: [String]
}

/// id をキーに existing(現状) と incoming(あるべき姿) を突き合わせる純関数。
///  - upsertIds: incoming のうち id が新規 or hash が変化したもの
///  - deleteIds: existing のうち incoming に無い id
/// file→DB / DB→file どちらの向きでも使える (どちらを existing/incoming にするかは呼び出し側)。
func diffById(existing: [Diffable], incoming: [Diffable]) -> DiffPlan {
    let existingHashById = Dictionary(existing.map { ($0.id, $0.hash) }, uniquingKeysWith: { _, new in new })
    var incomingIds = Set<String>()
    var upsertIds: [String] = []
    for item in incoming {
        incomingIds.insert(item.id)
        let prevHash = existingHashById[item.id]
        if prevHash == nil || prevHash != item.hash { upsertIds.append(item.id) }
    }
    var deleteIds: [String] = []
    for e in existing where !incomingIds.contains(e.id) {
        deleteIds.append(e.id)
    }
    return DiffPlan(upsertIds: upsertIds, deleteIds: deleteIds)
}

/// DB→file 方向の差分書き出し計画。
struct FilePlan: Equatable {
    /// 内容が変わった / 新規のファイルだけ書く (不要な全書換えを避ける = ループ抑止にも寄与)。
    var write: [VaultFile]
    /// desired に無くなった既存ファイルのパス。
    var deletePaths: [String]
}

/// DB→file 方向の差分書き出し計画。path をキーに content が一致するものは write から除く。
func diffFiles(existing: [VaultFile], desired: [VaultFile]) -> FilePlan {
    let existingByPath = Dictionary(existing.map { ($0.path, $0.content) }, uniquingKeysWith: { _, new in new })
    var desiredPaths = Set<String>()
    var write: [VaultFile] = []
    for f in desired {
        desiredPaths.insert(f.path)
        if existingByPath[f.path] != f.content { write.append(f) }
    }
    var deletePaths: [String] = []
    for f in existing where !desiredPaths.contains(f.path) {
        deletePaths.append(f.path)
    }
    return FilePlan(write: write, deletePaths: deletePaths)
}

/// 自分が書いた直後の watcher 発火を無視するための echo skip 判定 (ループ回避 3 重防御の 1 つ)。
/// 書き出した content の hash を recentWrites に積んでおき、watcher で読んだ content の hash が
/// 一致すれば「自分の書き込みの反響」とみなして無視する。
func shouldSkipEcho(_ hash: String, recentWrites: Set<String>) -> Bool {
    recentWrites.contains(hash)
}
