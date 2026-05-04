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

enum PresetColors {
    static let all: [PresetColor] = [
        PresetColor(key: "red-100", label: "赤",
            light: Color(red: 254/255, green: 226/255, blue: 226/255),
            dark: Color(red: 127/255, green: 29/255, blue: 29/255)),
        PresetColor(key: "orange-100", label: "オレンジ",
            light: Color(red: 255/255, green: 237/255, blue: 213/255),
            dark: Color(red: 124/255, green: 45/255, blue: 18/255)),
        PresetColor(key: "yellow-100", label: "黄",
            light: Color(red: 254/255, green: 249/255, blue: 195/255),
            dark: Color(red: 113/255, green: 63/255, blue: 18/255)),
        PresetColor(key: "green-100", label: "緑",
            light: Color(red: 220/255, green: 252/255, blue: 231/255),
            dark: Color(red: 20/255, green: 83/255, blue: 45/255)),
        PresetColor(key: "teal-100", label: "ティール",
            light: Color(red: 204/255, green: 251/255, blue: 241/255),
            dark: Color(red: 19/255, green: 78/255, blue: 74/255)),
        PresetColor(key: "blue-100", label: "青",
            light: Color(red: 219/255, green: 234/255, blue: 254/255),
            dark: Color(red: 30/255, green: 58/255, blue: 138/255)),
        PresetColor(key: "indigo-100", label: "インディゴ",
            light: Color(red: 224/255, green: 231/255, blue: 255/255),
            dark: Color(red: 49/255, green: 46/255, blue: 129/255)),
        PresetColor(key: "purple-100", label: "紫",
            light: Color(red: 243/255, green: 232/255, blue: 255/255),
            dark: Color(red: 88/255, green: 28/255, blue: 135/255)),
        PresetColor(key: "pink-100", label: "ピンク",
            light: Color(red: 252/255, green: 231/255, blue: 243/255),
            dark: Color(red: 131/255, green: 24/255, blue: 67/255)),
        PresetColor(key: "gray-100", label: "グレー",
            light: Color(red: 245/255, green: 245/255, blue: 245/255),
            dark: Color(red: 64/255, green: 64/255, blue: 64/255)),
    ]

    /// `Cell.color` のキー文字列から PresetColor を引く。nil / 空 / 未定義キーは nil を返す。
    static func find(_ key: String?) -> PresetColor? {
        guard let key, !key.isEmpty else { return nil }
        return all.first { $0.key == key }
    }
}
