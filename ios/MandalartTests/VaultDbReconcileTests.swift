import XCTest
import SwiftData

/// VaultDbReconcile (vault フォルダ→DB 再構築) のユニットテスト。temp フォルダ + in-memory DB。
/// desktop `_vaultSync.reconcileVaultToDb` の round-trip / 破損検知に対応。
@MainActor
final class VaultDbReconcileTests: XCTestCase {

    private var context: ModelContext!
    private var vaultRoot: URL!
    private var appSupport: URL!

    override func setUp() {
        super.setUp()
        context = makeInMemoryContext()
        vaultRoot = makeUniqueTempDir()
        appSupport = makeUniqueTempDir()
    }

    override func tearDown() {
        removeTempDir(vaultRoot)
        removeTempDir(appSupport)
        context = nil
        vaultRoot = nil
        appSupport = nil
        super.tearDown()
    }

    private func gridExists(_ id: String) -> Bool {
        ((try? context.fetch(FetchDescriptor<Grid>(predicate: #Predicate { $0.id == id })))?.isEmpty == false)
    }

    func testReconcileRebuildsFromVault() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        let report = try VaultDbReconcile.reconcileVaultToDb(
            vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertEqual(report.mandalarts, 1)
        XCTAssertEqual(report.grids, 3)
        XCTAssertEqual(report.cells, 6)
        let restored = VaultRowsBridge.loadAllMandalartRows(in: context)
        XCTAssertEqual(restored.first?.grids.map(\.id).sorted(), ["g-drill", "g-par", "g-root"])
    }

    func testReconcileSkipsDeletionOnCorruptGridFile() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        // vault に無い bogus grid を事前に DB へ入れておく。
        context.insert(Grid(id: "bogus-grid", mandalartId: "m-1", centerCellId: "bogus-cell", parentCellId: nil, sortOrder: 99))
        try? context.save()
        // grid .md を 1 つ破損させる → parse 失敗 → 破損検知で skipGridDeletionFor に入り削除されない。
        let dir = vaultRoot.appendingPathComponent("健康-2026-m-1")
        try "これは壊れた内容".write(to: dir.appendingPathComponent("g-par.md"), atomically: true, encoding: .utf8)

        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertTrue(gridExists("bogus-grid"), "破損検知でこのマンダラートの grid 削除はスキップされる")
    }
}
