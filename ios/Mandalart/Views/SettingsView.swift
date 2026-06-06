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
    #if DEBUG
    // vault フォルダモードの開発ハーネス (Stage I/O-b)。本番トグル無し・DB 書込み無し。
    @State private var vaultConfig = VaultConfig.empty
    @State private var vaultFolderName: String?
    @State private var vaultStatus: String?
    @State private var showVaultPicker = false
    private var vaultConfigured: Bool { vaultConfig.vaultBookmark != nil }
    #endif

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

                #if DEBUG
                Section("Vault（実験的・開発ビルド限定）") {
                    Button {
                        showVaultPicker = true
                    } label: {
                        HStack {
                            Text("フォルダを選択")
                            Spacer()
                            Text(vaultFolderName ?? "未選択")
                                .foregroundStyle(.secondary)
                        }
                    }
                    Button("vault に書き出す") { exportToVault() }
                        .disabled(!vaultConfigured)
                    Button("dry-run scan") { dryRunVault() }
                        .disabled(!vaultConfigured)
                    if let vaultStatus {
                        Text(vaultStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                #endif
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
            #if DEBUG
            .fileImporter(
                isPresented: $showVaultPicker,
                allowedContentTypes: [.folder],
                allowsMultipleSelection: false,
                onCompletion: handleVaultFolderPick
            )
            .onAppear(perform: loadVaultConfig)
            #endif
        }
    }

    #if DEBUG
    // MARK: - Vault 開発ハーネス (Stage I/O-b)

    private func loadVaultConfig() {
        let config = VaultConfigStore.load()
        vaultConfig = config
        vaultFolderName = config.vaultPath.map { ($0 as NSString).lastPathComponent }
    }

    private func handleVaultFolderPick(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            vaultStatus = "選択失敗: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let bookmark = try VaultBookmark.withAccess(url) { try VaultBookmark.make(for: url) }
                var config = VaultConfigStore.load()
                config.vaultBookmark = bookmark
                config.vaultPath = url.path
                VaultConfigStore.save(config)
                vaultConfig = config
                vaultFolderName = url.lastPathComponent
                vaultStatus = "フォルダを設定: \(url.lastPathComponent)"
            } catch {
                vaultStatus = "bookmark 作成失敗: \(error.localizedDescription)"
            }
        }
    }

    private func exportToVault() {
        guard let bookmark = vaultConfig.vaultBookmark, let resolved = VaultBookmark.resolve(bookmark) else {
            vaultStatus = "フォルダ未設定 / bookmark 解決失敗"
            return
        }
        let rows = VaultRowsBridge.loadAllMandalartRows(in: modelContext)
        let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
        do {
            let report = try VaultBookmark.withAccess(resolved.url) {
                try VaultSync.exportAllToVault(rows: rows, to: resolved.url, appSupportDir: appSupport)
            }
            vaultStatus = "書き出し: \(report.mandalarts) マンダラート / \(report.files) ファイル / 画像 \(report.imagesCopied)"
        } catch {
            vaultStatus = "書き出し失敗: \(error.localizedDescription)"
        }
    }

    private func dryRunVault() {
        guard let bookmark = vaultConfig.vaultBookmark, let resolved = VaultBookmark.resolve(bookmark) else {
            vaultStatus = "フォルダ未設定 / bookmark 解決失敗"
            return
        }
        do {
            let report = try VaultBookmark.withAccess(resolved.url) {
                try VaultSync.dryRunScan(at: resolved.url)
            }
            vaultStatus = "scan: \(report.mandalarts) マンダラート / \(report.grids) グリッド / \(report.cells) セル"
        } catch {
            vaultStatus = "scan 失敗: \(error.localizedDescription)"
        }
    }
    #endif
}
