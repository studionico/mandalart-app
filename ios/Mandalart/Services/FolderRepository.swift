import Foundation
import SwiftData

/// Folder の bootstrap / orphan 振り分け helper。
/// desktop の [`ensureInboxFolder`](../../../desktop/src/lib/api/folders.ts) と
/// [`adoptOrphanMandalartsToInbox`](../../../desktop/src/lib/api/folders.ts) の iOS 版。
///
/// Inbox は **必ず 1 つ存在する system folder** (`isSystem == true`)。マンダラートは
/// 作成時に必ず folderId を持つ前提で desktop の Dashboard が `m.folder_id = ?` で filter
/// しているため、iOS 側でも作成時に Inbox の id を明示セットする必要がある。
@MainActor
enum FolderRepository {
    /// Inbox folder (= `isSystem == true` で最古の作成順) を取得 / 必要なら新規作成する。
    /// 重複 (system folder が複数) があれば最古を canonical として採用、他は属する mandalart を
    /// canonical に振り分けてから物理削除する。冪等。
    @discardableResult
    static func ensureInboxFolder(in context: ModelContext) throws -> Folder {
        let descriptor = FetchDescriptor<Folder>(
            predicate: #Predicate<Folder> { $0.isSystem == true && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\Folder.createdAt)]
        )
        let all = try context.fetch(descriptor)

        if let canonical = all.first {
            // 重複統合: 2 件目以降の system folder に紐づく mandalarts を canonical に移動 + 物理削除
            if all.count > 1 {
                let dupIds = Set(all.dropFirst().map { $0.id })
                // SwiftData の #Predicate は単一式しか書けず if-let が使えないので、
                // 全件 fetch して Swift 側で filter する (= 件数は少数なのでコスト無視できる)
                let allMandalarts = (try? context.fetch(FetchDescriptor<Mandalart>())) ?? []
                let now = Date()
                for m in allMandalarts where m.folderId.map({ dupIds.contains($0) }) == true {
                    m.folderId = canonical.id
                    m.updatedAt = now
                }
                for dup in all.dropFirst() {
                    context.delete(dup)
                }
                try? context.save()
            }
            return canonical
        }

        // 新規作成
        let now = Date()
        let inbox = Folder(
            id: IDGenerator.uuid(),
            name: "Inbox",
            sortOrder: 0,
            isSystem: true,
            createdAt: now,
            updatedAt: now
        )
        context.insert(inbox)
        try context.save()
        return inbox
    }

    /// `folderId` が nil のマンダラートを Inbox folder に振り分ける。
    /// desktop の [`adoptOrphanMandalartsToInbox`](../../../desktop/src/lib/api/folders.ts) の iOS 版。
    /// pullAll で他デバイス (folder API 未対応の旧 iOS 等) から `folder_id=null` で push された
    /// マンダラートを正規化するときに呼ぶ。
    @discardableResult
    static func adoptOrphansToInbox(in context: ModelContext) throws -> Int {
        let inbox = try ensureInboxFolder(in: context)
        let descriptor = FetchDescriptor<Mandalart>(
            predicate: #Predicate<Mandalart> { $0.folderId == nil && $0.deletedAt == nil }
        )
        let orphans = try context.fetch(descriptor)
        guard !orphans.isEmpty else { return 0 }
        let now = Date()
        for m in orphans {
            m.folderId = inbox.id
            m.updatedAt = now
        }
        try context.save()
        return orphans.count
    }
}
