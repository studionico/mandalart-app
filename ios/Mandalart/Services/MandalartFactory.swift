import Foundation
import SwiftData
import Supabase

@MainActor
enum MandalartFactory {
    /// Create a new mandalart with its root grid + center cell.
    /// Mirrors desktop's lib/api/mandalarts.ts:createMandalart.
    ///
    /// **folderId**: 引数省略時は `FolderRepository.ensureInboxFolder` で取得した Inbox folder の id を
    /// セットする。これがないと desktop の Dashboard 側 folder filter (`m.folder_id = ?`) でヒットせず
    /// 一見見えなくなる (= desktop 側 `adoptOrphanMandalartsToInbox` の保険に依存) ので、iOS 側でも
    /// 必ず folderId を埋める。
    @discardableResult
    static func create(
        title: String,
        folderId: String? = nil,
        in context: ModelContext
    ) throws -> Mandalart {
        let resolvedFolderId: String
        if let folderId {
            resolvedFolderId = folderId
        } else {
            resolvedFolderId = try FolderRepository.ensureInboxFolder(in: context).id
        }

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
            lastGridId: nil,
            folderId: resolvedFolderId
        )

        context.insert(rootGrid)
        context.insert(rootCenterCell)
        context.insert(mandalart)
        try context.save()
        return mandalart
    }

    /// マンダラートを複製する。源 mandalart の全 grids / cells を新 id で複製し、
    /// 新 mandalart に紐付ける。lazy cell creation 維持 (空セルはコピーしない、ただし
    /// `center_cell_id` として参照される cell は整合性のため空でもコピー)。
    ///
    /// 継承する: title / showCheckbox / folderId / locked / 全 grids / cells 構造
    /// 継承しない: lastGridId (= nil で root から開始)、sortOrder (nil)、pinned (false)
    @discardableResult
    static func duplicate(
        _ source: Mandalart,
        in context: ModelContext
    ) throws -> Mandalart {
        let sourceId = source.id
        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.mandalartId == sourceId && $0.deletedAt == nil }
        )
        let sourceGrids = try context.fetch(gridFetch)
        let gridIdsSet = Set(sourceGrids.map { $0.id })
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { gridIdsSet.contains($0.gridId) && $0.deletedAt == nil }
        )
        let sourceCells = try context.fetch(cellFetch)

        // id 写像
        var cellIdMap: [String: String] = [:]
        for c in sourceCells { cellIdMap[c.id] = IDGenerator.uuid() }
        var gridIdMap: [String: String] = [:]
        for g in sourceGrids { gridIdMap[g.id] = IDGenerator.uuid() }

        let newMandalartId = IDGenerator.uuid()
        guard let newRootCellId = cellIdMap[source.rootCellId] else {
            throw NSError(domain: "MandalartFactory", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "root cell が source cells に見つかりません: \(source.rootCellId)"
            ])
        }

        let now = Date()

        // 1. 新 mandalart を先に insert (FK 順序維持の意図)
        let newMandalart = Mandalart(
            id: newMandalartId,
            title: source.title,
            rootCellId: newRootCellId,
            showCheckbox: source.showCheckbox,
            lastGridId: nil,
            sortOrder: nil,
            pinned: false,
            folderId: source.folderId,
            locked: source.locked,
            createdAt: now,
            updatedAt: now
        )
        context.insert(newMandalart)

        // 2. 新 grids
        var newCenterCellIds = Set<String>()
        for g in sourceGrids {
            guard let newGridId = gridIdMap[g.id] else { continue }
            guard let newCenterCellId = cellIdMap[g.centerCellId] else {
                throw NSError(domain: "MandalartFactory", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "grid \(g.id) の center_cell_id \(g.centerCellId) が孤立"
                ])
            }
            let newParentCellId = g.parentCellId.flatMap { cellIdMap[$0] }
            let newGrid = Grid(
                id: newGridId,
                mandalartId: newMandalartId,
                centerCellId: newCenterCellId,
                parentCellId: newParentCellId,
                sortOrder: g.sortOrder,
                memo: g.memo,
                createdAt: now,
                updatedAt: now
            )
            context.insert(newGrid)
            newCenterCellIds.insert(newCenterCellId)
        }

        // 3. 新 cells (lazy: 空セルはコピーしない、ただし center_cell_id 参照されているものは整合性で残す)
        for c in sourceCells {
            guard let newCellId = cellIdMap[c.id], let newGridId = gridIdMap[c.gridId] else { continue }
            let isPopulated = !c.text.isEmpty || c.imagePath != nil || c.color != nil
            let isReferenced = newCenterCellIds.contains(newCellId)
            if !isPopulated && !isReferenced { continue }
            let newCell = Cell(
                id: newCellId,
                gridId: newGridId,
                position: c.position,
                text: c.text,
                color: c.color,
                imagePath: c.imagePath,
                done: c.done,
                createdAt: now,
                updatedAt: now
            )
            context.insert(newCell)
        }

        try context.save()
        return newMandalart
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
