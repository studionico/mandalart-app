import SwiftUI

/// アプリ全体のライト/ダーク切替設定 (端末単位 UserDefaults、Supabase 同期なし)。
///
/// rawValue は desktop の [`themeStore.ts`](../../../desktop/src/store/themeStore.ts) と一致 (`light` / `system` / `dark`)。
/// **キー文字列は意図的に desktop (`mandalart.theme`) と異なる**: iOS 側は `MandalartFontPreference` の
/// `mandalart.fontLevel.<id>` と同じく端末専有設定の namespace を分離し、`app.theme` で保存する。
/// cross-device 同期はしない (UI preference であり「思考内容」ではない)。
enum ThemePreference: String, CaseIterable, Identifiable {
    case light
    case system
    case dark

    static let storageKey: String = "app.theme"

    var id: String { rawValue }

    /// `.preferredColorScheme(_:)` modifier に渡す値。`system` は `nil` (= OS 追従)。
    var colorScheme: ColorScheme? {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }

    /// desktop の `☀ ◐ ☾` に対応する SF Symbol 名。
    var iconName: String {
        switch self {
        case .light: return "sun.max"
        case .system: return "circle.lefthalf.filled"
        case .dark: return "moon"
        }
    }

    var label: String {
        switch self {
        case .light: return "ライト"
        case .system: return "システム"
        case .dark: return "ダーク"
        }
    }

    static func load() -> ThemePreference {
        let raw = UserDefaults.standard.string(forKey: storageKey)
        return ThemePreference(rawValue: raw ?? "") ?? .system
    }

    static func save(_ preference: ThemePreference) {
        UserDefaults.standard.set(preference.rawValue, forKey: storageKey)
    }
}
