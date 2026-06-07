import XCTest

/// shared/vault-fixtures/*.json を読み、desktop goldenFixtures.test.ts と**同じ JSON**で vault ピュア層を
/// 検証する golden test。TS↔Swift の仕様乖離 (例: wiki-link の改行畳み) を両言語で同時に検出する。
///
/// fixture には「両プラットフォームで同一であるべき契約」だけが書かれている。複数行 heading の parse や
/// clean フラグも iOS が desktop と parity 化済 (ブロック parse + clean 削除) なので両言語で検証する。
final class GoldenFixtureTests: XCTestCase {

    private static let timestamp = "2026-06-02T00:00:00.000Z"

    // MARK: fixture モデル

    private struct StringField: Codable { let set: Bool; let value: String? }
    private struct BoolField: Codable { let set: Bool; let value: Bool? }
    private struct CellExpect: Codable {
        let text: StringField?
        let done: BoolField?
        let color: StringField?
        let hasImage: BoolField?
    }
    private struct BodyExpect: Codable {
        let clean: Bool?
        let memo: StringField?
        let cells: [String: CellExpect]?
    }
    private struct FxGrid: Codable {
        let id: String
        let centerCellId: String
        let parentCellId: String?
        let sortOrder: Int?
        let memo: String?
    }
    private struct FxCell: Codable {
        let id: String
        let position: Int
        let text: String?
        let color: String?
        let done: Bool?
        let imagePath: String?
    }
    private struct FxParent: Codable { let gridId: String; let label: String }
    private struct FxLinks: Codable { let childByCell: [String: String]?; let parent: FxParent? }
    private struct GuardSpec: Codable { let pasteTarget: Int? }
    private struct GuardExpect: Codable {
        let emptyByPosition: [String: Bool]?
        let hasPeripheralContent: Bool?
        let canPasteIntoTarget: Bool?
    }
    private struct Fixture: Codable {
        let kind: String
        let name: String
        // bodyParse
        let body: String?
        let expect: BodyExpect?
        // gridRender / cellGuard (cells スキーマ共用)
        let grid: FxGrid?
        let cells: [FxCell]?
        let links: FxLinks?
        let contains: [String]?
        let notContains: [String]?
        // cellGuard
        let `guard`: GuardSpec?
        let expectGuard: GuardExpect?
    }

