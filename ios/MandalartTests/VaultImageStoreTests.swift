import XCTest

/// VaultImageStore (画像の vault attachments 化) のユニットテスト。
/// desktop `imageVault.ts` の flushImagesToVault / restoreImagesFromVault に対応。
final class VaultImageStoreTests: XCTestCase {

    private var appSupport: URL!
    private var vaultRoot: URL!

    override func setUp() {
        super.setUp()
        appSupport = makeUniqueTempDir()
        vaultRoot = makeUniqueTempDir()
    }

    override func tearDown() {
        removeTempDir(appSupport)
        removeTempDir(vaultRoot)
        appSupport = nil
        vaultRoot = nil
        super.tearDown()
    }

    /// appSupport/images/<basename> に画像バイトを置く。
    private func seedLocalImage(_ relPath: String, _ bytes: Data) {
        let url = appSupport.appendingPathComponent(relPath)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? bytes.write(to: url)
    }

    func testFlushCopiesImagesToAttachments() {
        let bytes = Data([1, 2, 3, 4])
        seedLocalImage("images/c1-100.jpg", bytes)
        let cells = [makeCell("c1", "g", 4, text: "x", imagePath: "images/c1-100.jpg")]

        let copied = VaultImageStore.flushImagesToVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells)
        XCTAssertEqual(copied, 1)
        let dest = vaultRoot.appendingPathComponent("attachments/c1-100.jpg")
        XCTAssertEqual(VaultIO.readBytes(dest), bytes)

        // 2 回目は既存 skip で 0。
        XCTAssertEqual(VaultImageStore.flushImagesToVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells), 0)
    }

    func testFlushSkipsWhenLocalSourceMissing() {
        // ローカルに実ファイルが無い (cloud 由来未 download 等) → コピーしない。
        let cells = [makeCell("c1", "g", 4, text: "x", imagePath: "images/missing.jpg")]
        XCTAssertEqual(VaultImageStore.flushImagesToVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells), 0)
        XCTAssertFalse(VaultIO.pathExists(vaultRoot.appendingPathComponent("attachments/missing.jpg")))
    }

    func testRestoreWritesBackWhenLocalMissing() {
        // vault には attachments/ があるがローカル appSupport は空 (別マシン想定)。
        let bytes = Data([9, 8, 7])
        let att = vaultRoot.appendingPathComponent("attachments/c1-100.jpg")
        try? FileManager.default.createDirectory(at: att.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? bytes.write(to: att)

        let cells = [makeCell("c1", "g", 4, text: "x", imagePath: "images/c1-100.jpg")]
        let restored = VaultImageStore.restoreImagesFromVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells)
        XCTAssertEqual(restored, 1)
        XCTAssertEqual(VaultIO.readBytes(appSupport.appendingPathComponent("images/c1-100.jpg")), bytes)
    }

    func testRestoreSkipsWhenLocalAlreadyExists() {
        // ローカルに既にあるなら復元しない (上書き回避)。
        let local = Data([1])
        seedLocalImage("images/c1-100.jpg", local)
        let att = vaultRoot.appendingPathComponent("attachments/c1-100.jpg")
        try? FileManager.default.createDirectory(at: att.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data([2]).write(to: att)

        let cells = [makeCell("c1", "g", 4, text: "x", imagePath: "images/c1-100.jpg")]
        XCTAssertEqual(VaultImageStore.restoreImagesFromVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells), 0)
        XCTAssertEqual(VaultIO.readBytes(appSupport.appendingPathComponent("images/c1-100.jpg")), local)
    }

    func testImagelessCellsAreNoop() {
        let cells = [makeCell("c1", "g", 4, text: "no image")]
        XCTAssertEqual(VaultImageStore.flushImagesToVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells), 0)
        XCTAssertEqual(VaultImageStore.restoreImagesFromVault(vaultRoot: vaultRoot, appSupportDir: appSupport, cells: cells), 0)
    }
}
