import SwiftUI
import UniformTypeIdentifiers

/// Export / Import の結果を表示する alert state。
struct TransferAlertState: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

/// Export 関連の modifier (confirmationDialog + fileExporter)。
///
/// **本ファイルに切り出す理由**: `DashboardView.swift` 内に置くと SwiftUI modifier chain の
/// 累積複雑度が SourceKit (= Live Issues 用 type-checker) の閾値を超え、
/// `Cannot find type X` の連鎖エラーが Live Issues に表示される。Build (swiftc) は通るが
/// IDE 体験を損なうので、modifier 定義を別ファイル + ViewModifier 化して 2 modifier ずつに分割。
struct DashboardExportModifier: ViewModifier {
    let exportTarget: Mandalart?
    @Binding var showExportFormatDialog: Bool
    let exportDocument: MandalartExportDocument?
    let exportContentType: UTType
    let exportFilename: String
    @Binding var showFileExporter: Bool
    let onPickFormat: (Mandalart, ExportFormat) -> Void
    let onCancelFormat: () -> Void
    let onExportResult: (Result<URL, Error>) -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                "エクスポート形式",
                isPresented: $showExportFormatDialog,
                presenting: exportTarget
            ) { m in
                Button(ExportFormat.json.label) { onPickFormat(m, .json) }
                Button(ExportFormat.markdown.label) { onPickFormat(m, .markdown) }
                Button(ExportFormat.indentText.label) { onPickFormat(m, .indentText) }
                Button("キャンセル", role: .cancel) { onCancelFormat() }
            } message: { m in
                Text("「\(m.title.isEmpty ? "(無題)" : m.title)」をエクスポート")
            }
            .fileExporter(
                isPresented: $showFileExporter,
                document: exportDocument,
                contentType: exportContentType,
                defaultFilename: exportFilename,
                onCompletion: onExportResult
            )
    }
}

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
