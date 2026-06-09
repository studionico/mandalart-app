import XCTest
@testable import Mandalart

/// pull reconcile の削除判定ロジック (`RemoteDeletionReconciler`) を検証する。
/// 正準仕様は desktop [`reconcileDeletions.ts`](../../desktop/src/lib/sync/reconcileDeletions.ts)
/// (desktop 側は `reconcileDeletions.test.ts` でロック)。
final class RemoteDeletionReconcilerTests: XCTestCase {

    private func row(_ id: String, synced: Bool) -> RemoteDeletionReconciler.LocalRow {
        .init(id: id, isSynced: synced)
    }

    func testSyncedAndAbsentFromCloudIsDeleted() {
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [row("a", synced: true), row("b", synced: true)],
            cloudIds: ["a"],
            truncated: false
        )
        XCTAssertEqual(result, ["b"])
    }

    func testLocalOnlyNeverDeleted() {
        // synced=false (= 未 push の local-only) は cloud に居なくても絶対に消さない
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [row("a", synced: false), row("b", synced: true)],
            cloudIds: [],
            truncated: false
        )
        XCTAssertEqual(result, ["b"])
    }

    func testPresentInCloudIsKept() {
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [row("a", synced: true), row("b", synced: true)],
            cloudIds: ["a", "b"],
            truncated: false
        )
        XCTAssertEqual(result, [])
    }

    func testTruncatedDeletesNothing() {
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [row("a", synced: true), row("b", synced: true)],
            cloudIds: ["a"],
            truncated: true
        )
        XCTAssertEqual(result, [])
    }

    func testEmptyLocal() {
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [],
            cloudIds: ["a"],
            truncated: false
        )
        XCTAssertEqual(result, [])
    }

    func testEmptyCloudAllSyncedDeleted() {
        let result = RemoteDeletionReconciler.idsToDelete(
            local: [row("a", synced: true), row("b", synced: true)],
            cloudIds: [],
            truncated: false
        )
        XCTAssertEqual(result, ["a", "b"])
    }
}
