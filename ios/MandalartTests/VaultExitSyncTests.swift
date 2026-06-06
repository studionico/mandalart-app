import XCTest
import SwiftData

/// VaultExitSync (vault OFF 遷移時の updated_at 整備) のユニットテスト。in-memory DB。
/// 全行の updatedAt を now に bump し、syncedAt は不変 (= syncedAt < updatedAt で push 対象=dirty) を検証する。
@MainActor
final class VaultExitSyncTests: XCTestCase {

    private var context: ModelContext!
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000) // 既存 (synced) 状態
    private let future = Date(timeIntervalSince1970: 1_800_000_000) // bump 先

    override func setUp() {
        super.setUp()
        context = makeInMemoryContext()
    }

    override func tearDown() {
        context = nil
        super.tearDown()
    }

    /// 同期済み (updatedAt==syncedAt==T0) の各行を bump → updatedAt=future / syncedAt 不変 = dirty 化。
    func testMarkLocalRowsDirtyBumpsUpdatedAtKeepsSyncedAt() {
        context.insert(Mandalart(id: "m", title: "T", rootCellId: "c", createdAt: t0, updatedAt: t0, syncedAt: t0))
        context.insert(Grid(id: "g", mandalartId: "m", centerCellId: "c", createdAt: t0, updatedAt: t0, syncedAt: t0))
        context.insert(Cell(id: "c", gridId: "g", position: 4, createdAt: t0, updatedAt: t0, syncedAt: t0))
        context.insert(Folder(id: "f", name: "Inbox", createdAt: t0, updatedAt: t0, syncedAt: t0))
        try? context.save()

        let count = VaultExitSync.markLocalRowsDirty(now: future, in: context)
        XCTAssertEqual(count, 4)

        let m = try! context.fetch(FetchDescriptor<Mandalart>()).first!
        let g = try! context.fetch(FetchDescriptor<Grid>()).first!
        let c = try! context.fetch(FetchDescriptor<Cell>()).first!
        let f = try! context.fetch(FetchDescriptor<Folder>()).first!
        for (updated, synced) in [(m.updatedAt, m.syncedAt), (g.updatedAt, g.syncedAt),
                                  (c.updatedAt, c.syncedAt), (f.updatedAt, f.syncedAt)] {
            XCTAssertEqual(updated, future, "updatedAt は now に bump")
            XCTAssertEqual(synced, t0, "syncedAt は不変")
            XCTAssertTrue(synced! < updated, "syncedAt < updatedAt = push 対象 (dirty)")
        }
    }

    /// soft-deleted 行 (tombstone) も bump される (ローカル全面勝ち)。
    func testMarkLocalRowsDirtyIncludesDeletedRows() {
        context.insert(Mandalart(
            id: "m", title: "T", rootCellId: "c", createdAt: t0, updatedAt: t0, deletedAt: t0, syncedAt: t0))
        try? context.save()

        let count = VaultExitSync.markLocalRowsDirty(now: future, in: context)
        XCTAssertEqual(count, 1)
        let m = try! context.fetch(FetchDescriptor<Mandalart>()).first!
        XCTAssertEqual(m.updatedAt, future)
        XCTAssertNotNil(m.deletedAt, "tombstone のまま (deletedAt は維持)")
    }
}
