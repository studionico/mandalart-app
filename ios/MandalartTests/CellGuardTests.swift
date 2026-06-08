import XCTest
@testable import Mandalart

/// 中心セル保護 / 周辺判定 / paste 可否の純粋ロジック (`CellGuard`) を検証する。
/// 正準定義は desktop [`grid.ts`](../../desktop/src/lib/utils/grid.ts) (desktop 側は `grid.test.ts` でロック)。
final class CellGuardTests: XCTestCase {

    private struct TestCell: CellGuardCell {
        let position: Int
        let text: String
        let imagePath: String?
        init(_ position: Int, _ text: String = "", imagePath: String? = nil) {
            self.position = position
            self.text = text
            self.imagePath = imagePath
        }
    }

    func testIsCellEmpty() {
        XCTAssertTrue(CellGuard.isCellEmpty(text: "", imagePath: nil))
        XCTAssertTrue(CellGuard.isCellEmpty(text: "  \n ", imagePath: nil), "空白のみは空")
        XCTAssertFalse(CellGuard.isCellEmpty(text: "x", imagePath: nil))
        XCTAssertFalse(CellGuard.isCellEmpty(text: "", imagePath: "images/a.jpg"), "画像があれば非空")
    }

    func testHasPeripheralContent() {
        let center = GridConstants.centerPosition
        // 中心だけ埋まっていて周辺は全空 → false
        let onlyCenter = [TestCell(center, "テーマ"), TestCell(0), TestCell(1)]
        XCTAssertFalse(CellGuard.hasPeripheralContent(onlyCenter))
        // 周辺に 1 つでも内容があれば true
        let withPeripheral = [TestCell(center, "テーマ"), TestCell(0, "目標")]
        XCTAssertTrue(CellGuard.hasPeripheralContent(withPeripheral))
        // 色・done は空判定に含めないので、text/image 空の周辺は非空扱いしない
        XCTAssertFalse(CellGuard.hasPeripheralContent([TestCell(center), TestCell(2, "  ")]))
    }

    func testCanPasteIntoPeripheral() {
        let center = GridConstants.centerPosition
        // 中心セル自身へは常に paste 可
        XCTAssertTrue(CellGuard.canPasteIntoPeripheral(targetPosition: center, gridCells: [TestCell]()))
        // 中心が非空 → 周辺へ paste 可
        let nonEmptyCenter = [TestCell(center, "テーマ")]
        XCTAssertTrue(CellGuard.canPasteIntoPeripheral(targetPosition: 0, gridCells: nonEmptyCenter))
        // 中心が空 → 周辺へ paste 不可 (中心が空のグリッドの周辺を埋めさせない)
        let emptyCenter = [TestCell(center, "")]
        XCTAssertFalse(CellGuard.canPasteIntoPeripheral(targetPosition: 0, gridCells: emptyCenter))
    }
}
