import SwiftUI

/// 3×3 グリッド表示。**display cells を 9 要素配列で受け取る** (= EditorView 側で
/// merge / lazy resolve を完了した状態)。子グリッド表示時は index 4 が親 peripheral cell。
///
/// `gridId` は新規 Cell の lazy creation で `Cell.gridId` に入れる用 (子グリッドの場合は
/// **子グリッド自身の id** を渡す。merged center を編集したいときは EditorView 側で
/// 親 grid に切り替えるか onDrillRequest を別経由で扱う前提)。
///
/// `transitionKind` は drill / drill-up / 並列ナビ / 初回表示それぞれで CellView の
/// orbit-style stagger fade-in 順序を切替えるために CellView へ pass-through する。
///
/// `readOnly` は 9×9 view の inner 3×3 として表示するときに true (= edit / drill 全 NOOP)。
struct GridView3x3: View {
    let gridId: String
    let displayCells: [Cell?]  // 必ず 9 要素 (= GridConstants.gridCellCount)
    let mandalart: Mandalart
    let transitionKind: DrillTransitionKind
    let readOnly: Bool
    /// 各 position の cell が drill 元として子グリッドを持つかの mask (= 9 要素 Bool)。
    /// 空配列を渡すと全位置 false 扱い (= 9×9 内 inner / 旧呼び出し互換)。
    let hasChildAtPosition: [Bool]
    let onDrillRequest: ((Cell) -> Void)?
    /// ストックペースト先選択モード中かどうか。`true` のとき CellView は drill / focus 抑制し
    /// `onPasteTargetTapped` を発火する。
    let pasteMode: Bool
    let onPasteTargetTapped: ((Cell) -> Void)?

    init(
        gridId: String,
        displayCells: [Cell?],
        mandalart: Mandalart,
        transitionKind: DrillTransitionKind = .initial,
        readOnly: Bool = false,
        hasChildAtPosition: [Bool] = [],
        onDrillRequest: ((Cell) -> Void)? = nil,
        pasteMode: Bool = false,
        onPasteTargetTapped: ((Cell) -> Void)? = nil
    ) {
        self.gridId = gridId
        self.displayCells = displayCells
        self.mandalart = mandalart
        self.transitionKind = transitionKind
        self.readOnly = readOnly
        self.hasChildAtPosition = hasChildAtPosition
        self.onDrillRequest = onDrillRequest
        self.pasteMode = pasteMode
        self.onPasteTargetTapped = onPasteTargetTapped
    }

    private func hasChild(at position: Int) -> Bool {
        position < hasChildAtPosition.count ? hasChildAtPosition[position] : false
    }

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: LayoutConstants.outerGridGap),
        count: GridConstants.gridSide
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: LayoutConstants.outerGridGap) {
            ForEach(0..<GridConstants.gridCellCount, id: \.self) { position in
                CellView(
                    cell: displayCells[position],
                    gridId: gridId,
                    position: position,
                    mandalart: mandalart,
                    transitionKind: transitionKind,
                    readOnly: readOnly,
                    hasChild: hasChild(at: position),
                    onDrillRequest: onDrillRequest,
                    pasteMode: pasteMode,
                    onPasteTargetTapped: onPasteTargetTapped
                )
                // grid 切替時 (= drill / drill-up) に CellView の @State (`text`) が
                // 古い grid の値を持ち越さないよう、id に gridId + cellId を含めて強制 remount。
                // これがないと「親 peripheral 7番に "目標 A" → drill → 子グリッド 7番にも
                // "目標 A" が出る」バグになる (SwiftUI の view identity を position だけにすると
                // 同 position の State が再利用されるため)。
                //
                // remount は CellView の `.onAppear` を再発火させ、stagger fade-in アニメも
                // 各 grid 切替で確実に動作する (= Phase 6a で意図した挙動)。
                .id("\(gridId)-\(position)-\(displayCells[position]?.id ?? "empty")")
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
