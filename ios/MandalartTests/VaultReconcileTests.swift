import XCTest

/// desktop `__tests__/reconcile.test.ts` の Swift 移植。
final class VaultReconcileTests: XCTestCase {

    // MARK: hashContent

    func testHashContentIsDeterministicAndHex() {
        let a = hashContent("hello")
        let b = hashContent("hello")
        let c = hashContent("hello!")
        XCTAssertEqual(a, b)
        XCTAssertNotEqual(a, c)
        XCTAssertEqual(a.count, 64)
        XCTAssertNil(a.range(of: "[^0-9a-f]", options: .regularExpression), "64 桁 hex のみ")
    }

    // MARK: diffById

    func testDiffByIdPlansUpsertAndDelete() {
        let existing = [
            Diffable(id: "a", hash: "1"),
            Diffable(id: "b", hash: "2"),
            Diffable(id: "d", hash: "4"),
        ]
        let incoming = [
            Diffable(id: "a", hash: "1"), // 不変
            Diffable(id: "b", hash: "9"), // 変更
            Diffable(id: "c", hash: "3"), // 新規
        ]
        let plan = diffById(existing: existing, incoming: incoming)
        XCTAssertEqual(plan.upsertIds.sorted(), ["b", "c"])
        XCTAssertEqual(plan.deleteIds, ["d"])
    }

    func testDiffByIdEmptyIsNoop() {
        XCTAssertEqual(diffById(existing: [], incoming: []), DiffPlan(upsertIds: [], deleteIds: []))
    }

    // MARK: diffFiles

    func testDiffFilesWritesChangedAndNewDeletesGone() {
        let existing = [
            VaultFile(path: "a.md", content: "A"),
            VaultFile(path: "b.md", content: "B"),
            VaultFile(path: "gone.md", content: "G"),
        ]
        let desired = [
            VaultFile(path: "a.md", content: "A"),  // 不変 → write しない
            VaultFile(path: "b.md", content: "B2"), // 変更
            VaultFile(path: "c.md", content: "C"),  // 新規
        ]
        let plan = diffFiles(existing: existing, desired: desired)
        XCTAssertEqual(plan.write.map(\.path).sorted(), ["b.md", "c.md"])
        XCTAssertEqual(plan.deletePaths, ["gone.md"])
    }

    // MARK: shouldSkipEcho

    func testShouldSkipEcho() {
        let recent: Set<String> = ["h1", "h2"]
        XCTAssertTrue(shouldSkipEcho("h1", recentWrites: recent))
        XCTAssertFalse(shouldSkipEcho("h3", recentWrites: recent))
    }
}
