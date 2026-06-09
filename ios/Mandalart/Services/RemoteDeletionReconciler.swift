import Foundation

/// pull の reconcile 用 純粋ロジック (desktop [`reconcileDeletions.ts`](../../../desktop/src/lib/sync/reconcileDeletions.ts) と同値仕様)。
///
/// **背景**: pull は upsert 専用なので「cloud から物理 hard delete されて SELECT 結果に
/// 現れない行」を検知できない。対向 desktop の `permanentDeleteMandalart` / `permanentDeleteGrid`
/// は cloud から行を物理削除するため、その削除をローカルへ伝播させるには
/// 「ローカルに在るが cloud に居ない synced 行 = 削除済み」と判定して消す必要がある。
/// 本型はその判定だけを純粋に行う (SwiftData I/O は呼び出し側の `SyncEngine`)。
///
/// 安全性の非対称: 消し損ね (false negative) は次回 pull で回収できるので許容するが、
/// 誤削除 (false positive) は不許容。よって:
///  - `isSynced == false` (= まだ cloud に push していない local-only 行) は絶対に消さない。
///  - `truncated == true` (= cloud fetch が PostgREST max-rows で切れている疑い) なら
///    cloud id 集合が不完全なので一切消さない。
///
/// Foundation のみ依存 (SwiftData / Supabase を import しない) なので LogicTests スキームで
/// Supabase 非リンクのまま検証できる (iOS 落とし穴 #1)。
enum RemoteDeletionReconciler {
    struct LocalRow {
        let id: String
        let isSynced: Bool
        init(id: String, isSynced: Bool) {
            self.id = id
            self.isSynced = isSynced
        }
    }

    static func idsToDelete(
        local: [LocalRow],
        cloudIds: Set<String>,
        truncated: Bool
    ) -> Set<String> {
        guard !truncated else { return [] }
        var result = Set<String>()
        for row in local {
            guard row.isSynced else { continue }
            if !cloudIds.contains(row.id) { result.insert(row.id) }
        }
        return result
    }
}
