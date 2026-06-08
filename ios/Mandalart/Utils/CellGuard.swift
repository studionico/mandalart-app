import Foundation

/// 中心セル保護 / 並列追加ゲート / paste 可否で使う「セルが空か」「周辺に内容があるか」の純粋判定。
/// desktop [`desktop/src/lib/utils/grid.ts`] のミラー。**正準定義は desktop**:
/// セルが空 = `text` を trim して空 **かつ** `imagePath == nil` (色・done は空判定に含めない)。
/// 中心セルは `position == GridConstants.centerPosition`。
///
/// Foundation のみ依存・SwiftData/Supabase 非依存 (ロジックテスト対象)。
///
/// 注意 (落とし穴 #10): 入力 `cells` の `position` は **表示スロット** を指すこと。X=C drilled grid の
/// 中心セルは実 `cell.position` が 4 でないため、SwiftData `Cell` をそのまま渡さず、表示スロット index を
/// position に詰めた値を渡す (production は `EditorView` の `SlotCell` アダプタ経由)。

/// 空判定 / 周辺判定に必要な最小フィールド。production の `SlotCell` が conform する。
protocol CellGuardCell {
    var position: Int { get }
    var text: String { get }
    var imagePath: String? { get }
}

enum CellGuard {
    /// セルが「空」か (text を trim して空 かつ imagePath==nil)。色・done は見ない (desktop 準拠)。
    static func isCellEmpty(text: String, imagePath: String?) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && imagePath == nil
    }

    static func isCellEmpty<C: CellGuardCell>(_ cell: C) -> Bool {
        isCellEmpty(text: cell.text, imagePath: cell.imagePath)
    }

    /// 中心セル (position == centerPosition) を取得。
    static func centerCell<C: CellGuardCell>(_ cells: [C]) -> C? {
        cells.first { $0.position == GridConstants.centerPosition }
    }

    /// 周辺セル (position != centerPosition) を取得。
    static func peripheralCells<C: CellGuardCell>(_ cells: [C]) -> [C] {
        cells.filter { $0.position != GridConstants.centerPosition }
    }

    /// 周辺セルに 1 つでも非空があるか (中心クリア可否 / 並列追加ゲート)。
    static func hasPeripheralContent<C: CellGuardCell>(_ cells: [C]) -> Bool {
        peripheralCells(cells).contains { !isCellEmpty($0) }
    }

    /// 周辺セルへの paste 可否。所属グリッドの中心セルが非空なら true。中心セル自身は常に true。
    static func canPasteIntoPeripheral<C: CellGuardCell>(targetPosition: Int, gridCells: [C]) -> Bool {
        if targetPosition == GridConstants.centerPosition { return true }
        guard let center = centerCell(gridCells) else { return false }
        return !isCellEmpty(center)
    }
}
