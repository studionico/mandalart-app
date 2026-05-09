import SwiftUI

/// セル / メモ共通の全画面編集 sheet。
/// `.fullScreenCover` の content として配置し、NavigationStack + toolbar (キャンセル/完了) +
/// 単一 TextField または TextEditor を表示。iOS が NavigationStack 内で自動 keyboard
/// avoidance してくれるので Landscape でも入力欄が常に見える。
struct EditingSheet: View {
    let title: String
    @Binding var text: String
    /// true なら multi-line TextEditor、false なら axis: .vertical の TextField。
    let multiline: Bool
    let onCancel: () -> Void
    let onCommit: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if multiline {
                    TextEditor(text: $text)
                        .font(.body)
                        .scrollContentBackground(.hidden)
                        .padding(12)
                        .focused($isFocused)
                } else {
                    TextField("", text: $text, axis: .vertical)
                        .font(.title3)
                        .multilineTextAlignment(.leading)
                        .padding(16)
                        .focused($isFocused)
                        .submitLabel(.done)
                        .onSubmit { onCommit() }
                }
            }
            .background(NeutralPalette.surfaceBackground)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完了", action: onCommit)
                        .fontWeight(.semibold)
                }
            }
            .onAppear {
                DispatchQueue.main.async { isFocused = true }
            }
        }
    }
}
