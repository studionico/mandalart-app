import SwiftUI
import UIKit

/// Tailwind v3 neutral palette を SwiftUI Color にミラーした **背景トーン定数群**。
///
/// desktop は `bg-neutral-50 dark:bg-neutral-950` / `bg-white dark:bg-neutral-900` などの
/// Tailwind class で背景を指定している ([`../../../desktop/src/components/editor/EditorLayout.tsx`](../../../desktop/src/components/editor/EditorLayout.tsx)
/// L2076、[`../../../desktop/src/pages/DashboardPage.tsx`](../../../desktop/src/pages/DashboardPage.tsx) L501 等)。
/// iOS 側で `secondarySystemBackground` 等を使うと色 (RGB 値) がズレるため、ここで同 RGB を
/// 直接指定する。
///
/// 値は Tailwind v3 公式 palette (https://tailwindcss.com/docs/customizing-colors)。
///
/// **注意**: Apple HIG の semantic color (`Color(uiColor: .systemBackground)` 等) を**使わない**
/// 例外的な定数群。desktop と完全一致を優先するための妥協。Dynamic Type / High Contrast / アクセシビリティ
/// 機能には引き続き OS が対応するが、**色味は OS の system 系列ではなく Tailwind 系列**になる点に注意。
enum NeutralPalette {
    // MARK: - 純色

    /// 純白 (Tailwind の `white` クラス相当)。
    static let white = Color(rgb: 255, 255, 255)

    // MARK: - Tailwind neutral-50..950 (10 段階)

    static let neutral50  = Color(rgb: 250, 250, 250)
    static let neutral100 = Color(rgb: 245, 245, 245)
    static let neutral200 = Color(rgb: 229, 229, 229)
    static let neutral300 = Color(rgb: 212, 212, 212)
    static let neutral400 = Color(rgb: 163, 163, 163)
    static let neutral500 = Color(rgb: 115, 115, 115)
    static let neutral600 = Color(rgb: 82, 82, 82)
    static let neutral700 = Color(rgb: 64, 64, 64)
    static let neutral800 = Color(rgb: 38, 38, 38)
    static let neutral900 = Color(rgb: 23, 23, 23)
    static let neutral950 = Color(rgb: 10, 10, 10)

    // MARK: - desktop と揃える adaptive ペア

    /// **editor / dashboard root の背景** (= `bg-neutral-50 dark:bg-neutral-950`)。
    static let rootBackground = adaptive(light: neutral50, dark: neutral950)

    /// **空セル / editor header / memo / breadcrumb 領域の背景** (= `bg-white dark:bg-neutral-900`)。
    /// 中間レイヤーで本文が読みやすい中明度。
    static let surfaceBackground = adaptive(light: white, dark: neutral900)

    /// **dashboard card の背景** (= `bg-white dark:bg-neutral-950`)。
    /// dark 側は root と同じ neutral-950 で fade、light 側は root より少し白い (= card 浮き上がり感)。
    /// この非対称は desktop のデザインチョイスを忠実に踏襲。
    static let cardBackground = adaptive(light: white, dark: neutral950)

    /// **divider / セル間 gap の暗線** (= `bg-neutral-300 dark:bg-neutral-700`)。
    static let dividerSurface = adaptive(light: neutral300, dark: neutral700)

    // MARK: - Helper

    /// ライト/ダーク自動切替 Color を作る。OS の colorScheme を見て light / dark を返す。
    /// SwiftUI 標準の `Color(uiColor: UIColor { ... })` パターン。
    static func adaptive(light: Color, dark: Color) -> Color {
        Color(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
    }
}

private extension Color {
    /// 0-255 の RGB Int 値から sRGB Color を作る convenience init。
    init(rgb r: Int, _ g: Int, _ b: Int) {
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: 1
        )
    }
}
