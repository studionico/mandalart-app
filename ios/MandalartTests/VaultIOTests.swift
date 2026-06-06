import XCTest

/// VaultIO (FileManager I/O 層) のユニットテスト。temp ディレクトリに対して実ファイル I/O する。
/// desktop `io.ts` の scanVault / scanMandalartDir / write / remove に対応。
final class VaultIOTests: XCTestCase {

    private var root: URL!

    override func setUp() {
        super.setUp()
        root = makeUniqueTempDir()
    }

    override func tearDown() {
        removeTempDir(root)
        root = nil
        super.tearDown()
    }

    private func write(_ url: URL, _ content: String) {
        try? content.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeDir(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func testScanVaultReturnsOnlyMandalartFolders() throws {
        // m1, m2 = 正しいマンダラートフォルダ / nope = _mandalart.md 無し / .obsidian = dot フォルダ
        let m1 = root.appendingPathComponent("m1"); makeDir(m1)
        write(m1.appendingPathComponent(mandalartDocName), "---\nformat: x\n---\n")
        write(m1.appendingPathComponent("g1.md"), "grid")
        let m2 = root.appendingPathComponent("m2"); makeDir(m2)
        write(m2.appendingPathComponent(mandalartDocName), "meta")
        let nope = root.appendingPathComponent("nope"); makeDir(nope)
        write(nope.appendingPathComponent("g.md"), "orphan")
        let dot = root.appendingPathComponent(".obsidian"); makeDir(dot)
        write(dot.appendingPathComponent("config.md"), "x")

        let result = try VaultIO.scanVault(root)
        XCTAssertEqual(result.map(\.dirName).sorted(), ["m1", "m2"])
        let m1Files = result.first { $0.dirName == "m1" }!.files
        XCTAssertEqual(m1Files.map(\.path).sorted(), [mandalartDocName, "g1.md"])
    }

    func testScanMandalartDirReadsOnlyMarkdown() throws {
        let dir = root.appendingPathComponent("m"); makeDir(dir)
        write(dir.appendingPathComponent("a.md"), "AAA")
        write(dir.appendingPathComponent("note.txt"), "ignored")
        let files = try VaultIO.scanMandalartDir(dir)
        XCTAssertEqual(files.map(\.path), ["a.md"])
        XCTAssertEqual(files.first?.content, "AAA")
    }

    func testEnsureWriteRemoveRoundTrip() throws {
        let sub = root.appendingPathComponent("sub/deep", isDirectory: true)
        try VaultIO.ensureDir(sub)
        let file = sub.appendingPathComponent("x.md")
        try VaultIO.writeVaultFile(file, content: "hi")
        XCTAssertTrue(VaultIO.pathExists(file))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "hi")
        try VaultIO.removeVaultFile(file)
        XCTAssertFalse(VaultIO.pathExists(file))
        try VaultIO.removeDir(root.appendingPathComponent("sub"))
        XCTAssertFalse(VaultIO.pathExists(root.appendingPathComponent("sub")))
    }

    func testRemoveIsNoopWhenMissing() throws {
        // 存在しないパスの削除は throw しない。
        XCTAssertNoThrow(try VaultIO.removeVaultFile(root.appendingPathComponent("ghost.md")))
        XCTAssertNoThrow(try VaultIO.removeDir(root.appendingPathComponent("ghostdir")))
    }

    func testReadWriteBytesRoundTrip() throws {
        let url = root.appendingPathComponent("img.bin")
        let data = Data([0x00, 0x01, 0x02, 0xFF])
        try VaultIO.writeBytes(url, data)
        XCTAssertEqual(VaultIO.readBytes(url), data)
        XCTAssertNil(VaultIO.readBytes(root.appendingPathComponent("missing.bin")))
    }
}
