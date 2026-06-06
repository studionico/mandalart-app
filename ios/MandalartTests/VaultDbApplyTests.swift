import XCTest
import SwiftData

/// VaultDbApply (vault→DB 実書込み) のユニットテスト。in-memory ModelContainer で検証。
/// desktop `__tests__/applyToDb.test.ts` の Swift 移植。
@MainActor
final class VaultDbApplyTests: XCTestCase {

    private var context: ModelContext!

    override func setUp() {
        super.setUp()
        context = makeInMemoryContext()
    }

    override func tearDown() {
        context = nil
        super.tearDown()
    }

    /// folder_id は ensureFolderByName が新 id を振るので比較から除外して正規化。
    private func normalize(_ rows: [MandalartRows]) -> [MandalartRows] {
        rows.map { row in
            var m = row.mandalart
            m.folderId = nil
            return MandalartRows(
                mandalart: m,
                folderName: row.folderName,
                grids: row.grids.sorted { $0.id < $1.id },
                cells: row.cells.sorted { $0.id < $1.id }
            )
        }.sorted { $0.mandalart.id < $1.mandalart.id }
    }

    private func count<T: PersistentModel>(_ type: T.Type) -> Int {
        (try? context.fetch(FetchDescriptor<T>()))?.count ?? -1
    }
    private func gridExists(_ id: String) -> Bool {
        ((try? context.fetch(FetchDescriptor<Grid>(predicate: #Predicate { $0.id == id })))?.isEmpty == false)
    }
    private func cellExists(_ id: String) -> Bool {
        ((try? context.fetch(FetchDescriptor<Cell>(predicate: #Predicate { $0.id == id })))?.isEmpty == false)
    }

    func testApplyRestoresFromEmpty() {
        let before = [sampleRows()]
        VaultDbApply.applyVaultRowsToDb(before, in: context)
        let after = VaultRowsBridge.loadAllMandalartRows(in: context)
        XCTAssertEqual(normalize(after), normalize(before))
    }

    func testApplyIsIdempotent() {
        let before = [sampleRows()]
        VaultDbApply.applyVaultRowsToDb(before, in: context)
        let grids = count(Grid.self)
        let cells = count(Cell.self)
        VaultDbApply.applyVaultRowsToDb(before, in: context)
        XCTAssertEqual(count(Grid.self), grids)
        XCTAssertEqual(count(Cell.self), cells)
        XCTAssertEqual(normalize(VaultRowsBridge.loadAllMandalartRows(in: context)), normalize(before))
    }

    func testApplyDeletesMissingGridsAndCells() {
        VaultDbApply.applyVaultRowsToDb([sampleRows()], in: context)
        context.insert(Grid(id: "bogus-grid", mandalartId: "m-1", centerCellId: "bogus-cell", parentCellId: nil, sortOrder: 99))
        context.insert(Cell(id: "bogus-cell", gridId: "bogus-grid", position: 4, text: "x"))
        try? context.save()

        VaultDbApply.applyVaultRowsToDb([sampleRows()], in: context)
        XCTAssertFalse(gridExists("bogus-grid"))
        XCTAssertFalse(cellExists("bogus-cell"))
    }

    func testSkipGridDeletionForProtects() {
        VaultDbApply.applyVaultRowsToDb([sampleRows()], in: context)
        context.insert(Grid(id: "keep-grid", mandalartId: "m-1", centerCellId: "keep-cell", parentCellId: nil, sortOrder: 99))
        context.insert(Cell(id: "keep-cell", gridId: "keep-grid", position: 4, text: "x"))
        try? context.save()

        VaultDbApply.applyVaultRowsToDb(
            [sampleRows()], in: context, options: VaultApplyOptions(skipGridDeletionFor: ["m-1"]))
        XCTAssertTrue(gridExists("keep-grid"))
        XCTAssertTrue(cellExists("keep-cell"))
    }

    func testDeleteMissingMandalarts() {
        VaultDbApply.applyVaultRowsToDb([sampleRows(), secondSampleRows()], in: context)
        XCTAssertEqual(count(Mandalart.self), 2)

        // false: m-2 は残る
        VaultDbApply.applyVaultRowsToDb(
            [sampleRows()], in: context, options: VaultApplyOptions(deleteMissingMandalarts: false))
        XCTAssertEqual(count(Mandalart.self), 2)

        // true: m-2 は消える
        let report = VaultDbApply.applyVaultRowsToDb(
            [sampleRows()], in: context, options: VaultApplyOptions(deleteMissingMandalarts: true))
        XCTAssertEqual(report.deletedMandalarts, 1)
        XCTAssertEqual(count(Mandalart.self), 1)
    }
}
