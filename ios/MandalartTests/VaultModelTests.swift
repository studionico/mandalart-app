import XCTest

/// desktop `__tests__/vaultModel.test.ts` の round-trip / ファイル構成 / lazy / Obsidian 双方向
/// リンク / 画像 embed / フォルダ名 の Swift 移植。
final class VaultModelTests: XCTestCase {

    private func fileContent(_ rows: MandalartRows, _ path: String) -> String {
        mandalartToVaultFiles(rows).files.first { $0.path == path }!.content
    }

    // MARK: round-trip

    func testRoundTripPreservesIds() {
        let rows = sampleRows()
        let vault = mandalartToVaultFiles(rows)
        let restored = vaultFilesToRows(vault.files)
        XCTAssertNotNil(restored)
        guard let restored else { return }

        XCTAssertEqual(restored.folderName, "Inbox")
        // folder_id は vault に無い (folder_name が正)、last_grid_id は端末ローカル UI 状態で vault に
        // 焼かない (import で nil) ので、それらを正規化して比較する。
        var expectedMandalart = rows.mandalart
        expectedMandalart.folderId = nil
        expectedMandalart.lastGridId = nil
        XCTAssertEqual(restored.mandalart, expectedMandalart)

        XCTAssertEqual(sortedById(restored.grids, \.id), sortedById(rows.grids, \.id))
        XCTAssertEqual(sortedById(restored.cells, \.id), sortedById(rows.cells, \.id))
    }

    func testFileCompositionAndDirName() {
        let vault = mandalartToVaultFiles(sampleRows())
        XCTAssertEqual(vault.files.map(\.path).sorted(), [mandalartDocName, "g-drill.md", "g-par.md", "g-root.md"])
        XCTAssertEqual(vault.dirName, "健康-2026-m-1") // slug + id6 (id='m-1' → 先頭6文字)
    }

    func testLazyCellNotInflatedOnRoundTrip() {
        let rows = sampleRows()
        let restored = vaultFilesToRows(mandalartToVaultFiles(rows).files)!
        XCTAssertEqual(restored.cells.count, rows.cells.count)
    }

    func testLazyGridSkipsEmptyGrid() {
        var rows = sampleRows()
        rows.grids.append(makeGrid("g-empty", centerCellId: "c-root-p0", parentCellId: "c-root-p0", sortOrder: 0))
        let paths = mandalartToVaultFiles(rows).files.map(\.path)
        XCTAssertFalse(paths.contains("g-empty.md"))
    }

    func testMemoOnlyGridIsWritten() {
        var rows = sampleRows()
        rows.grids.append(makeGrid("g-memo", centerCellId: "c-root-p0", parentCellId: "c-root-p0", sortOrder: 0, memo: "メモだけ"))
        let paths = mandalartToVaultFiles(rows).files.map(\.path)
        XCTAssertTrue(paths.contains("g-memo.md"))
    }

    func testMissingMandalartDocYieldsNil() {
        let vault = mandalartToVaultFiles(sampleRows())
        let withoutMeta = vault.files.filter { $0.path != mandalartDocName }
        XCTAssertNil(vaultFilesToRows(withoutMeta))
    }

    func testCorruptedGridFileIsSkipped() {
        let vault = mandalartToVaultFiles(sampleRows())
        let corrupted = vault.files.map { f in
            f.path == "g-par.md" ? VaultFile(path: f.path, content: "これは壊れた内容") : f
        }
        let restored = vaultFilesToRows(corrupted)!
        XCTAssertEqual(restored.grids.map(\.id).sorted(), ["g-drill", "g-root"])
    }

    // MARK: Obsidian 双方向リンク (本文 wiki-link)

    func testParentToChildLink() {
        let root = fileContent(sampleRows(), "g-root.md")
        // c-root-p2「運動」は g-drill を drill しているのでリンク (^p2)、c-root-p0「食事」は子なしで素のテキスト (^p0)。
        // 本文ラウンドトリップ正準形: `## [done] <text> ^pN`。
        XCTAssertTrue(root.contains("[[g-drill|運動]]"))
        XCTAssertTrue(root.contains("^p2"))
        XCTAssertTrue(root.contains("## [ ] 食事 ^p0"))
        XCTAssertNil(root.range(of: "\\[\\[[^\\]]*食事", options: .regularExpression))
    }

