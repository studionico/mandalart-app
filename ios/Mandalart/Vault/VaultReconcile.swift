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

// MARK: - clobber 安全化 (echo-skip、Stage ④)

/// `diffFiles` に echo-skip 台帳を加味した guard 付き版。外部編集を上書き/削除から保護する。
/// ピュア (MainActor 非依存): 台帳 object ではなく `ledgerHash` クロージャ (path → 自分の最後の書込み hash、
/// nil=台帳に無い) を受け取る。
struct GuardedFilePlan: Equatable {
    /// 書いてよいファイル (新規 or disk が自分の最後の書込みと一致 = DB が先行しただけ)。
    var write: [VaultFile]
    /// 消してよいファイル (自分が作って未改変 = 台帳の hash と現 disk が一致)。
    var deletePaths: [String]
    /// disk が自分の最後の書込みと違う (外部編集) ため上書きを見送ったファイル。次回 reconcile が取り込む。
    var skippedExternal: [String]
}

/// path をキーに existing(現 disk) と desired(あるべき内容) を突き合わせ、台帳で外部編集を保護する。
func diffFilesGuarded(
    existing: [VaultFile],
    desired: [VaultFile],
    ledgerHash: (String) -> String?
) -> GuardedFilePlan {
    let existingByPath = Dictionary(existing.map { ($0.path, $0.content) }, uniquingKeysWith: { _, new in new })
    var desiredPaths = Set<String>()
    var write: [VaultFile] = []
    var skipped: [String] = []

    for f in desired {
        desiredPaths.insert(f.path)
        guard let diskContent = existingByPath[f.path] else {
            write.append(f) // disk に無い = 新規ファイル → 書く
            continue
        }
        if diskContent == f.content { continue } // disk == desired → no-op
        // disk ≠ desired: disk が自分の最後の書込みか?
        if let lh = ledgerHash(f.path), lh == hashContent(diskContent) {
            write.append(f) // 自分の最後の書込み = DB が先行しただけ → 安全に上書き
        } else {
            skipped.append(f.path) // 外部編集あり → skip (次回 reconcile で取り込む)
        }
    }

    var deletePaths: [String] = []
    for f in existing where !desiredPaths.contains(f.path) {
        // desired に無い既存ファイルは「自分が作って未改変」のときだけ削除。外部作成/外部編集は残す。
        if let lh = ledgerHash(f.path), lh == hashContent(f.content) {
            deletePaths.append(f.path)
        }
    }
    return GuardedFilePlan(write: write, deletePaths: deletePaths, skippedExternal: skipped)
}
