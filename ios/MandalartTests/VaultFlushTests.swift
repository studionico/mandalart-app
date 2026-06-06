import XCTest

/// VaultSync.flushDbToVault (DB→vault 差分 flush) のユニットテスト。temp フォルダで実ファイル I/O。
/// desktop `_vaultSync.flushDbToVault` の差分 / churn 抑止 / 削除に対応。
/// flushDbToVault は台帳 (MainActor) に触れるため `@MainActor` (同期 I/O のみで無害)。
@MainActor
final class VaultFlushTests: XCTestCase {

    private var vaultRoot: URL!
    private var appSupport: URL!

    override func setUp() {
        super.setUp()
        vaultRoot = makeUniqueTempDir()
        appSupport = makeUniqueTempDir()
    }

    override func tearDown() {
        removeTempDir(vaultRoot)
        removeTempDir(appSupport)
        vaultRoot = nil
        appSupport = nil
        super.tearDown()
    }

    @discardableResult
    private func flush(_ rows: [MandalartRows]) throws -> VaultSync.FlushReport {
        try VaultSync.flushDbToVault(rows: rows, to: vaultRoot, appSupportDir: appSupport)
    }

    @discardableResult
    private func flush(_ rows: [MandalartRows], ledger: VaultWriteLedger) throws -> VaultSync.FlushReport {
        try VaultSync.flushDbToVault(rows: rows, to: vaultRoot, appSupportDir: appSupport, ledger: ledger)
    }

    private func gridURL(_ name: String) -> URL {
        vaultRoot.appendingPathComponent("健康-2026-m-1/\(name)")
    }

    func testInitialFlushWritesAllFiles() throws {
        let report = try flush([sampleRows()])
        XCTAssertEqual(report.mandalarts, 1)
        XCTAssertEqual(report.written, 4) // _mandalart.md + g-root.md + g-drill.md + g-par.md
        XCTAssertEqual(report.deletedDirs, 0)
        XCTAssertTrue(VaultIO.pathExists(vaultRoot.appendingPathComponent("健康-2026-m-1/g-root.md")))
    }

    func testSecondFlushWritesNothing() throws {
        try flush([sampleRows()])
        let report = try flush([sampleRows()])
        XCTAssertEqual(report.written, 0)
        XCTAssertEqual(report.deleted, 0)
    }

    func testEditingOneCellRewritesOnlyThatGridFile() throws {
        try flush([sampleRows()])
        var rows = sampleRows()
        // 子を持たない周辺セル (c-root-p0「食事」) を編集 → 他ファイルへ波及せず g-root.md だけ書き換わる。
        // (中心セル編集は子グリッドの戻りリンクラベルにも波及するため別ファイルも変わる = 正しい挙動)
        let idx = rows.cells.firstIndex { $0.id == "c-root-p0" }!
        rows.cells[idx].text = "食事(編集)"
        let report = try flush([rows])
        XCTAssertEqual(report.written, 1) // g-root.md だけ
    }

    func testUpdatedAtOnlyDiffIsChurnSuppressed() throws {
        try flush([sampleRows()])
        var rows = sampleRows()
        for i in rows.grids.indices { rows.grids[i].updatedAt = "2027-01-01T00:00:00.000Z" }
        for i in rows.cells.indices { rows.cells[i].updatedAt = "2027-01-01T00:00:00.000Z" }
        rows.mandalart.updatedAt = "2027-01-01T00:00:00.000Z"
        let report = try flush([rows])
        XCTAssertEqual(report.written, 0) // updated_at だけの差は書き換えない
    }

    func testRemovedMandalartFolderIsDeleted() throws {
        try flush([sampleRows(), secondSampleRows()])
        XCTAssertTrue(VaultIO.pathExists(vaultRoot.appendingPathComponent("B-m-2")))
        let report = try flush([sampleRows()])
        XCTAssertEqual(report.deletedDirs, 1)
        XCTAssertFalse(VaultIO.pathExists(vaultRoot.appendingPathComponent("B-m-2")))
    }

    func testEmptyRowsDoesNotDeleteAnything() throws {
        try flush([sampleRows()])
        let report = try flush([]) // 空 DB ガード: 何も消さない
        XCTAssertEqual(report.deletedDirs, 0)
        XCTAssertTrue(VaultIO.pathExists(vaultRoot.appendingPathComponent("健康-2026-m-1")))
    }

    // MARK: - clobber 安全化 (echo-skip、Stage ④)