    func testChildToParentLink() {
        let drill = fileContent(sampleRows(), "g-drill.md")
        // g-drill の親セル c-root-p2 は g-root 所属 → 親グリッド g-root、ラベルは g-root 中心「健康」
        XCTAssertTrue(drill.contains("親: [[g-root|健康]]"))
    }

    func testRootAndParallelLinkBackToMandalartDoc() {
        XCTAssertTrue(fileContent(sampleRows(), "g-root.md").contains("親: [[_mandalart|健康 / 2026]]"))
        XCTAssertTrue(fileContent(sampleRows(), "g-par.md").contains("親: [[_mandalart|健康 / 2026]]"))
    }

    func testMandalartDocAndRootGridAreBidirectional() {
        XCTAssertTrue(fileContent(sampleRows(), "_mandalart.md").contains("[[g-root|健康 / 2026]]"))
        XCTAssertTrue(fileContent(sampleRows(), "g-root.md").contains("[[_mandalart|健康 / 2026]]"))
    }

    func testAddingBodyLinksDoesNotAffectRoundTrip() {
        let rows = sampleRows()
        let restored = vaultFilesToRows(mandalartToVaultFiles(rows).files)!
        XCTAssertEqual(sortedById(restored.grids, \.id), sortedById(rows.grids, \.id))
        XCTAssertEqual(sortedById(restored.cells, \.id), sortedById(rows.cells, \.id))
    }

    // MARK: 画像 embed

    func testImageCellEmitsObsidianEmbed() {
        let root = fileContent(sampleRows(), "g-root.md")
        XCTAssertTrue(root.contains("![[c-root-p2-1.jpg]]"))
        XCTAssertFalse(root.contains("![[c-root-p0"))
    }

    func testImageOnlyCellEmitsPositionHeadingAndEmbed() {
        var rows = sampleRows()
        rows.cells.append(makeCell("c-root-p5", "g-root", 5, text: "", imagePath: "images/only-img.jpg"))
        let root = fileContent(rows, "g-root.md")
        XCTAssertTrue(root.contains("![[only-img.jpg]]"))
        // 本文ラウンドトリップ用に、画像のみのセルも `^pN` 付き見出し (text 空) を出す。
        XCTAssertTrue(root.contains("## [ ] ^p5"))
        XCTAssertFalse(root.contains("## (無題)"))
    }

    func testColonImagePathEmbedIsSanitized() {
        var rows = sampleRows()
        rows.cells.append(makeCell("c-root-p1", "g-root", 1, text: "画像", imagePath: "images/pending:x:7-1.jpg"))
        let root = fileContent(rows, "g-root.md")
        XCTAssertTrue(root.contains("![[pending-x-7-1.jpg]]"))
        XCTAssertFalse(root.contains(":7-1.jpg]]")) // コロンが残らない
    }

    // MARK: フォルダ名 (untitled 回避)

    func testFolderNameFallsBackToRootCenterTextWhenTitleEmpty() {
        let TS2 = "2026-06-04T00:00:00.000Z"
        let rows = MandalartRows(
            mandalart: VaultMandalart(
                id: "mm-9", userId: "", title: "   ", rootCellId: "rc", showCheckbox: false,
                lastGridId: nil, sortOrder: nil, pinned: false, folderId: nil, locked: false,
                createdAt: TS2, updatedAt: TS2
            ),
            folderName: "Inbox",
            grids: [makeGrid("g-r", centerCellId: "rc", parentCellId: nil)],
            cells: [makeCell("rc", "g-r", 4, text: "実タイトル")]
        )
        XCTAssertEqual(mandalartToVaultFiles(rows).dirName, "実タイトル-mm-9")
    }
}