    private func loadFixtures() throws -> [Fixture] {
        // #filePath = .../ios/MandalartTests/GoldenFixtureTests.swift → repo 直下の shared/vault-fixtures
        let dir = URL(filePath: #filePath)
            .deletingLastPathComponent() // MandalartTests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
            .appending(path: "shared/vault-fixtures")
        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        let decoder = JSONDecoder()
        return try files.map { try decoder.decode(Fixture.self, from: Data(contentsOf: $0)) }
    }

    // MARK: bodyParse

    func testBodyParseFixtures() throws {
        let fixtures = try loadFixtures().filter { $0.kind == "bodyParse" }
        XCTAssertFalse(fixtures.isEmpty, "bodyParse fixture が 1 件も無い")
        for fx in fixtures {
            let parse = parseGridBody(fx.body ?? "")
            let ctx = "[\(fx.name)]"
            if let clean = fx.expect?.clean {
                XCTAssertEqual(parse.clean, clean, "\(ctx) clean")
            }
            if let memo = fx.expect?.memo {
                assertStringField(parse.memo, memo, "\(ctx) memo")
            }
            for (posStr, cellExp) in fx.expect?.cells ?? [:] {
                guard let pos = Int(posStr) else { continue }
                guard let edit = parse.cellsByPosition[pos] else {
                    XCTFail("\(ctx) position \(pos) が parse 結果に無い"); continue
                }
                if let t = cellExp.text { assertStringField(edit.text, t, "\(ctx) p\(pos).text") }
                if let d = cellExp.done { assertBoolField(edit.done, d, "\(ctx) p\(pos).done") }
                if let c = cellExp.color { assertStringField(edit.color, c, "\(ctx) p\(pos).color") }
                if let h = cellExp.hasImage { assertBoolField(edit.hasImage, h, "\(ctx) p\(pos).hasImage") }
            }
        }
    }

    // MARK: gridRender

    func testGridRenderFixtures() throws {
        let fixtures = try loadFixtures().filter { $0.kind == "gridRender" }
        XCTAssertFalse(fixtures.isEmpty, "gridRender fixture が 1 件も無い")
        for fx in fixtures {
            guard let g = fx.grid else { XCTFail("[\(fx.name)] grid が無い"); continue }
            let grid = VaultGrid(
                id: g.id, mandalartId: "m-fixture", centerCellId: g.centerCellId,
                parentCellId: g.parentCellId, sortOrder: g.sortOrder ?? 0, memo: g.memo,
                createdAt: Self.timestamp, updatedAt: Self.timestamp)
            let cells = (fx.cells ?? []).map { c in
                VaultCell(
                    id: c.id, gridId: g.id, position: c.position, text: c.text ?? "",
                    imagePath: c.imagePath, color: c.color, done: c.done ?? false,
                    createdAt: Self.timestamp, updatedAt: Self.timestamp)
            }
            let parentTuple = fx.links?.parent.map { (gridId: $0.gridId, label: $0.label) }
            let links = fx.links.map { GridBodyLinks(childByCell: $0.childByCell, parent: parentTuple) }
            let doc = buildGridDocument(grid, cells, links: links)
            let ctx = "[\(fx.name)]"
            for needle in fx.contains ?? [] {
                XCTAssertTrue(doc.contains(needle), "\(ctx) 出力が \"\(needle)\" を含むべき\n--- 出力 ---\n\(doc)")
            }
            for needle in fx.notContains ?? [] {
                XCTAssertFalse(doc.contains(needle), "\(ctx) 出力が \"\(needle)\" を含んではいけない")
            }
        }
    }

    // MARK: cellGuard

    func testCellGuardFixtures() throws {
        let fixtures = try loadFixtures().filter { $0.kind == "cellGuard" }
        XCTAssertFalse(fixtures.isEmpty, "cellGuard fixture が 1 件も無い")
        for fx in fixtures {
            let ctx = "[\(fx.name)]"
            let cells = (fx.cells ?? []).map { c in
                VaultCell(
                    id: c.id, gridId: "g-fixture", position: c.position, text: c.text ?? "",
                    imagePath: c.imagePath, color: c.color, done: c.done ?? false,
                    createdAt: Self.timestamp, updatedAt: Self.timestamp)
            }
            for (posStr, want) in fx.expectGuard?.emptyByPosition ?? [:] {
                guard let pos = Int(posStr) else { continue }
                guard let cell = cells.first(where: { $0.position == pos }) else {
                    XCTFail("\(ctx) position \(pos) が cells に無い"); continue
                }
                XCTAssertEqual(CellGuard.isCellEmpty(cell), want, "\(ctx) isCellEmpty(p\(pos))")
            }
            if let want = fx.expectGuard?.hasPeripheralContent {
                XCTAssertEqual(CellGuard.hasPeripheralContent(cells), want, "\(ctx) hasPeripheralContent")
            }
            if let want = fx.expectGuard?.canPasteIntoTarget {
                guard let target = fx.guard?.pasteTarget else {
                    XCTFail("\(ctx) canPasteIntoTarget には guard.pasteTarget が必要"); continue
                }
                XCTAssertEqual(
                    CellGuard.canPasteIntoPeripheral(targetPosition: target, gridCells: cells),
                    want, "\(ctx) canPasteIntoTarget")
            }
        }
    }

    // MARK: helpers

    private func assertStringField(_ got: BodyField<String>, _ want: StringField, _ ctx: String) {
        switch got {
        case .set(let v):
            XCTAssertTrue(want.set, "\(ctx): set=true だが期待は absent")
            if want.set { XCTAssertEqual(v, want.value, "\(ctx) value") }
        case .absent:
            XCTAssertFalse(want.set, "\(ctx): absent だが期待は set")
        }
    }

    private func assertBoolField(_ got: BodyField<Bool>, _ want: BoolField, _ ctx: String) {
        switch got {
        case .set(let v):
            XCTAssertTrue(want.set, "\(ctx): set=true だが期待は absent")
            if want.set { XCTAssertEqual(v, want.value, "\(ctx) value") }
        case .absent:
            XCTAssertFalse(want.set, "\(ctx): absent だが期待は set")
        }
    }
}
