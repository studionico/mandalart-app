import Foundation
import SwiftData

/// vault モード OFF 時にクラウド再同期へ向けてローカル状態を「正」に整備する (vault OFF 遷移時の updated_at 整備)。
///
/// vault モード中は同期を停止し vault を正に DB を再構築する。`VaultDbApply` は本文編集 (Stage ③) で `updatedAt` を
/// bump せず frontmatter の (stale な) 値のまま入れ、`syncedAt` も触らない。このまま OFF にすると:
///   ① `needsPush` (syncedAt < updatedAt) が false になり vault 編集が push されない、
///   ② `fullSync` の pull→push 順で、pull の LWW (cloudUpdated > local.updatedAt) が stale な local を上書きする。
/// → 全行の `updatedAt` を `now` に bump すると、pull の LWW が false になり clobber されず、needsPush も true になり
/// push される。cloud の BEFORE UPDATE トリガが push 時に `updated_at = NOW()` を付けるので cloud 側が最新化され、
/// vault/ローカルが勝つ。`syncedAt` は触らない (= bump 後 `syncedAt < updatedAt` で dirty)。
///
/// soft-deleted 行 (tombstone) も含め全行 bump し「ローカル全面勝ち」を徹底する。SwiftData のみ依存 (Supabase 非リンク)。
@MainActor
enum VaultExitSync {

    /// 全ローカル行の `updatedAt` を `now` に bump して dirty 化し、bump した行数を返す。
    @discardableResult
    static func markLocalRowsDirty(now: Date = Date(), in context: ModelContext) -> Int {
        var count = 0
        for m in (try? context.fetch(FetchDescriptor<Mandalart>())) ?? [] { m.updatedAt = now; count += 1 }
        for g in (try? context.fetch(FetchDescriptor<Grid>())) ?? [] { g.updatedAt = now; count += 1 }
        for c in (try? context.fetch(FetchDescriptor<Cell>())) ?? [] { c.updatedAt = now; count += 1 }
        for f in (try? context.fetch(FetchDescriptor<Folder>())) ?? [] { f.updatedAt = now; count += 1 }
        try? context.save()
        return count
    }
}
