import SwiftUI

/// 3×3 グリッド表示。**display cells を 9 要素配列で受け取る** (= EditorView 側で
/// merge / lazy resolve を完了した状態)。子グリッド表示時は index 4 が親 peripheral cell。
///
/// `gridId` は新規 Cell の lazy creation で `Cell.gridId` に入れる用 (子グリッドの場合は
/// **子グリッド自身の id** を渡す。merged center を編集したいときは EditorView 側で
/// 親 grid に切り替えるか onDrillRequest を別経由で扱う前提)。
struct GridView3x3: View {
    let gridId: String
    let displayCells: [Cell?]  // 必ず 9 要素 (= GridConstants.gridCellCount)
    let mandalart: Mandalart
    let onDrillRequest: ((Cell) -> Void)?

    init(
        gridId: String,
        displayCells: [Cell?],
        mandalart: Mandalart,
        onDrillRequest: ((Cell) -> Void)? = nil
    ) {
        self.gridId = gridId
        self.displayCells = displayCells
        self.mandalart = mandalart
        self.onDrillRequest = onDrillRequest
    }

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: LayoutConstants.outerGridGap),
        count: 3
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: LayoutConstants.outerGridGap) {
            ForEach(0..<GridConstants.gridCellCount, id: \.self) { position in
                CellView(
                    cell: displayCells[position],
                    gridId: gridId,
                    position: position,
                    mandalart: mandalart,
                    onDrillRequest: onDrillRequest
                )
                // grid 切替時 (= drill / drill-up) に CellView の @State (`text`) が
                // 古い grid の値を持ち越さないよう、id に gridId + cellId を含めて強制 remount。
                // これがないと「親 peripheral 7番に "目標 A" → drill → 子グリッド 7番にも
                // "目標 A" が出る」バグになる (SwiftUI の view identity を position だけにすると
                // 同 position の State が再利用されるため)。
                .id("\(gridId)-\(position)-\(displayCells[position]?.id ?? "empty")")
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
