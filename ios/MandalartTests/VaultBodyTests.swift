import XCTest

/// 本文ラウンドトリップ (VaultBody + parseGridDocument applyBody) のユニットテスト。
final class VaultBodyTests: XCTestCase {

    private func sortedByPosition(_ cells: [VaultCell]) -> [VaultCell] {
        cells.sorted { $0.position < $1.position }
    }

    // MARK: full round-trip (render → parse(applyBody) で text/color/done が保たれる)

    func testGridDocumentRoundTripWithBody() {
        let grid = makeGrid("g1", centerCellId: "c4")
        let cells = [
            makeCell("c4", "g1", 4, text: "健康"),
            makeCell("c0", "g1", 0, text: "食事", color: "red-100", done: true),
            makeCell("c8", "g1", 8, text: "睡眠", color: "#1a2b3c"),
        ]
        let content = buildGridDocument(grid, cells)
        let parsed = parseGridDocument(content, mandalartId: "m", applyBody: true)
        XCTAssertNotNil(parsed)
        XCTAssertEqual(sortedByPosition(parsed!.cells), sortedByPosition(cells))
    }

    // MARK: parseGridBody フィールド抽出

    func testParseHeadingFields() {
        let body = "## [x] 食事 #c/red-100 ^p0\n## [ ] 睡眠 #c/hex-1a2b3c ^p8"
        let parse = parseGridBody(body)
        XCTAssertEqual(parse.cellsByPosition[0]?.text, .set("食事"))
        XCTAssertEqual(parse.cellsByPosition[0]?.done, .set(true))
        XCTAssertEqual(parse.cellsByPosition[0]?.color, .set("red-100"))
        XCTAssertEqual(parse.cellsByPosition[8]?.done, .set(false))
        XCTAssertEqual(parse.cellsByPosition[8]?.color, .set("#1a2b3c")) // hex- 復号
    }

    func testParseWikiLinkLabelAsText() {
        let parse = parseGridBody("## [ ] [[g-child|運動]] ^p2")
        XCTAssertEqual(parse.cellsByPosition[2]?.text, .set("運動"))
    }

    func testParseMemoBlockquote() {
        let parse = parseGridBody("# [ ] 健康 ^p4\n> 行1\n> 行2")
        XCTAssertEqual(parse.memo, .set("行1\n行2"))
    }

    func testHeadingWithoutAnchorIsIgnored() {
        // `^pN` を持たない見出し (壊れた行 / `# (中心)`) は round-trip 対象外。
        let parse = parseGridBody("# [ ] OK ^p4\n## 壊れた見出し anchor なし\n# (中心)")
        XCTAssertEqual(parse.cellsByPosition.count, 1)
        XCTAssertNotNil(parse.cellsByPosition[4])
    }

    // MARK: mergeBody (frontmatter 母集合 + 本文上書き)

    func testMergeOverridesTextKeepsAbsentFields() {
        let front = [
            makeCell("c4", "g", 4, text: "A"),
            makeCell("c0", "g", 0, text: "B", color: "red-100"),
        ]
        let parse = BodyParse(cellsByPosition: [0: BodyCellEdit(text: .set("B-編集"))], memo: .absent)
        let merged = mergeBody(frontCells: front, parse: parse, gridId: "g", timestamp: TS)
        let p0 = merged.first { $0.position == 0 }!
        XCTAssertEqual(p0.text, "B-編集")
        XCTAssertEqual(p0.color, "red-100") // color は .absent なので frontmatter 維持
        XCTAssertEqual(merged.first { $0.position == 4 }!.text, "A") // 本文に無い → 不変
    }

    func testMergeNewPositionCreatesSynthCell() {
        let front = [makeCell("c4", "g", 4, text: "A")]
        let parse = BodyParse(cellsByPosition: [5: BodyCellEdit(text: .set("新規"))], memo: .absent)
        let merged = mergeBody(frontCells: front, parse: parse, gridId: "g", timestamp: TS)
        let p5 = merged.first { $0.position == 5 }
        XCTAssertEqual(p5?.id, "g-p5")
        XCTAssertEqual(p5?.text, "新規")
    }

    func testMergeMissingPositionKept() {
        // 本文に無い position は誤削除しない。
        let merged = mergeBody(
            frontCells: [makeCell("c0", "g", 0, text: "B")],
            parse: BodyParse(cellsByPosition: [:], memo: .absent),
            gridId: "g", timestamp: TS)
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].text, "B")
    }

    func testMergeImageClearedWhenEmbedAbsent() {
        let front = [makeCell("c0", "g", 0, text: "B", imagePath: "images/x.jpg")]
        // embed 無し (hasImage .set(false)) → 画像クリア
        let cleared = mergeBody(
            frontCells: front,
            parse: BodyParse(cellsByPosition: [0: BodyCellEdit(text: .set("B"), hasImage: .set(false))], memo: .absent),
            gridId: "g", timestamp: TS)
        XCTAssertNil(cleared[0].imagePath)
        // embed あり (hasImage .set(true)) → frontmatter の image_path 維持
        let kept = mergeBody(
            frontCells: front,
            parse: BodyParse(cellsByPosition: [0: BodyCellEdit(text: .set("B"), hasImage: .set(true))], memo: .absent),
            gridId: "g", timestamp: TS)
        XCTAssertEqual(kept[0].imagePath, "images/x.jpg")
    }

    // MARK: color タグ codec

    func testColorTagRoundTrip() {
        XCTAssertEqual(colorTag("red-100"), "#c/red-100")
        XCTAssertEqual(colorTag("#1a2b3c"), "#c/hex-1a2b3c")
        XCTAssertNil(colorTag(nil))
        XCTAssertNil(colorTag(""))
        XCTAssertEqual(decodeColorTag("red-100"), "red-100")
        XCTAssertEqual(decodeColorTag("hex-1a2b3c"), "#1a2b3c")
    }
}
