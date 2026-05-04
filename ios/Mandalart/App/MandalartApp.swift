import SwiftUI
import SwiftData

@main
struct MandalartApp: App {
    @State private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase

    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Mandalart.self,
            Grid.self,
            Cell.self,
            Folder.self,
            StockItem.self,
        ])
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )
        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .task { await auth.bootstrap() }
                // サインイン状態が変わるたびに発火 (= bootstrap で session 復元時 / 手動サインイン時)。
                // サインイン直後: フル同期 + realtime 購読開始。サインアウト: realtime 停止。
                .task(id: auth.isSignedIn) {
                    if auth.isSignedIn {
                        await fullSync()
                        await RealtimeService.shared.subscribe(
                            into: sharedModelContainer.mainContext
                        )
                    } else {
                        await RealtimeService.shared.unsubscribe()
                    }
                }
                // サインイン中の定期 auto-push (15 秒間隔)。
                // 各 mutation point に debounced trigger を仕掛ける代わりに、シンプルな polling
                // で「直近の編集を 15 秒以内に他デバイスへ push」する保証を作る。
                // realtime 取りこぼし保険 (落とし穴 #22) や scene .background 待ちの遅延を埋める。
                .task(id: auth.isSignedIn) {
                    guard auth.isSignedIn else { return }
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(15))
                        if Task.isCancelled { break }
                        let context = sharedModelContainer.mainContext
                        _ = try? await SyncEngine.shared.pushPending(from: context)
                    }
                }
        }
        .modelContainer(sharedModelContainer)
        // フォアグラウンド復帰 → pull (他端末の変更を取り込む)
        // バックグラウンド遷移 → push (自分の編集を他端末へ届ける)
        // realtime 未実装の現状ではこれが cross-device 反映の主経路 (落とし穴 #22 desktop 側と同等)
        .onChange(of: scenePhase) { _, phase in
            guard auth.isSignedIn else { return }
            let context = sharedModelContainer.mainContext
            Task { @MainActor in
                switch phase {
                case .active:
                    try? await SyncEngine.shared.pullAll(into: context)
                case .background:
                    try? await SyncEngine.shared.pushPending(from: context)
                default:
                    break
                }
            }
        }
    }

    /// 起動時 / サインイン直後の初回フル同期。pull → push の順で実行
    /// (他端末の更新を先に取り込んでから自分の差分を push)。
    @MainActor
    private func fullSync() async {
        let context = sharedModelContainer.mainContext
        do {
            _ = try await SyncEngine.shared.pullAll(into: context)
            _ = try await SyncEngine.shared.pushPending(from: context)
        } catch {
            print("[auto-sync] fullSync failed:", error)
        }
    }
}
