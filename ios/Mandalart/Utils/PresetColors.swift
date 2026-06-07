import SwiftUI

/// セルの背景色プリセット (10 色 + 透明)。
/// desktop の [`constants/colors.ts`](../../../desktop/src/constants/colors.ts) と
/// **完全に同じ key 文字列** で定義する (`Cell.color` に保存される値)。
///
/// ライトモードは Tailwind `*-100` (パステル系)、ダークモードは `*-900/40` (40% 不透明)
/// で desktop の見た目と統一する。RGB 値は Tailwind v3 の対応値。
struct PresetColor: Identifiable, Hashable {
    let key: String
    let label: String
    let light: Color
    let dark: Color

    var id: String { key }

    /// 現在の `colorScheme` に応じた背景色を返す。dark は 40% 不透明で乗算。
    func backgroundColor(for scheme: ColorScheme) -> Color {
        scheme == .dark ? dark.opacity(0.4) : light
    }
}

/// `all` のデータは単一ソース [shared/constants/colors.json] から codegen される
/// ([PresetColors.generated.swift](PresetColors.generated.swift)、desktop colors.ts と同じ値を保つ)。
/// 値を変えるときは colors.json を編集して `cd desktop && npm run codegen` を実行する。
enum PresetColors {
    /// `Cell.color` のキー文字列から PresetColor を引く。nil / 空 / 未定義キーは nil を返す。
    static func find(_ key: String?) -> PresetColor? {
        guard let key, !key.isEmpty else { return nil }
        return all.first { $0.key == key }
    }
}
