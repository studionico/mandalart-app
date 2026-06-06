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

    private func fetchCell(_ id: String) -> Cell? {
        (try? context.fetch(FetchDescriptor<Cell>(predicate: #Predicate { $0.id == id })))?.first
    }

    /// `健康-2026-m-1/<name>` の内容を読み、置換クロージャで本文を書き換えて保存する。
    private func editGridFile(_ name: String, _ transform: (String) -> String) throws {
        let url = vaultRoot.appendingPathComponent("健康-2026-m-1/\(name)")
        let edited = transform(try String(contentsOf: url, encoding: .utf8))
        try edited.write(to: url, atomically: true, encoding: .utf8)
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

    // MARK: - 本文ラウンドトリップ Stage ③ (本文編集 → reconcile → DB 反映、applyBody=true 経路)

    /// 本文セル見出しの text / done / color 編集が DB に反映される (本文が frontmatter より canonical)。
    func testReconcileAppliesBodyTextDoneColorEdits() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertEqual(fetchCell("c-par-p3")?.text, "睡眠")

        // g-par.md の本文セル見出しだけを編集 (frontmatter の cells JSON は変えない → 本文が正と確認できる)。
        try editGridFile("g-par.md") {
            $0.replacingOccurrences(
                of: "## [ ] 睡眠 #c/blue-100 ^p3",
                with: "## [x] 睡眠改善 #c/red-100 ^p3")
        }

        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        let cell = fetchCell("c-par-p3")
        XCTAssertEqual(cell?.text, "睡眠改善")
        XCTAssertEqual(cell?.done, true)
        XCTAssertEqual(cell?.color, "red-100")
    }

    /// 本文から `![[ ]]` embed 行が消えた = 画像クリアが DB に反映される。
    func testReconcileAppliesBodyImageClear() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertEqual(fetchCell("c-root-p2")?.imagePath, "images/c-root-p2-1.jpg")

        // c-root-p2 見出しの次行 embed を削除 → hasImage=false → 画像クリア。
        try editGridFile("g-root.md") {
            $0.replacingOccurrences(of: "\n![[c-root-p2-1.jpg]]", with: "")
        }

        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertNil(fetchCell("c-root-p2")?.imagePath, "本文の embed 削除で画像がクリアされる")
    }

    /// 本文から見出しを丸ごと削除しても、frontmatter にあるセルは誤削除されない (欠落 position 維持)。
    func testReconcileKeepsCellMissingFromBody() throws {
        _ = try VaultSync.exportAllToVault(rows: [sampleRows()], to: vaultRoot, appSupportDir: appSupport)
        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertEqual(fetchCell("c-root-p0")?.text, "食事")

        // 本文の "食事" 見出し行だけ削除 (frontmatter には残す)。
        try editGridFile("g-root.md") {
            $0.replacingOccurrences(of: "\n## [ ] 食事 ^p0", with: "")
        }

        _ = try VaultDbReconcile.reconcileVaultToDb(vaultRoot: vaultRoot, in: context, appSupportDir: appSupport)
        XCTAssertEqual(fetchCell("c-root-p0")?.text, "食事", "本文に無い position は frontmatter 値で維持される")
    }
}
