import XCTest

/// VaultSync (exportAllToVault / dryRunScan) のユニットテスト。temp ディレクトリで実ファイル I/O する。
/// desktop `_vaultSync.ts` の export / dryRun に対応。
final class VaultSyncTests: XCTestCase {

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

    private func seedLocalImage(_ relPath: String, _ bytes: Data) {
        let url = appSupport.appendingPathComponent(relPath)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? bytes.write(to: url)
    }

    func testExportWritesFilesToDisk() throws {
        let report = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        XCTAssertEqual(report.mandalarts, 1)
        XCTAssertEqual(report.files, 4) // _mandalart.md + g-root.md + g-drill.md + g-par.md

        let dir = vaultRoot.appendingPathComponent("健康-2026-m-1")
        XCTAssertTrue(VaultIO.pathExists(dir.appendingPathComponent(mandalartDocName)))
        XCTAssertTrue(VaultIO.pathExists(dir.appendingPathComponent("g-root.md")))
        XCTAssertTrue(VaultIO.pathExists(dir.appendingPathComponent("g-par.md")))
    }

    func testExportCopiesImagesToAttachments() throws {
        // sampleRows の c-root-p2 は imagePath = images/c-root-p2-1.jpg。ローカルに実体を置く。
        seedLocalImage("images/c-root-p2-1.jpg", Data([1, 2, 3]))
        let report = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        XCTAssertEqual(report.imagesCopied, 1)
        XCTAssertTrue(VaultIO.pathExists(vaultRoot.appendingPathComponent("attachments/c-root-p2-1.jpg")))
    }

    func testExportThenDryRunRoundTrip() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        let report = try VaultSync.dryRunScan(at: vaultRoot)
        XCTAssertEqual(report.mandalarts, 1)
        XCTAssertEqual(report.grids, 3) // g-root / g-drill / g-par
        XCTAssertEqual(report.cells, 6) // sampleRows の cells 数
    }

    func testDryRunOnEmptyVaultIsZero() throws {
        let report = try VaultSync.dryRunScan(at: vaultRoot)
        XCTAssertEqual(report, VaultSync.DryRunReport(mandalarts: 0, grids: 0, cells: 0))
    }
}
