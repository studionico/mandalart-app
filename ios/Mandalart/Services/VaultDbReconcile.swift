import Foundation
import SwiftData

/// vault フォルダ → DB 再構築 (**実 SwiftData 書込み**)。
/// desktop [`_vaultSync.ts`](../../../desktop/src/lib/vault/_vaultSync.ts) の `reconcileVaultToDb` 移植。
///
/// `VaultIO.scanVault` で各マンダラートフォルダを読み、`vaultFilesToRows` で行に復元 → `applyVaultRowsToDb`。
/// **破損検知**: フォルダ内の grid .md 数 > parse できた grids 数 なら parse 失敗ありとみなし、その
/// マンダラートを `skipGridDeletionFor` に追加して削除をスキップ (破損ファイルでのデータ損失防止)。
/// 最後に vault attachments → AppSupport へ画像を復元 (best-effort、失敗は rebuild を止めない)。
@MainActor
enum VaultDbReconcile {

    @discardableResult
    static func reconcileVaultToDb(
        vaultRoot: URL,
        in context: ModelContext,
        appSupportDir: URL,
        options: VaultApplyOptions = .init()
    ) throws -> VaultApplyReport {
        let dirs = try VaultIO.scanVault(vaultRoot)
        var all: [MandalartRows] = []
        var skipGridDeletionFor = options.skipGridDeletionFor
        for entry in dirs {
            guard let rows = vaultFilesToRows(entry.files) else { continue }
            all.append(rows)
            let gridFileCount = entry.files.filter { $0.path != mandalartDocName && $0.path.hasSuffix(".md") }.count
            if rows.grids.count < gridFileCount {
                skipGridDeletionFor.insert(rows.mandalart.id)
            }
        }

        var applyOptions = options
        applyOptions.skipGridDeletionFor = skipGridDeletionFor
        let report = VaultDbApply.applyVaultRowsToDb(all, in: context, options: applyOptions)

        // 画像復元 (ローカルに無い分だけ)。失敗は rebuild を止めない。
        _ = VaultImageStore.restoreImagesFromVault(
            vaultRoot: vaultRoot, appSupportDir: appSupportDir, cells: all.flatMap { $0.cells })

        return report
    }
}
