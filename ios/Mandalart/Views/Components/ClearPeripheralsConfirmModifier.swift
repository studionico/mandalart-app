import SwiftUI

/// 「周辺セルのクリア」確認ダイアログを表示する ViewModifier。
/// EditorView の body chain が type-check timeout (iOS 落とし穴 #12) に達するのを
/// 避けるため、`.confirmationDialog` を独立したモディファイアとして切り出している
/// (= ShredConfirmModifier と同じ方針)。
///
/// `targetGridId` がセットされている間ダイアログを表示し、「クリアする」で
/// `onConfirm(gridId)` を呼ぶ。確定後の reset は呼出側 (EditorView の
/// `performClearPeripherals` の `defer`) が責任を持つ。
struct ClearPeripheralsConfirmModifier: ViewModifier {
    @Binding var targetGridId: String?
    let onConfirm: (String) -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            "周辺セルをクリアしますか?",
            isPresented: Binding(
                get: { targetGridId != nil },
                set: { if !$0 { targetGridId = nil } }
            ),
            titleVisibility: .visible,
            presenting: targetGridId
        ) { gridId in
            Button("クリアする", role: .destructive) {
                onConfirm(gridId)
            }
            Button("キャンセル", role: .cancel) {
                targetGridId = nil
            }
        } message: { _ in
            Text("周辺 8 セルとその配下をすべてクリアします。中心セルは残ります。この操作は元に戻せません")
        }
    }
}
