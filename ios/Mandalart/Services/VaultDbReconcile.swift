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
        options: VaultApplyOptions = .init(),
        ledger: VaultWriteLedger? = nil
    ) throws -> VaultApplyReport {
        let dirs = try VaultIO.scanVault(vaultRoot)

        // echo-skip 台帳を現 disk で seed (Stage ④)。取り込み直後の disk が「自分の最後の書込み」基準になり、
        // 次回 flush で Stage ③ の frontmatter 整合書込みが外部編集と誤判定され skip されるのを防ぐ。
        // corrupt で parse 失敗した entry も disk にはあるので seed する (all ではなく dirs を回す)。
        if let ledger {
            for entry in dirs {
                for file in entry.files {
                    ledger.record(vaultLedgerKey(dirName: entry.dirName, path: file.path), hash: hashContent(file.content))
                }
            }
        }

        var all: [MandalartRows] = []
        var skipGridDeletionFor = options.skipGridDeletionFor
        for entry in dirs {
            // applyBody: true = 本文 (人間可読ビュー) の編集を frontmatter にマージして DB へ反映
            // (本文ラウンドトリップ Stage ③)。reconcile は vault→DB 取り込みなので本文を正として読む。
            guard let rows = vaultFilesToRows(entry.files, applyBody: true) else { continue }
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
