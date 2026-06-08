import SwiftUI
import SwiftData

@main
struct MandalartApp: App {
    @State private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(ThemePreference.storageKey) private var rawTheme: String = ThemePreference.system.rawValue
    /// DB 編集 → debounce → 出力先フォルダへ各マンダラートを書き出す auto-flush ドライバ
    /// (一方向 DB→ファイル。mirrorEnabled ON のときだけ書く。取り込みはしない)。
    @State private var mirror = MirrorAutoFlush()

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
                // DB 編集を出力先フォルダへ自動ミラーする購読を開始 (一方向 DB→ファイル)。
                .task { mirror.start(context: sharedModelContainer.mainContext) }
                // サインイン状態が変わるたびに発火 (= bootstrap で session 復元時 / 手動サインイン時)。
                // サインイン直後: フル同期のみ。
                //
                // ⚠️ EMERGENCY STOP (2026-05-04): Supabase Realtime Messages 過剰使用警告のため
                // realtime 購読を停止中。Dashboard で使用量が止まったことを確認してから段階的に再有効化。
                // 復帰前に: (a) BEFORE UPDATE トリガによる updated_at 書き換えを Supabase 側で確認、
                // (b) echo skip ロジックを完全実装、(c) subscribe 経路を 1 本に統合。
                // 詳細: /Users/maro02/.claude/plans/ios-swift-glistening-thacker.md
                .task(id: auth.isSignedIn) {
                    if auth.isSignedIn {
                        await fullSync()
                        // await RealtimeService.shared.subscribe(
                        //     into: sharedModelContainer.mainContext
                        // )
                    } else {
                        // await RealtimeService.shared.unsubscribe()
                    }
                }
                // ⚠️ EMERGENCY STOP (2026-05-04): 15 秒 auto-push polling は Supabase Realtime Messages
                // 過剰使用の主犯候補 (cloud BEFORE UPDATE トリガで毎回 broadcast 生成)。停止中。
                // 復帰時は mutation 駆動の dirty flag + 60 秒以上 debounce に置換すること。
                // .task(id: auth.isSignedIn) {
                //     guard auth.isSignedIn else { return }
                //     while !Task.isCancelled {
                //         try? await Task.sleep(for: .seconds(15))
                //         if Task.isCancelled { break }
                //         let context = sharedModelContainer.mainContext
                //         _ = try? await SyncEngine.shared.pushPending(from: context)
                //     }
                // }
        }
        .modelContainer(sharedModelContainer)
        // ⚠️ EMERGENCY STOP (2026-05-04): scenePhase 遷移ごとの pull/push も停止中。
        // ロック解除 / Slide Over / Multitask 等で頻発し broadcast を増幅していた可能性あり。
        // 手動「今すぐ同期」ボタン (SettingsView) で代替。
        .onChange(of: scenePhase) { _, newPhase in
            // 背面遷移時に未 flush の編集を出力先へ確定する (一方向 DB→ファイル、保険 flush)。
            // クラウド同期は触らない (落とし穴 #24 に抵触しない)。
            if newPhase == .background {
                mirror.flushNow()
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
            // ローカル画像のうち Storage 未アップロード分を回収 (best-effort)
            await SyncEngine.shared.backfillImages(from: context)
        } catch {
            print("[auto-sync] fullSync failed:", error)
        }
    }
}
