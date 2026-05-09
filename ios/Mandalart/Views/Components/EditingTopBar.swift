import SwiftUI

/// 編集中セル専用の最上部 floating 編集バー。
/// EditorView の ZStack overlay として `editingCellId != nil` のとき表示。
/// .ultraThinMaterial 背景 + safe area top 直下配置で、Landscape キーボードが
/// エディター下半分を覆っても編集対象 TextField を常に視認できる。
struct EditingTopBar: View {
    @Binding var text: String
    let onCancel: () -> Void
    let onCommit: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onCancel) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("編集をキャンセル")

            TextField("セル内容を入力", text: $text, axis: .horizontal)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .focused($isFocused)
                .submitLabel(.done)
                .onSubmit { onCommit() }
                .frame(maxWidth: .infinity)

            Button("完了") { onCommit() }
                .font(.system(size: 15, weight: .semibold))
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(height: 56)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.primary.opacity(0.1), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
        .onAppear {
            DispatchQueue.main.async { isFocused = true }
        }
    }
}
