import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @State private var showSignIn = false
    @State private var syncStatus: String?
    @State private var syncing = false
    // ローカル JSON ミラー (一方向 DB→ファイル) の設定。
    @State private var mirrorConfig = MirrorConfig.empty
    @State private var mirrorFolderName: String?
    @State private var mirrorStatus: String?
    @State private var showMirrorPicker = false
    @State private var mirrorBusy = false
    private var mirrorConfigured: Bool { mirrorConfig.mirrorBookmark != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section("アカウント") {
                    if auth.isSignedIn {
                        LabeledContent("メール") {
                            Text(auth.userEmail ?? "?")
                                .foregroundStyle(.secondary)
                        }
                        Button("サインアウト", role: .destructive) {
                            Task { await auth.signOut() }
                        }
                    } else {
                        Button("サインイン / 新規登録") {
                            showSignIn = true
                        }
                        Text("サインインするとデスクトップ版とクラウド経由で同期します。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if auth.isSignedIn {
                    Section("同期") {
                        Button {
                            Task {
                                syncing = true
                                syncStatus = "同期中..."
                                do {
                                    let pull = try await SyncEngine.shared.pullAll(into: modelContext)
                                    let push = try await SyncEngine.shared.pushPending(from: modelContext)
                                    // ローカル画像のうち Storage 未アップロード分を回収 (best-effort)
                                    await SyncEngine.shared.backfillImages(from: modelContext)
                                    syncStatus = "Pull: \(pull.mandalarts) マンダラート / Push: \(push.mandalarts) マンダラート"
                                } catch {
                                    syncStatus = "失敗: \(error.localizedDescription)"
                                }
                                syncing = false
                            }
                        } label: {
                            HStack {
                                Text("今すぐ同期")
                                Spacer()
                                if syncing { ProgressView() }
                            }
                        }
                        .disabled(syncing)
                        if let status = syncStatus {
                            Text(status)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("外観") {
                    ThemeToggle(layout: .segmented)
                }

                Section("バージョン") {
                    LabeledContent("ビルド") {
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("ローカル JSON ミラー") {
                    Button {
                        showMirrorPicker = true
                    } label: {
                        HStack {
                            Text("出力先フォルダを選択")
                            Spacer()
                            Text(mirrorFolderName ?? "未選択")
                                .foregroundStyle(.secondary)
                        }
                    }
                    Toggle("自動ミラー（編集を自動で書き出す）", isOn: Binding(
                        get: { mirrorConfig.mirrorEnabled },
                        set: { setMirrorEnabled($0) }
                    ))
                    .disabled(!mirrorConfigured || mirrorBusy)
                    Button("今すぐ書き出す") { exportNow() }
                        .disabled(!mirrorConfigured || mirrorBusy)
                    if let mirrorStatus {
                        Text(mirrorStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text("各マンダラートを JSON ファイルとして書き出します（一方向の控え）。外部エディタでファイルを編集してもアプリには取り込まれません。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("設定")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("閉じる") { dismiss() }
                }
            }
            .sheet(isPresented: $showSignIn) {
                SignInView()
                    .environment(auth)
            }
            .fileImporter(
                isPresented: $showMirrorPicker,
                allowedContentTypes: [.folder],
                allowsMultipleSelection: false,
                onCompletion: handleMirrorFolderPick
            )
            .onAppear(perform: loadMirrorConfig)
        }
    }

    // MARK: - ローカル JSON ミラー

    private func loadMirrorConfig() {
        let config = MirrorConfigStore.load()
        mirrorConfig = config
        mirrorFolderName = config.mirrorPath.map { ($0 as NSString).lastPathComponent }
    }

    private func handleMirrorFolderPick(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            mirrorStatus = "選択失敗: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let bookmark = try SecurityScopedBookmark.withAccess(url) {
                    try SecurityScopedBookmark.make(for: url)
                }
                var config = MirrorConfigStore.load()
                config.mirrorBookmark = bookmark
                config.mirrorPath = url.path
                MirrorConfigStore.save(config)
                mirrorConfig = config
                mirrorFolderName = url.lastPathComponent
                mirrorStatus = "出力先を設定: \(url.lastPathComponent)"
            } catch {
                mirrorStatus = "bookmark 作成失敗: \(error.localizedDescription)"
            }
        }
    }

    /// 自動ミラーの ON/OFF。ON 時はその場で 1 回書き出してフォルダを現状に揃える。
    private func setMirrorEnabled(_ enabled: Bool) {
        var config = MirrorConfigStore.load()
        config.mirrorEnabled = enabled
        MirrorConfigStore.save(config)
        mirrorConfig = config
        if enabled {
            exportNow()
        } else {
            mirrorStatus = "自動ミラー OFF"
        }
    }

    private func exportNow() {
        guard let bookmark = mirrorConfig.mirrorBookmark,
              let resolved = SecurityScopedBookmark.resolve(bookmark) else {
            mirrorStatus = "フォルダ未設定 / bookmark 解決失敗"
            return
        }
        mirrorBusy = true
        defer { mirrorBusy = false }
        do {
            let report = try SecurityScopedBookmark.withAccess(resolved.url) {
                try MirrorSync.mirrorAll(to: resolved.url, in: modelContext)
            }
            mirrorStatus = "書き出し: 更新 \(report.written) / 削除 \(report.deleted)"
        } catch {
            mirrorStatus = "書き出し失敗: \(error.localizedDescription)"
        }
    }
}
