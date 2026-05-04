import Foundation
import SwiftData
import Supabase

@MainActor
enum MandalartFactory {
    /// Create a new mandalart with its root grid + center cell.
    /// Mirrors desktop's lib/api/mandalarts.ts:createMandalart.
    @discardableResult
    static func create(
        title: String,
        in context: ModelContext
    ) throws -> Mandalart {
        let rootCellId = IDGenerator.uuid()
        let rootGridId = IDGenerator.uuid()
        let mandalartId = IDGenerator.uuid()

        let rootGrid = Grid(
            id: rootGridId,
            mandalartId: mandalartId,
            centerCellId: rootCellId,
            parentCellId: nil
        )
        let rootCenterCell = Cell(
            id: rootCellId,
            gridId: rootGridId,
            position: GridConstants.centerPosition,
            text: title
        )
        // lastGridId は nil で作成 (desktop の createMandalart と挙動を揃える)。
        // root grid を非 nil で持っていると `getGridAncestry` が "drilled state" と誤認する経路がある。
        let mandalart = Mandalart(
            id: mandalartId,
            title: title,
            rootCellId: rootCellId,
            lastGridId: nil
        )

        context.insert(rootGrid)
        context.insert(rootCenterCell)
        context.insert(mandalart)
        try context.save()
        return mandalart
    }

    /// Permanent delete: cascade local + cloud。
    ///
    /// 削除順序 (desktop の `permanentDeleteMandalart` と同等):
    /// 1. ローカル: cells → grids → mandalart の順で SwiftData から物理削除
    /// 2. クラウド (best-effort, 未サインイン or 失敗時はスキップして warn のみ):
    ///    `cells WHERE grid_id IN (...)` → `grids WHERE mandalart_id = ?` → `mandalarts WHERE id = ?`
    ///
    /// **クラウド側を残すと再 pull で zombie 復活する** (落とし穴 #6) ため、サインイン中は必ず cloud delete も試みる。
    /// 失敗した場合 (オフライン / RLS 403 等) は warn ログのみで継続。次回ユーザー操作で再同期されたとき
    /// realtime 経由で他デバイスに DELETE が伝播する想定。
    static func permanentDelete(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) async throws {
        let mandalartId = mandalart.id

        // 1. クラウド削除用に grid id を先に集める (local delete 後だと参照できない)
        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.mandalartId == mandalartId }
        )
        let grids = try context.fetch(gridFetch)
        let gridIds = grids.map { $0.id }
        let gridIdSet = Set(gridIds)
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { gridIdSet.contains($0.gridId) }
        )
        let cells = try context.fetch(cellFetch)

        // 2. ローカル物理削除 (cells → grids → mandalart の順)
        for cell in cells { context.delete(cell) }
        for grid in grids { context.delete(grid) }
        context.delete(mandalart)
        try context.save()

        // 3. クラウド削除を試みる。失敗 (未サインイン / オフライン / RLS 等) したら
        //    tombstone に積んで次回 pullAll 冒頭でリトライさせる (落とし穴 #6: zombie 復活防止)。
        let client = SupabaseService.shared.client
        guard (try? await client.auth.session) != nil else {
            CloudDeleteTombstone.add(mandalartId)
            return
        }
        do {
            try await deleteFromCloud(mandalartId: mandalartId, gridIds: gridIds, client: client)
        } catch {
            print("[permanentDelete] cloud delete failed → tombstone:", error)
            CloudDeleteTombstone.add(mandalartId)
        }
    }

    /// 指定 mandalart の cloud cascade delete (cells → grids → mandalart の順)。
    /// `gridIds` が空でも grids / mandalarts は削除を試みる (= 並列 / 子なし mandalart 対応)。
    static func deleteFromCloud(
        mandalartId: String,
        gridIds: [String],
        client: SupabaseClient = SupabaseService.shared.client
    ) async throws {
        if !gridIds.isEmpty {
            try await client.from("cells")
                .delete()
                .in("grid_id", values: gridIds)
                .execute()
        }
        try await client.from("grids")
            .delete()
            .eq("mandalart_id", value: mandalartId)
            .execute()
        try await client.from("mandalarts")
            .delete()
            .eq("id", value: mandalartId)
            .execute()
    }
}
