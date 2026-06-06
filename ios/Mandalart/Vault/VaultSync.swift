import Foundation

/// vault モードの orchestration のうち **非破壊な部分** (DB→vault 書き出し / vault→rows dry-run)。
/// desktop [`_vaultSync.ts`](../../../desktop/src/lib/vault/_vaultSync.ts) の `exportAllToVault` /
/// `dryRunCompareVaultToDb` に対応。
///
/// ここは **`[MandalartRows]` (ピュア struct) のみを扱い SwiftData に触れない**ので Vault/ に置けて
/// ユニットテスト可能。`@Model → [MandalartRows]` の読取は [`VaultRowsBridge`](../Services/VaultRowsBridge.swift)
/// (SwiftData 依存、app 限定) が担う。実 DB への書込み (reconcile) は後続 Stage。
enum VaultSync {

    struct ExportReport: Equatable {
        var mandalarts: Int
        var files: Int
        var imagesCopied: Int
    }

    struct DryRunReport: Equatable {
        var mandalarts: Int
        var grids: Int
        var cells: Int
    }

    /// DB 行群 → vault フォルダへ一方向書き出し (ファイルのみ書く非破壊、削除はしない)。
    /// .md は `vaultRoot/<dirName>/`、画像は `vaultRoot/attachments/` (desktop と同じ配置)。
    @discardableResult
    static func exportAllToVault(rows: [MandalartRows], to vaultRoot: URL, appSupportDir: URL) throws -> ExportReport {
        try VaultIO.ensureDir(vaultRoot)
        var fileCount = 0
        var imagesCopied = 0
        for row in rows {
            let vaultFiles = mandalartToVaultFiles(row)
            let dir = vaultRoot.appendingPathComponent(vaultFiles.dirName, isDirectory: true)
            try VaultIO.ensureDir(dir)
            for file in vaultFiles.files {
                try VaultIO.writeVaultFile(dir.appendingPathComponent(file.path), content: file.content)
                fileCount += 1
            }
            imagesCopied += VaultImageStore.flushImagesToVault(
                vaultRoot: vaultRoot, appSupportDir: appSupportDir, cells: row.cells)
        }
        return ExportReport(mandalarts: rows.count, files: fileCount, imagesCopied: imagesCopied)
    }

    /// vault フォルダを読み rows に復元して件数だけ集計する (書込みなし、DB 無改変)。
    static func dryRunScan(at vaultRoot: URL) throws -> DryRunReport {
        let scanned = try VaultIO.scanVault(vaultRoot)
        var mandalarts = 0
        var grids = 0
        var cells = 0
        for entry in scanned {
            guard let rows = vaultFilesToRows(entry.files) else { continue }
            mandalarts += 1
            grids += rows.grids.count
            cells += rows.cells.count
        }
        return DryRunReport(mandalarts: mandalarts, grids: grids, cells: cells)
    }
}
