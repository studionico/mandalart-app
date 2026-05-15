import SwiftUI

/// テーマ切替トグル (ライト / システム / ダーク)。
/// desktop の [`ThemeToggle.tsx`](../../../../desktop/src/components/ThemeToggle.tsx) を移植。
///
/// `@AppStorage(ThemePreference.storageKey)` で rawValue を直読し、書き込みは全 view で自動伝搬。
/// 2 つの layout を提供:
/// - `.capsule`: Editor / Dashboard floating overlay 用 (ultraThinMaterial + Capsule、`checkboxToggleControl` と同質感)
/// - `.segmented`: SettingsView Form 用 (`Picker` の `.segmented` style)
struct ThemeToggle: View {
    enum Layout {
        case capsule
        case segmented
    }

    let layout: Layout

    @AppStorage(ThemePreference.storageKey) private var rawTheme: String = ThemePreference.system.rawValue

    private var preference: ThemePreference {
        ThemePreference(rawValue: rawTheme) ?? .system
    }

    private var selection: Binding<ThemePreference> {
        Binding(
            get: { preference },
            set: { rawTheme = $0.rawValue }
        )
    }

    var body: some View {
        switch layout {
        case .capsule: capsuleBody
        case .segmented: segmentedBody
        }
    }

    @ViewBuilder
    private var capsuleBody: some View {
        HStack(spacing: 0) {
            ForEach(ThemePreference.allCases) { pref in
                themeButton(pref)
            }
        }
        .foregroundStyle(.primary)
        .background(.ultraThinMaterial, in: Capsule())
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder
    private func themeButton(_ pref: ThemePreference) -> some View {
        let isSelected = preference == pref
        Button {
            rawTheme = pref.rawValue
        } label: {
            Image(systemName: pref.iconName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)
                .background(
                    Group {
                        if isSelected {
                            Color.primary.opacity(0.12)
                        } else {
                            Color.clear
                        }
                    }
                )
        }
        .accessibilityLabel(pref.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : [.isButton])
    }

    @ViewBuilder
    private var segmentedBody: some View {
        Picker("テーマ", selection: selection) {
            ForEach(ThemePreference.allCases) { pref in
                Label(pref.label, systemImage: pref.iconName).tag(pref)
            }
        }
        .pickerStyle(.segmented)
    }
}
