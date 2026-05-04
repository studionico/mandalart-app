import Foundation

enum GridConstants {
    /// 3×3 / 9×9 グリッドの一辺の長さ (= 3)。
    static let gridSide: Int = 3
    /// 1 グリッドあたりのセル数 (= 9 = gridSide * gridSide)。
    static let gridCellCount: Int = gridSide * gridSide
    /// 中心セルの position (= 4)。
    static let centerPosition: Int = 4
    static let orbitOrder: [Int] = [0, 1, 2, 5, 8, 7, 6, 3]
}

enum LayoutConstants {
    static let outerGridGap: CGFloat = 8
    static let cellBaseFontSize: CGFloat = 14
    static let dashboardCardSize: CGFloat = 160
}

enum TimingConstants {
    static let animStaggerMs: Int = 50
    static let animFadeMs: Int = 200
    static let convergeDurationMs: Int = 600
}
