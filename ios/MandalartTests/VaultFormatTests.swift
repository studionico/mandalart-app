import XCTest

/// desktop `__tests__/reconcile.test.ts` の frontmatter codec 部 + `vaultModel.test.ts` の
/// gridKind / slug / parse 防御 / docContentEquivalent / attachmentName 部の Swift 移植。
final class VaultFormatTests: XCTestCase {

    // MARK: frontmatter codec (buildDoc / parseDoc)

    private struct Probe: Codable, Equatable {
        var id: String
        var memo: String?
        var parentCellId: String?
    }

    func testBlockScalarRoundTrips() {
        let probe = Probe(id: "g1", memo: "複数行\n\"引用\" : # など", parentCellId: nil)
        let cells = [SerializedCell(id: "c1", position: 4, text: "", imagePath: nil, color: nil,
                                    done: true, createdAt: TS, updatedAt: TS)]
        let body = "# 健康\n## 運動"
        let doc = buildDoc(
            format: "md-mandalart-v1",
            fields: [("grid", encodeVaultJSON(probe)), ("cells", encodeVaultJSON(cells))],
            body: body
        )
        let parsed = parseDoc(doc)
        XCTAssertEqual(parsed.format, "md-mandalart-v1")
        XCTAssertEqual(decodeVaultJSON(Probe.self, from: parsed.fields["grid"] ?? ""), probe)
        XCTAssertEqual(decodeVaultJSON([SerializedCell].self, from: parsed.fields["cells"] ?? "")?.first?.id, "c1")
        XCTAssertEqual(parsed.body, body)
    }

    func testCRLFRoundTrips() {
        let probe = Probe(id: "g1", memo: nil, parentCellId: "p")
        let lf = buildDoc(format: "f", fields: [("x", encodeVaultJSON(probe))], body: "body")
        let crlf = lf.replacingOccurrences(of: "\n", with: "\r\n")
        let parsed = parseDoc(crlf)
        XCTAssertEqual(decodeVaultJSON(Probe.self, from: parsed.fields["x"] ?? ""), probe)
        XCTAssertEqual(parsed.body, "body")
    }

    func testNoFrontmatterYieldsNilFormat() {
        let parsed = parseDoc("# ただの markdown")
        XCTAssertNil(parsed.format)
        XCTAssertTrue(parsed.fields.isEmpty)
    }

    // MARK: gridKind / slug

    func testGridKind() {
        XCTAssertEqual(gridKind(parentCellId: nil, centerCellId: "x"), .root)
        XCTAssertEqual(gridKind(parentCellId: "y", centerCellId: "y"), .drilled)
        XCTAssertEqual(gridKind(parentCellId: "y", centerCellId: "z"), .parallel)
    }

    func testSlugFoldsUnsafeAndDefaultsUntitled() {
        XCTAssertEqual(slugifyTitle("  a/b:c  "), "a-b-c")
        XCTAssertEqual(slugifyTitle("   "), "untitled")
        XCTAssertEqual(mandalartDirName("", "abcdef123"), "untitled-abcdef")
    }

    // MARK: parse 防御

    func testParseGridDocumentRejectsForeignFormat() {
        XCTAssertNil(parseGridDocument("# ただの markdown", mandalartId: "m-1"))
    }

    func testParseMandalartDocRejectsForeignFormat() {
        XCTAssertNil(parseMandalartDoc("---\nformat: other\n---\n"))
    }

    // MARK: docContentEquivalent (churn 回避: updated_at 無視)

    private func mkM(title: String = "A", folderId: String? = nil, updatedAt: String = TS) -> VaultMandalart {
        VaultMandalart(id: "m", userId: "", title: title, rootCellId: "c", showCheckbox: false,
                       lastGridId: nil, sortOrder: nil, pinned: false, folderId: folderId, locked: false,
                       createdAt: TS, updatedAt: updatedAt)
    }

    func testMandalartDocEquivalentIgnoresUpdatedAt() {
        let a = buildMandalartDoc(mkM(updatedAt: "2026-01-01T00:00:00.000Z"), folderName: "Inbox")
        let b = buildMandalartDoc(mkM(updatedAt: "2026-12-31T00:00:00.000Z"), folderName: "Inbox")
        XCTAssertTrue(docContentEquivalent(a, b))
    }

    func testMandalartDocDiffersByTitle() {
        let a = buildMandalartDoc(mkM(title: "A"), folderName: "Inbox")
        let b = buildMandalartDoc(mkM(title: "B"), folderName: "Inbox")
        XCTAssertFalse(docContentEquivalent(a, b))
    }

    func testMandalartDocDiffersByFolderName() {
        let a = buildMandalartDoc(mkM(), folderName: "Inbox")
        let b = buildMandalartDoc(mkM(), folderName: "Work")
        XCTAssertFalse(docContentEquivalent(a, b))
    }

    func testGridDocEquivalentIgnoresUpdatedAt() {
        let cellsA = [makeCell("c1", "g", 4, text: "X", updatedAt: "2026-01-01T00:00:00.000Z")]
        let cellsB = [makeCell("c1", "g", 4, text: "X", updatedAt: "2026-12-31T00:00:00.000Z")]
        let a = buildGridDocument(makeGrid("g", centerCellId: "c1", updatedAt: "2026-01-01T00:00:00.000Z"), cellsA)
        let b = buildGridDocument(makeGrid("g", centerCellId: "c1", updatedAt: "2026-12-31T00:00:00.000Z"), cellsB)
        XCTAssertTrue(docContentEquivalent(a, b))
    }

    func testGridDocDiffersByMemoOrText() {
        let cells = [makeCell("c1", "g", 4, text: "X")]
        let a = buildGridDocument(makeGrid("g", centerCellId: "c1"), cells)
        let memoChanged = buildGridDocument(makeGrid("g", centerCellId: "c1", memo: "changed"), cells)
        let textChanged = buildGridDocument(makeGrid("g", centerCellId: "c1"), [makeCell("c1", "g", 4, text: "Y")])
        XCTAssertFalse(docContentEquivalent(a, memoChanged))
        XCTAssertFalse(docContentEquivalent(a, textChanged))
    }

    func testGridDocBodyLinkDiffPropagates() {
        let cells = [makeCell("c1", "g", 4, text: "X"), makeCell("c2", "g", 2, text: "Y")]
        let g = makeGrid("g", centerCellId: "c1")
        let noLink = buildGridDocument(g, cells)
        let withLink = buildGridDocument(g, cells, links: GridBodyLinks(childByCell: ["c2": "g-child"]))
        // frontmatter は同一、本文だけリンク有無で違う → 非等価で再書き出しされる
        XCTAssertFalse(docContentEquivalent(noLink, withLink))
    }

    // MARK: attachmentName

    func testAttachmentNameFoldsUnsafeChars() {
        XCTAssertEqual(attachmentName("images/normal-1.jpg"), "normal-1.jpg")
        // pending synthetic cell 由来のコロンは `-` に (Obsidian の ![[ ]] を壊さない)
        XCTAssertEqual(attachmentName("images/pending:af2:7-1780.jpg"), "pending-af2-7-1780.jpg")
    }
}
