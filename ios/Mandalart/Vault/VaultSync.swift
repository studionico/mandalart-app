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

    // MARK: - flush (DB→vault 差分書き出し、auto-flush の核)

    struct FlushReport: Equatable {
        var mandalarts = 0
        var written = 0
        var deleted = 0
        var deletedDirs = 0
        var imagesCopied = 0
        /// 外部編集を検知して上書きを見送ったファイル数 (echo-skip、Stage ④)。
        var skippedExternal = 0
    }

    /// DB 行群 → vault へ **差分** flush (変化したファイルだけ書き、不要 .md を削除)。
    /// desktop [`_vaultSync.flushDbToVault`](../../../desktop/src/lib/vault/_vaultSync.ts) 移植。
    /// `updated_at` だけの差は `docContentEquivalent` で書き換えを抑止 (churn 回避)。
    ///
    /// `ledger` を渡すと **clobber 安全化 (echo-skip、Stage ④)** が有効: disk が自分の最後の書込みと違う
    /// ファイル/dir は外部編集とみなして上書き/削除を見送る。nil (既定) のときは従来どおり無条件に上書き/削除
    /// (= legacy、手動 rebuild 後や台帳不要の経路)。`@MainActor` は台帳 (MainActor 隔離) に触れるため。
    @MainActor
    @discardableResult
    static func flushDbToVault(
        rows: [MandalartRows], to vaultRoot: URL, appSupportDir: URL, ledger: VaultWriteLedger? = nil
    ) throws -> FlushReport {
        try VaultIO.ensureDir(vaultRoot)
        let scanned = try VaultIO.scanVault(vaultRoot)
        var existingById: [String: (dirName: String, files: [VaultFile])] = [:]
        for entry in scanned {
            if let restored = vaultFilesToRows(entry.files) {
                existingById[restored.mandalart.id] = (entry.dirName, entry.files)
            }
        }

        var report = FlushReport()
        report.mandalarts = rows.count
        let liveIds = Set(rows.map { $0.mandalart.id })

        for row in rows {
            let desired = mandalartToVaultFiles(row)
            let existing = existingById[row.mandalart.id]

            // stale な untitled-* フォルダ (作成直後に title 空) は実タイトル folder へリネーム。
            let renameFrom: String? = {
                if let ex = existing, ex.dirName != desired.dirName, ex.dirName.hasPrefix("untitled-") {
                    return ex.dirName
                }
                return nil
            }()
            let dirName = renameFrom != nil ? desired.dirName : (existing?.dirName ?? desired.dirName)
            let dirAbs = vaultRoot.appendingPathComponent(dirName, isDirectory: true)
            try VaultIO.ensureDir(dirAbs)

            if let renameFrom {
                for file in desired.files {
                    try VaultIO.writeVaultFile(dirAbs.appendingPathComponent(file.path), content: file.content)
                    ledger?.record(vaultLedgerKey(dirName: dirName, path: file.path), hash: hashContent(file.content))
                    report.written += 1
                }
                // 旧 untitled dir は全ファイルが自分のものなら削除 (外部ファイルがあれば残し次回 reconcile に委ねる)。
                if dirIsFullyOwned(existing?.files ?? [], dirName: renameFrom, ledger: ledger) {
                    try VaultIO.removeDir(vaultRoot.appendingPathComponent(renameFrom))
                    purgeDirKeys(existing?.files ?? [], dirName: renameFrom, ledger: ledger)
                }
            } else {
                // churn 抑止: 既存と updated_at だけの差のファイルは既存内容に差し替えて書換えを止める。
                let exMap = Dictionary(
                    (existing?.files ?? []).map { ($0.path, $0.content) }, uniquingKeysWith: { _, new in new })
                var desiredFiles = desired.files
                for i in desiredFiles.indices {
                    if let ex = exMap[desiredFiles[i].path], ex != desiredFiles[i].content,
                       docContentEquivalent(ex, desiredFiles[i].content) {
                        desiredFiles[i] = VaultFile(path: desiredFiles[i].path, content: ex)
                    }
                }
                if let ledger {
                    // clobber 安全化: churn 抑止後の desiredFiles に対し guard を効かせる。
                    let plan = diffFilesGuarded(
                        existing: existing?.files ?? [], desired: desiredFiles,
                        ledgerHash: { ledger.storedHash(vaultLedgerKey(dirName: dirName, path: $0)) }
                    )
                    for file in plan.write {
                        try VaultIO.writeVaultFile(dirAbs.appendingPathComponent(file.path), content: file.content)
                        ledger.record(vaultLedgerKey(dirName: dirName, path: file.path), hash: hashContent(file.content))
                        report.written += 1
                    }
                    for path in plan.deletePaths {
                        try VaultIO.removeVaultFile(dirAbs.appendingPathComponent(path))
                        ledger.remove(vaultLedgerKey(dirName: dirName, path: path))
                        report.deleted += 1
                    }
                    report.skippedExternal += plan.skippedExternal.count // skip は台帳を触らない (次 reconcile が再 seed)
                } else {
                    // legacy: 台帳なし = 従来どおり無条件 clobber/delete。
                    let plan = diffFiles(existing: existing?.files ?? [], desired: desiredFiles)
                    for file in plan.write {
                        try VaultIO.writeVaultFile(dirAbs.appendingPathComponent(file.path), content: file.content)
                        report.written += 1
                    }
                    for path in plan.deletePaths {
                        try VaultIO.removeVaultFile(dirAbs.appendingPathComponent(path))
                        report.deleted += 1
                    }
                }
            }
            report.imagesCopied += VaultImageStore.flushImagesToVault(
                vaultRoot: vaultRoot, appSupportDir: appSupportDir, cells: row.cells)
        }

        // DB live に無くなったマンダラートの vault フォルダを削除 (空 DB ガード: rows 0 件なら何も消さない)。
        if !rows.isEmpty {
            for (mid, info) in existingById where !liveIds.contains(mid) {
                // 台帳ありのとき、外部ファイルを含む dir は削除しない (= 外部作成/編集を保護、次回 reconcile で取り込む)。
                guard dirIsFullyOwned(info.files, dirName: info.dirName, ledger: ledger) else { continue }
                try VaultIO.removeDir(vaultRoot.appendingPathComponent(info.dirName))
                purgeDirKeys(info.files, dirName: info.dirName, ledger: ledger)
                report.deletedDirs += 1
            }
        }

        return report
    }

    /// dir 内の全ファイルが「自分が作って未改変」(台帳の hash と現 disk が一致) かを判定。
    /// 台帳 nil (legacy) のときは常に true (= 従来どおり無条件削除)。
    @MainActor
    private static func dirIsFullyOwned(_ files: [VaultFile], dirName: String, ledger: VaultWriteLedger?) -> Bool {
        guard let ledger else { return true }
        for f in files {
            guard let lh = ledger.storedHash(vaultLedgerKey(dirName: dirName, path: f.path)),
                  lh == hashContent(f.content) else { return false }
        }
        return true
    }

    /// dir 削除に伴い台帳からそのファイル群のキーを除く (台帳 nil は no-op)。
    @MainActor
    private static func purgeDirKeys(_ files: [VaultFile], dirName: String, ledger: VaultWriteLedger?) {
        guard let ledger else { return }
        for f in files { ledger.remove(vaultLedgerKey(dirName: dirName, path: f.path)) }
    }
}
