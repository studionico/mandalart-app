import Foundation

enum GridConstants {
    /// 3×3 / 9×9 グリッドの一辺の長さ (= 3)。
    static let gridSide: Int = 3
    /// 1 グリッドあたりのセル数 (= 9 = gridSide * gridSide)。
    static let gridCellCount: Int = gridSide * gridSide
    /// 中心セルの position (= 4)。
    static let centerPosition: Int = 4
    static let orbitOrder: [Int] = [0, 1, 2, 5, 8, 7, 6, 3]
    /// Tab 移動順 (中央 → 周辺時計回り)。desktop の [`TAB_ORDER`](../../../desktop/src/constants/tabOrder.ts) と同じ。
    /// 中心 4 から始まり時計回りに外周を一周。export / import の周辺セル配置順 (= 中心を除いた配列) も
    /// この順を使い、エクスポート → インポートの round-trip でセル位置が保たれる。
    static let tabOrder: [Int] = [4, 7, 6, 3, 0, 1, 2, 5, 8]
    /// `tabOrder` から中心を除いた配列 (= 7, 6, 3, 0, 1, 2, 5, 8)。
    /// インポート時に Markdown / IndentText の子ノードをこの順で周辺セルに配置する。
    static let peripheralPositionsByTab: [Int] = [7, 6, 3, 0, 1, 2, 5, 8]
}

enum LayoutConstants {
    static let outerGridGap: CGFloat = 8
    static let cellBaseFontSize: CGFloat = 14
    static let dashboardCardSize: CGFloat = 160
    /// セル / カードの cornerRadius・border は **desktop の規則を canonical** とし、iOS pt にスケールして揃える。
    /// desktop の 28px font に対して中心 6px border (= 0.21 ratio) を、iOS の 14pt 中心 font で同 ratio に維持。
    /// 詳細: [`/Users/maro02/.claude/plans/ios-swift-glistening-thacker.md`](../../../.claude/plans/ios-swift-glistening-thacker.md) Plan A。
    static let cellCornerRadius: CGFloat = 8
    static let cellCenterBorder: CGFloat = 3
    static let cellPeripheralBorder: CGFloat = 0.5
    /// 周辺セル + 子グリッドあり (= drill 元として既に展開済) の border 太さ。子の存在を視覚提示。
    static let cellPeripheralWithChildBorder: CGFloat = 1.5
    /// 9×9 view 内の inner cell border (= 縮小表示で hairline は薄すぎるため 1pt 据え置き)。
    static let cellNineByNineInnerBorder: CGFloat = 1
    static let cardCornerRadius: CGFloat = 4
}

enum TimingConstants {
    static let animStaggerMs: Int = 50
    static let animFadeMs: Int = 200
    static let convergeDurationMs: Int = 600
}
