import SwiftUI
import SwiftData

@main
struct MandalartApp: App {
    @State private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(ThemePreference.storageKey) private var rawTheme: String = ThemePreference.system.rawValue
    /// vault モード起動 rebuild の完了フラグ。vault OFF (release 含む) では最初から true で
    /// 「初期化中…」を出さない (= shouldRebuildOnStartup が false なら即 ready)。
    @State private var bootstrapDone = !shouldRebuildOnStartup(VaultConfigStore.load())
    /// DB 編集 → debounce → vault へ差分 flush する auto-flush ドライバ (vaultMode ON のときだけ書く)。
    @State private var autoFlush = VaultAutoFlush()
    /// 一度でも background に入ったか (= 起動直後の .active を「復帰」と誤認しないためのガード)。
    @State private var wasBackgrounded = false

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
            Group {
                if bootstrapDone {
                    ContentView()
                        .environment(auth)
                        .preferredColorScheme(ThemePreference(rawValue: rawTheme)?.colorScheme)
                        .task { await auth.bootstrap() }
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
                } else {
                    // vault モード起動 rebuild 中 (vault OFF では出ない)。
                    ProgressView("初期化中…")
                }
            }
            .task { await bootstrapVaultRebuild() }
        }
        .modelContainer(sharedModelContainer)
        // ⚠️ EMERGENCY STOP (2026-05-04): scenePhase 遷移ごとの pull/push も停止中。
        // ロック解除 / Slide Over / Multitask 等で頻発し broadcast を増幅していた可能性あり。
        // 手動「今すぐ同期」ボタン (SettingsView) で代替。
        .onChange(of: scenePhase) { _, newPhase in
            // 緊急停止中: クラウド同期は何もしない。vault モードのファイル往復だけ扱う
            // (cloud 同期に無関係 = 落とし穴 #24 に抵触しない。vaultMode OFF なら内部で no-op)。
            switch newPhase {
            case .background:
                // 背面 = 書き出し (DB→vault)。離れる前にアプリ内編集を vault へ確定。
                // ⚠️ flush は **.background だけ**で行う。復帰シーケンスは `.background→.inactive→.active`
                // の順で、`.inactive` でも flush すると **復帰の途中で外部編集を上書き**してしまい、続く
                // `.active` の取り込みが潰れた vault を読む (= 症状2 再発のバグ)。離脱の確定点は .background。
                autoFlush.flushNow()
                wasBackgrounded = true
            case .active:
                // 復帰 = 取り込み (vault→DB)。背面中に外部編集された .md を DB へ反映してから
                // 以後の flush で上書きされないようにする (iOS は watcher が無いのでこの 2 点で往復させる)。
                if wasBackgrounded {
                    wasBackgrounded = false
                    importVaultOnForeground()
                }
            case .inactive:
                // 何もしない (復帰経路でも発火するため、ここで flush すると外部編集を潰す)。
                break
            @unknown default:
                break
            }
        }
    }

    /// vault モード ON のときに vault→DB 再構築を行う (起動時 1 回)。
    /// vault が正・DB はキャッシュなので、起動時に vault の内容で DB を作り直す。失敗しても
    /// 既存 DB で続行する (データ無傷)。vault OFF / フォルダ未設定なら即 ready。
    @MainActor
    private func bootstrapVaultRebuild() async {
        defer {
            bootstrapDone = true
            // rebuild 完了後に auto-flush 購読を開始 (reconcile の save を誤って拾わない)。
            autoFlush.start(context: sharedModelContainer.mainContext)
        }
        let config = VaultConfigStore.load()
        guard shouldRebuildOnStartup(config),
              let bookmark = config.vaultBookmark,
              let resolved = VaultBookmark.resolve(bookmark) else { return }
        let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
        do {
            _ = try VaultBookmark.withAccess(resolved.url) {
                try VaultDbReconcile.reconcileVaultToDb(
                    vaultRoot: resolved.url, in: sharedModelContainer.mainContext, appSupportDir: appSupport)
            }
        } catch {
            print("[vault] startup rebuild failed (既存 DB で続行):", error)
        }
    }

    /// background から復帰したときに vault→DB を取り込む (vaultMode のみ)。背面中に外部編集された
    /// .md を DB に反映する。これが無いと外部編集が次の auto-flush で上書きされてしまう
    /// (iOS はフォルダ watcher が無いため「背面=書き出し / 復帰=取り込み」で双方向を成立させる)。
    @MainActor
    private func importVaultOnForeground() {
        let config = VaultConfigStore.load()
        guard config.vaultMode,
              let bookmark = config.vaultBookmark,
              let resolved = VaultBookmark.resolve(bookmark) else { return }
        let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
        do {
            _ = try VaultBookmark.withAccess(resolved.url) {
                try VaultDbReconcile.reconcileVaultToDb(
                    vaultRoot: resolved.url, in: sharedModelContainer.mainContext, appSupportDir: appSupport)
            }
        } catch {
            print("[vault] foreground import failed:", error)
        }
    }

    /// 起動時 / サインイン直後の初回フル同期。pull → push の順で実行
    /// (他端末の更新を先に取り込んでから自分の差分を push)。
    /// vault モード中はクラウド同期を完全停止する (vault が正・ファイル同期に委譲、
    /// 起動 rebuild した DB を pull が上書きする衝突を防ぐ。落とし穴 #24 と同根)。
    @MainActor
    private func fullSync() async {
        if VaultConfigStore.load().vaultMode { return }
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
