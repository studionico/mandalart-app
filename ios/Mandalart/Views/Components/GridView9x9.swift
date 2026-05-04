import SwiftUI
import SwiftData

/// 9×9 全体俯瞰ビュー (view-only)。3 × 3 のブロック群、各ブロックは内側 3×3 グリッド (= 計 81 セル)。
/// 中央 (blockIndex=4) は root grid 自身、周辺 8 ブロックは root の対応周辺セルから派生する子グリッド
/// (未作成時は X=C implicit = 中心に親 peripheral 1 つだけ持つ 9 セル view)。
///
/// **edit / drill 全 NOOP**: 全 9 ブロックを `GridView3x3(readOnly: true)` で統一描画する
/// (= ネスト LazyVGrid を避け、size 解決を予測可能にする)。
///
/// **layout**: 親 (= EditorView) が `.frame(width: gridSize, height: gridSize)` で正方形を
/// 与えるので、内部は VStack/HStack で 3×3 等分割するだけ (LazyVGrid + aspectRatio 連鎖を
/// 使うと一部ブロックが 0 size に潰れる事象あり、SwiftUI の sizing 推論の限界)。
///
/// データは [`GridRepository.loadNineByNineLayout`](../../Services/GridRepository.swift) で取得。
struct GridView9x9: View {
    let layout: [(Grid?, [Cell?])]  // 必ず 9 要素
    let mandalart: Mandalart

    var body: some View {
        VStack(spacing: LayoutConstants.outerGridGap) {
            ForEach(0..<GridConstants.gridSide, id: \.self) { row in
                HStack(spacing: LayoutConstants.outerGridGap) {
                    ForEach(0..<GridConstants.gridSide, id: \.self) { col in
                        let blockIndex = row * GridConstants.gridSide + col
                        blockView(at: blockIndex)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder
    private func blockView(at blockIndex: Int) -> some View {
        let entry = blockIndex < layout.count
            ? layout[blockIndex]
            : (nil, Array(repeating: Optional<Cell>.none, count: GridConstants.gridCellCount))
        // gridId: 子グリッドあり → 実 id、未作成 (implicit) → 仮 id (readOnly なので INSERT に
        // 使われない、CellView 内 lazy create も readOnly で抑制される)
        let gridId = entry.0?.id ?? "implicit-block-\(blockIndex)-\(mandalart.id)"
        GridView3x3(
            gridId: gridId,
            displayCells: entry.1,
            mandalart: mandalart,
            transitionKind: .initial,
            readOnly: true
        )
    }
}
