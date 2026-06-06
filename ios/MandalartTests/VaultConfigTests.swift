import XCTest

/// VaultConfig + security-scoped bookmark のユニットテスト。
/// desktop `config.ts` の VaultConfig / shouldRebuildOnStartup に対応 (iOS は bookmark ベース)。
final class VaultConfigTests: XCTestCase {

    private var tempDir: URL!

    override func setUp() {
        super.setUp()
        tempDir = makeUniqueTempDir()
    }

    override func tearDown() {
        removeTempDir(tempDir)
        tempDir = nil
        super.tearDown()
    }

    // MARK: bookmark

    func testBookmarkMakeResolveRoundTrip() throws {
        let data = try VaultBookmark.make(for: tempDir)
        XCTAssertFalse(data.isEmpty)
        let resolved = VaultBookmark.resolve(data)
        XCTAssertNotNil(resolved)
        // NSTemporaryDirectory は /var → /private/var symlink を挟むので resolvingSymlinksInPath で比較。
        XCTAssertEqual(
            resolved?.url.resolvingSymlinksInPath().path,
            tempDir.resolvingSymlinksInPath().path
        )
    }

    func testResolveRejectsGarbage() {
        XCTAssertNil(VaultBookmark.resolve(Data([0x00, 0x01, 0x02])))
    }

    func testWithAccessRunsBody() {
        var ran = false
        VaultBookmark.withAccess(tempDir) { ran = true }
        XCTAssertTrue(ran)
    }

    // MARK: shouldRebuildOnStartup

    func testShouldRebuildOnStartup() {
        XCTAssertFalse(shouldRebuildOnStartup(.empty))
        XCTAssertFalse(shouldRebuildOnStartup(VaultConfig(vaultMode: true, vaultBookmark: nil, vaultPath: "/x")))
        XCTAssertTrue(shouldRebuildOnStartup(VaultConfig(vaultMode: true, vaultBookmark: Data([1]), vaultPath: "/x")))
    }

    // MARK: UserDefaults 永続化

    func testConfigStoreRoundTrip() throws {
        let suite = "vault.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let config = VaultConfig(vaultMode: true, vaultBookmark: Data([10, 20]), vaultPath: "/vault/path")
        VaultConfigStore.save(config, to: defaults)
        XCTAssertEqual(VaultConfigStore.load(from: defaults), config)

        // nil クリアが永続化される。
        VaultConfigStore.save(.empty, to: defaults)
        XCTAssertEqual(VaultConfigStore.load(from: defaults), .empty)
    }
}
