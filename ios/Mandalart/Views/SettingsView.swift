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
    /// vault モード中はクラウド同期を停止する (本番 gate)。DEBUG トグルが書く `vault.mode` を共有読み。
    /// release では DEBUG トグルが無いので常に false = 同期は通常どおり。
    @AppStorage(VaultConfigStore.Keys.mode) private var vaultModeFlag = false
    #if DEBUG
    // vault フォルダモードの開発ハーネス (Stage I/O-b)。本番トグル無し・DB 書込み無し。
    @State private var vaultConfig = VaultConfig.empty
    @State private var vaultFolderName: String?
    @State private var vaultStatus: String?
    @State private var showVaultPicker = false
    @State private var showRebuildConfirm = false
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
                        .disabled(syncing || vaultModeFlag)
                        if vaultModeFlag {
                            Text("vault モード中はクラウド同期を停止しています。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let status = syncStatus {
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
                    Toggle("vault モード（同期を止めて vault を正に）", isOn: Binding(
                        get: { vaultConfig.vaultMode },
                        set: { setVaultMode($0) }
                    ))
                    .disabled(!vaultConfigured)
                    Button("vault に書き出す") { exportToVault() }
                        .disabled(!vaultConfigured)
                    Button("dry-run scan") { dryRunVault() }
                        .disabled(!vaultConfigured)
                    Button("vault から再構築", role: .destructive) { showRebuildConfirm = true }
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
            .confirmationDialog(
                "vault の内容で DB を再構築します。よろしいですか?",
                isPresented: $showRebuildConfirm,
                titleVisibility: .visible
            ) {
                Button("再構築する", role: .destructive) { rebuildFromVault() }
                Button("キャンセル", role: .cancel) {}
            } message: {
                Text("DB を vault フォルダの内容で上書きします（DB に有り vault に無いマンダラートは消しません）。")
            }
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

    /// vault モードの ON/OFF。ON 時は baseline export (現在の DB を vault に書き出し files=DB に揃える)
    /// を行ってから config を保存する。これで初回起動 rebuild が no-op になり「空/古い vault で DB が
    /// 消える」事故を防ぐ。bookmark 未設定なら何もしない。
    private func setVaultMode(_ enabled: Bool) {
        var config = VaultConfigStore.load()
        if enabled {
            guard let bookmark = config.vaultBookmark, let resolved = VaultBookmark.resolve(bookmark) else {
                vaultStatus = "フォルダ未設定のため ON にできません"
                return
            }
            let rows = VaultRowsBridge.loadAllMandalartRows(in: modelContext)
            let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
            do {
                let report = try VaultBookmark.withAccess(resolved.url) {
                    try VaultSync.exportAllToVault(rows: rows, to: resolved.url, appSupportDir: appSupport)
                }
                vaultStatus = "vault モード ON（ベースライン書き出し: \(report.files) ファイル）"
            } catch {
                vaultStatus = "ON 失敗（ベースライン書き出しエラー）: \(error.localizedDescription)"
                return // ON にしない
            }
        } else {
            // クラウド再同期で vault 編集を失わせないため全行を dirty 化 (updatedAt=now)。実 push は
            // 次回起動の fullSync か「今すぐ同期」ボタン (OFF で再有効化) に委ねる。
            let n = VaultExitSync.markLocalRowsDirty(in: modelContext)
            vaultStatus = "vault モード OFF（クラウド同期を再開。\(n) 行を再 push 対象に整備）"
        }
        config.vaultMode = enabled
        VaultConfigStore.save(config)
        vaultConfig = config
    }

    /// vault フォルダの内容で実 SwiftData DB を再構築する (確認ダイアログ経由のみ)。
    /// deleteMissingMandalarts=false なので DB に有り vault に無いマンダラートは消さない。
    private func rebuildFromVault() {
        guard let bookmark = vaultConfig.vaultBookmark, let resolved = VaultBookmark.resolve(bookmark) else {
            vaultStatus = "フォルダ未設定 / bookmark 解決失敗"
            return
        }
        let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
        do {
            let report = try VaultBookmark.withAccess(resolved.url) {
                try VaultDbReconcile.reconcileVaultToDb(
                    vaultRoot: resolved.url, in: modelContext, appSupportDir: appSupport)
            }
            vaultStatus = "再構築: \(report.mandalarts) マンダラート / \(report.grids) グリッド / \(report.cells) セル"
        } catch {
            vaultStatus = "再構築失敗: \(error.localizedDescription)"
        }
    }
    #endif
}