    /// 外部編集されたファイルは auto-flush で潰されず、無関係ファイルだけ書かれる。
    func testExternalEditIsPreservedNotClobbered() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows()], ledger: ledger) // 初回 flush で台帳 seed

        // 外部編集: g-root.md を直接書き換える (台帳と不一致になる)。
        let external = "EXTERNALLY EDITED CONTENT"
        try external.write(to: gridURL("g-root.md"), atomically: true, encoding: .utf8)

        // 無関係な DB フィールド前進 (g-par.md に対応する c-par-p3 を変更)。
        var rows = sampleRows()
        rows.cells[rows.cells.firstIndex { $0.id == "c-par-p3" }!].text = "睡眠(編集)"
        let report = try flush([rows], ledger: ledger)

        XCTAssertEqual(try String(contentsOf: gridURL("g-root.md"), encoding: .utf8), external, "外部編集は潰さない")
        XCTAssertGreaterThanOrEqual(report.skippedExternal, 1)
        XCTAssertTrue(try String(contentsOf: gridURL("g-par.md"), encoding: .utf8).contains("睡眠(編集)"), "無関係ファイルは書く")
    }

    /// 外部編集が無ければ自分の DB 前進は通常どおり書かれる (guard で止まらない)。
    func testOwnAdvanceStillWritesWithLedger() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows()], ledger: ledger)
        var rows = sampleRows()
        rows.cells[rows.cells.firstIndex { $0.id == "c-root-p0" }!].text = "食事(編集)"
        let report = try flush([rows], ledger: ledger)
        XCTAssertEqual(report.written, 1)
        XCTAssertEqual(report.skippedExternal, 0)
    }

    /// 外部作成された新規ファイルは flush の差分削除で消さない。
    func testExternalNewFileNotDeleted() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows()], ledger: ledger)
        let extra = gridURL("extra.md")
        try "stray".write(to: extra, atomically: true, encoding: .utf8)
        let report = try flush([sampleRows()], ledger: ledger)
        XCTAssertTrue(VaultIO.pathExists(extra), "外部作成ファイルは残す")
        XCTAssertEqual(report.deleted, 0)
    }

    /// 自分が作ったファイルが DB から消えれば従来どおり削除される。
    func testOwnRemovedFileStillDeleted() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows()], ledger: ledger)
        XCTAssertTrue(VaultIO.pathExists(gridURL("g-drill.md")))
        var rows = sampleRows()
        rows.cells.removeAll { $0.id == "c-drill-p1" } // g-drill が空 → 焼かれない
        let report = try flush([rows], ledger: ledger)
        XCTAssertFalse(VaultIO.pathExists(gridURL("g-drill.md")))
        XCTAssertGreaterThanOrEqual(report.deleted, 1)
    }

    /// churn 抑止は台帳ありでも有効 (guard が churn 抑止の後で走る証明)。
    func testChurnSuppressedWithLedger() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows()], ledger: ledger)
        var rows = sampleRows()
        for i in rows.grids.indices { rows.grids[i].updatedAt = "2027-01-01T00:00:00.000Z" }
        for i in rows.cells.indices { rows.cells[i].updatedAt = "2027-01-01T00:00:00.000Z" }
        rows.mandalart.updatedAt = "2027-01-01T00:00:00.000Z"
        let report = try flush([rows], ledger: ledger)
        XCTAssertEqual(report.written, 0)
        XCTAssertEqual(report.skippedExternal, 0)
    }

    /// 削除マンダラートの dir は全ファイルが自分のものなら削除。
    func testRemovedMandalartDirDeletedWhenFullyOwned() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows(), secondSampleRows()], ledger: ledger)
        let report = try flush([sampleRows()], ledger: ledger)
        XCTAssertEqual(report.deletedDirs, 1)
        XCTAssertFalse(VaultIO.pathExists(vaultRoot.appendingPathComponent("B-m-2")))
    }

    /// 削除マンダラートの dir に外部ファイルがあれば dir ごと残す (誤削除しない)。
    func testRemovedMandalartDirKeptWhenExternalFilePresent() throws {
        let ledger = VaultWriteLedger()
        try flush([sampleRows(), secondSampleRows()], ledger: ledger)
        try "stray".write(
            to: vaultRoot.appendingPathComponent("B-m-2/note.md"), atomically: true, encoding: .utf8)
        let report = try flush([sampleRows()], ledger: ledger)
        XCTAssertEqual(report.deletedDirs, 0)
        XCTAssertTrue(VaultIO.pathExists(vaultRoot.appendingPathComponent("B-m-2")))
    }
}
