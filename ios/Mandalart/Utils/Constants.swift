import Foundation

enum GridConstants {
    static let centerPosition: Int = 4
    static let gridCellCount: Int = 9
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
