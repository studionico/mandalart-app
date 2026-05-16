import SwiftUI

/// シュレッダー確認ダイアログを表示する ViewModifier。
/// EditorView の body chain が type-check timeout (iOS 落とし穴 #12) に達するのを
/// 避けるため、`.confirmationDialog` を独立したモディファイアとして切り出している。
///
/// `target` がセットされている間ダイアログを表示し、「削除する」で `onConfirm(cell)` を
/// 呼ぶ。確定後の cell リセットは呼出側 (EditorView の `performShred` の `defer`) が責任を持つ。
struct ShredConfirmModifier: ViewModifier {
    @Binding var target: Cell?
    let title: String
    let onConfirm: (Cell) -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            title,
            isPresented: Binding(
                get: { target != nil },
                set: { if !$0 { target = nil } }
            ),
            titleVisibility: .visible,
            presenting: target
        ) { cell in
            Button("削除する", role: .destructive) {
                onConfirm(cell)
            }
            Button("キャンセル", role: .cancel) {
                target = nil
            }
        } message: { _ in
            Text("この操作は元に戻せません")
        }
    }
}
