import XCTest

/// VaultSync.flushDbToVault (DB→vault 差分 flush) のユニットテスト。temp フォルダで実ファイル I/O。
/// desktop `_vaultSync.flushDbToVault` の差分 / churn 抑止 / 削除に対応。
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
}
