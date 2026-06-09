import SwiftUI
import SwiftData

@main
struct MandalartApp: App {
    @State private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(ThemePreference.storageKey) private var rawTheme: String = ThemePreference.system.rawValue
    /// 前面復帰 pull の最終実行時刻。cold launch の fullSync との二重 pull / 連続復帰を間引く。
    @State private var lastForegroundResync: Date?

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
                .preferredColorScheme(ThemePreference(rawValue: rawTheme)?.colorScheme)
                .task { await auth.bootstrap() }
                // サインイン状態が変わるたびに発火 (= bootstrap で session 復元時 / 手動サインイン時)。
                // サインイン直後: フル同期 → realtime 購読開始 + mutation 駆動 push のトラッカー開始。
                // サインアウト時: 購読停止 + トラッカー停止。
                //
                // 旧 15 秒 auto-push polling は永久廃止し SyncDirtyTracker (mutation 駆動 + 60 秒
                // sliding debounce) に置換 (落とし穴 #24)。realtime 購読は「任意 change → 1 秒 debounce
                // pullAll」方式で echo-safe (pull は GET + 非 dirty write で broadcast を生まない)。
                .task(id: auth.isSignedIn) {
                    let context = sharedModelContainer.mainContext
                    if auth.isSignedIn {
                        await fullSync()
                        await RealtimeService.shared.subscribe(into: context)
                        SyncDirtyTracker.shared.start(context: context)
                    } else {
                        await RealtimeService.shared.unsubscribe()
                        SyncDirtyTracker.shared.stop()
                    }
                }
                // scene phase 連動の保険同期。
                // - .background: 残 dirty を即 push (debounce 待ちの取りこぼし防止)
                // - .active: 前面復帰時に pullAll で他端末の変更を取り込む (desktop useVisibilityResync 等価)。
                //   realtime postgres_changes が Supabase の非対称 JWT 移行で配信不達のため (落とし穴 #24)、
                //   この foreground 保険 pull が desktop→iOS 反映の主経路になる。pull は REST(GET) なので
                //   Realtime Messages quota は消費しない。
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .background:
                        SyncDirtyTracker.shared.flushNow()
                    case .active:
                        Task { @MainActor in await foregroundResync() }
                    default:
                        break
                    }
                }
        }
        .modelContainer(sharedModelContainer)
    }

    /// 起動時 / サインイン直後の初回フル同期。pull → push の順で実行
    /// (他端末の更新を先に取り込んでから自分の差分を push)。
    @MainActor
    private func fullSync() async {
        let context = sharedModelContainer.mainContext
        do {
            _ = try await SyncEngine.shared.pullAll(into: context)
            _ = try await SyncEngine.shared.pushPending(from: context)
            // ローカル画像のうち Storage 未アップロード分を回収 (best-effort)
            await SyncEngine.shared.backfillImages(from: context)
            lastForegroundResync = Date()  // 直後の .active 復帰 pull を debounce で間引く
        } catch {
            print("[auto-sync] fullSync failed:", error)
        }
    }

    /// 前面復帰 (scene .active) 時の保険 pull。realtime 不達分をここで取り込む。
    /// cold launch の fullSync 直後 / 連続復帰は 5 秒 debounce で間引く。
    @MainActor
    private func foregroundResync() async {
        guard auth.isSignedIn else { return }
        if let last = lastForegroundResync, Date().timeIntervalSince(last) < 5 { return }
        lastForegroundResync = Date()
        do {
            _ = try await SyncEngine.shared.pullAll(into: sharedModelContainer.mainContext)
        } catch {
            print("[foreground-resync] pullAll failed:", error)
        }
    }
}
