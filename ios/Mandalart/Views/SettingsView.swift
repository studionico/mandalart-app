import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @State private var showSignIn = false
    @State private var syncStatus: String?
    @State private var syncing = false

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
        }
    }
}
