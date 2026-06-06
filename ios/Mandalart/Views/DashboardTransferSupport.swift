import SwiftUI
import UniformTypeIdentifiers

/// Export / Import の結果を表示する alert state。
struct TransferAlertState: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

// Export はダッシュボードには無い (desktop と同様、export はエディターのビュー単位のみ)。
// 旧 DashboardExportModifier は撤去。export 経路は EditorView の「ビュー単位エクスポート」へ集約。

/// Import + 結果通知 alert の modifier (fileImporter + alert)。
struct DashboardImportAlertModifier: ViewModifier {
    @Binding var showFileImporter: Bool
    @Binding var transferAlert: TransferAlertState?
    let onImportResult: (Result<[URL], Error>) -> Void

    func body(content: Content) -> some View {
        content
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.json, .plainText, UTType(filenameExtension: "md") ?? .plainText],
                allowsMultipleSelection: false,
                onCompletion: onImportResult
            )
            .alert(
                transferAlert?.title ?? "",
                isPresented: Binding(
                    get: { transferAlert != nil },
                    set: { if !$0 { transferAlert = nil } }
                ),
                presenting: transferAlert
            ) { _ in
                Button("OK", role: .cancel) { transferAlert = nil }
            } message: { state in
                Text(state.message)
            }
    }
}
