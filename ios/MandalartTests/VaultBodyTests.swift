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

    /// 本番取り込み経路 `vaultFilesToRows(applyBody: true)` でも本文が正としてマージされる (files レベル回帰)。
    func testVaultFilesToRowsAppliesBody() {
        let files = mandalartToVaultFiles(sampleRows()).files
        // g-par.md の本文だけ編集 (frontmatter の cells JSON は不変)。
        let edited = files.map { f -> VaultFile in
            guard f.path == "g-par.md" else { return f }
            return VaultFile(path: f.path, content: f.content.replacingOccurrences(
                of: "## [ ] 睡眠 #c/blue-100 ^p3", with: "## [x] 熟睡 ^p3"))
        }
        let rows = vaultFilesToRows(edited, applyBody: true)
        let cell = rows?.cells.first { $0.id == "c-par-p3" }
        XCTAssertEqual(cell?.text, "熟睡")
        XCTAssertEqual(cell?.done, true)
        // applyBody=false (既定) なら frontmatter 値のまま (本番 flush 読取経路は不変)。
        let unchanged = vaultFilesToRows(edited)?.cells.first { $0.id == "c-par-p3" }
        XCTAssertEqual(unchanged?.text, "睡眠")
    }

    /// 子リンクのエイリアスは改行を畳んで単一行で出し、往復で改行を保持する (no-op 判定)。
    func testChildLinkCollapsesNewlineAndPreservesOnRoundTrip() {
        let grid = makeGrid("g1", centerCellId: "c4")
        let multiline = "発揮\n\n窮地に立てば潜在能力が発揮される"
        let cells = [makeCell("c4", "g1", 4, text: "中心"), makeCell("c2", "g1", 2, text: multiline)]
        let content = buildGridDocument(grid, cells, links: GridBodyLinks(childByCell: ["c2": "g-child"]))
        // 単一行 wiki-link (改行が `[[ ]]` 内に無い)
        XCTAssertTrue(content.contains("[[g-child|発揮 窮地に立てば潜在能力が発揮される]]"))
        XCTAssertNil(content.range(of: "\\[\\[g-child\\|[^\\]]*\\n", options: .regularExpression))
        // 往復で frontmatter の改行が保持される
        let parsed = parseGridDocument(content, mandalartId: "m", applyBody: true)
        XCTAssertEqual(parsed?.cells.first { $0.position == 2 }?.text, multiline)
    }

    /// 子リンクのエイリアスを実際に書き換えたら text 編集として反映する。
    func testChildLinkRenameAppliesAsEdit() {
        let grid = makeGrid("g1", centerCellId: "c4")
        let cells = [makeCell("c4", "g1", 4, text: "中心"), makeCell("c2", "g1", 2, text: "旧\n名")]
        let content = buildGridDocument(grid, cells, links: GridBodyLinks(childByCell: ["c2": "g-child"]))
            .replacingOccurrences(of: "[[g-child|旧 名]]", with: "[[g-child|新名]]")
        let parsed = parseGridDocument(content, mandalartId: "m", applyBody: true)
        XCTAssertEqual(parsed?.cells.first { $0.position == 2 }?.text, "新名")
    }

    func testCollapseLinkLabel() {
        XCTAssertEqual(collapseLinkLabel("a\nb"), "a b")
        XCTAssertEqual(collapseLinkLabel("a\n\n b"), "a b")
        XCTAssertEqual(collapseLinkLabel("健康 / 2026"), "健康 / 2026") // 改行が無ければ不変
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
