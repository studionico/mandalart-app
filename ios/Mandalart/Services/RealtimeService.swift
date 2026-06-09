import Foundation
import SwiftData
import Supabase

/// Supabase realtime (postgres_changes) を購読し、他デバイスの変更を即時 iOS に反映する。
///
/// **戦略**: incremental upsert (= 各 INSERT/UPDATE/DELETE event を個別に SwiftData に
/// 反映) ではなく、**任意の change で `SyncEngine.pullAll()` を 1 秒 debounce で再発火**
/// する単純化方式を採用。理由:
///
/// 1. 子行の cascade DELETE が realtime では届かない (desktop 側落とし穴 #5)、incremental
///    update で取りこぼしを再現するのは複雑
/// 2. pullAll は `last-write-wins` で冪等なので、同一データを再 pull しても害なし
/// 3. 1 秒 debounce で連続発火 (= 自分自身の push echo / 複数行 INSERT) をまとめる
///
/// **ライフサイクル**: `subscribe(into:)` をサインイン直後に呼び、サインアウト時に
/// `unsubscribe()` する。`MandalartApp.task(id: auth.isSignedIn)` で配線。
///
/// **既存の auto-sync (scene phase ベース) との関係**: realtime は通常時の即時反映、
/// scene phase pull は WebSocket silent drop / sleep からの保険同期。両者並行動作。
@MainActor
final class RealtimeService {
    static let shared = RealtimeService()

    private let client = SupabaseService.shared.client
    private var channel: RealtimeChannelV2?
    private var subscriptions: [RealtimeSubscription] = []
    private var pullDebouncer: Task<Void, Never>?
    private weak var contextForSync: ModelContext?

    private init() {}

    /// 4 テーブル (folders / mandalarts / grids / cells) の postgres_changes を購読する。
    /// 既に購読中の場合は先に unsubscribe してから再購読する。
    func subscribe(into context: ModelContext) async {
        await unsubscribe()
        contextForSync = context

        // realtime 接続を現在の auth トークンで認証してから購読する。postgres_changes はサーバ側で
        // RLS を評価するため、接続が未認証 (anon) だと自分の行も含め全行が弾かれて配信ゼロになる。
        await client.realtimeV2.setAuth()

        // `client.realtime` は V1 (legacy)、`realtimeV2` が postgres_changes Async API を持つ。
        let ch = client.realtimeV2.channel("mandalart-app")
        channel = ch

        let tables = ["folders", "mandalarts", "grids", "cells"]
        for table in tables {
            let sub = ch.onPostgresChange(
                AnyAction.self,
                schema: "public",
                table: table
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.scheduleSync()
                }
            }
            subscriptions.append(sub)
        }

        // deprecated な subscribe() は `try? await subscribeWithError()` で join 失敗を握り潰すため、
        // subscribeWithError() で明示的に例外を捕捉する (join 失敗が無音化すると events が一切来ない)。
        // 注: 2026-06-09 時点、Supabase の非対称 JWT (ES256) 移行で realtime の postgres_changes 認可が
        // 機能せず配信不達 (落とし穴 #24)。subscribe 自体は残置 (将来サーバ側修正で自動復活)、
        // desktop→iOS の実反映は MandalartApp の前面復帰 pull が担う。
        do {
            try await ch.subscribeWithError()
        } catch {
            print("[realtime] subscribe failed:", error)
        }
    }

    /// 購読を停止しチャンネルを切断する。
    func unsubscribe() async {
        pullDebouncer?.cancel()
        pullDebouncer = nil
        for sub in subscriptions {
            sub.cancel()
        }
        subscriptions.removeAll()
        if let ch = channel {
            await ch.unsubscribe()
        }
        channel = nil
        contextForSync = nil
    }

    /// realtime event burst を 1 秒 debounce してまとめて pullAll を実行する。
    /// 自分自身の push echo は冪等な pullAll で吸収される (= 0 件カウント返却)。
    private func scheduleSync() {
        pullDebouncer?.cancel()
        pullDebouncer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            guard let context = self?.contextForSync else { return }
            do {
                _ = try await SyncEngine.shared.pullAll(into: context)
            } catch {
                print("[realtime] pullAll failed:", error)
            }
        }
    }
}
