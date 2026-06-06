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

    // MARK: diffFilesGuarded (clobber 安全化、Stage ④)

    func testGuardedWriteTruthTable() {
        let existing = [
            VaultFile(path: "same.md", content: "S"),     // disk == desired → no-op
            VaultFile(path: "mine.md", content: "M"),      // disk ≠ desired, 自分の最後の書込み → write
            VaultFile(path: "ext.md", content: "EXTERNAL"), // disk ≠ desired, 外部編集 → skip
            VaultFile(path: "untracked.md", content: "U"), // disk ≠ desired, 台帳に無い → skip
        ]
        let desired = [
            VaultFile(path: "same.md", content: "S"),
            VaultFile(path: "mine.md", content: "M2"),
            VaultFile(path: "ext.md", content: "E2"),
            VaultFile(path: "untracked.md", content: "U2"),
            VaultFile(path: "new.md", content: "N"),       // disk 無し → write
        ]
        // 台帳: mine.md は現 disk と一致、ext.md は古い hash (= 現 disk と不一致)、untracked.md は無し。
        let ledger: [String: String] = [
            "mine.md": hashContent("M"),
            "ext.md": hashContent("OLD"),
        ]
        let plan = diffFilesGuarded(existing: existing, desired: desired, ledgerHash: { ledger[$0] })
        XCTAssertEqual(plan.write.map(\.path).sorted(), ["mine.md", "new.md"])
        XCTAssertEqual(plan.skippedExternal.sorted(), ["ext.md", "untracked.md"])
    }

    func testGuardedDeleteOnlyOwnedUnchanged() {
        let existing = [
            VaultFile(path: "owned.md", content: "O"),   // 台帳==hash → 消してよい
            VaultFile(path: "extnew.md", content: "X"),  // 台帳に無い (外部作成) → 残す
            VaultFile(path: "extedit.md", content: "Y"), // 台帳はあるが hash 不一致 (外部編集) → 残す
        ]
        let desired: [VaultFile] = [] // すべて desired から消えた
        let ledger: [String: String] = [
            "owned.md": hashContent("O"),
            "extedit.md": hashContent("OLD"),
        ]
        let plan = diffFilesGuarded(existing: existing, desired: desired, ledgerHash: { ledger[$0] })
        XCTAssertEqual(plan.deletePaths, ["owned.md"])
        XCTAssertTrue(plan.write.isEmpty)
    }
}
