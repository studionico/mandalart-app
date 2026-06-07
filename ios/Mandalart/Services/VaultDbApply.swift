import Foundation
import SwiftData

/// file→DB 適用 (**実 SwiftData 書込み**)。vault を正として DB キャッシュを再構築する。
/// desktop [`applyToDb.ts`](../../../desktop/src/lib/vault/applyToDb.ts) の Swift 移植。
///
/// - upsert は id で insert/update 分岐 (`syncedAt` は触らず cloud 状態温存、`deletedAt = nil` で復活)。
/// - folder は folder_name で ensure (vault は folder_id を持たない)。
/// - 適用した各マンダラート内で vault に無い grid/cell は削除。`skipGridDeletionFor` の id は削除をスキップ
///   (= grid .md の parse 失敗があったマンダラート。破損ファイルでの誤削除=データ損失を防ぐ)。
/// - `deleteMissingMandalarts` (既定 false) のときだけ vault に無いマンダラート全体を削除。
///
/// SwiftData 依存のため Vault/ ではなく Services/ に置く (Vault/ ピュア層は @Model 非含有の不変条件)。
/// `reconcileVaultToDb` (起動 rebuild / フォアグラウンド復帰 / 設定再構築) から呼ばれ、vault を正として
/// 本文編集 (本文ラウンドトリップ Stage ③、`applyBody: true` 経由) を含めて DB を再構築する。vault は DEBUG 限定機能。

struct VaultApplyOptions {
    var deleteMissingMandalarts: Bool = false
    /// この mandalart id 群は intra-mandalart の grid/cell 削除をスキップ (parse 失敗時の保護)。
    var skipGridDeletionFor: Set<String> = []
}

struct VaultApplyReport: Equatable {
    var mandalarts = 0
    var grids = 0
    var cells = 0
    var deletedMandalarts = 0
}

@MainActor
enum VaultDbApply {

    /// vault 由来の行群を DB に適用する (実 DB 書込み + save)。
    @discardableResult
    static func applyVaultRowsToDb(
        _ all: [MandalartRows],
        in context: ModelContext,
        options: VaultApplyOptions = .init()
    ) -> VaultApplyReport {
        var report = VaultApplyReport()
        let vaultMandalartIds = Set(all.map { $0.mandalart.id })

        for rows in all {
            let folderId = ensureFolderByName(rows.folderName, in: context)
            upsertMandalart(rows.mandalart, folderId: folderId, in: context)
            report.mandalarts += 1

            let vaultGridIds = Set(rows.grids.map { $0.id })
            for grid in rows.grids {
                upsertGrid(grid, in: context)
                report.grids += 1
            }
            let vaultCellIds = Set(rows.cells.map { $0.id })
            for cell in rows.cells {
                upsertCell(cell, in: context)
                report.cells += 1
            }

            // parse 失敗があったマンダラートは削除をスキップ (破損ファイルでの誤削除を防ぐ)。
            if !options.skipGridDeletionFor.contains(rows.mandalart.id) {
                // grid の centerCellId / parentCellId に参照されるセルは削除しない (構造の要)。
                // 本文ラウンドトリップでの削除 (mergeBody) が子持ち親セルの見出しを消したケースでも、
                // 子グリッドの参照先を消して孤児化させないための防御ガード (整合した vault では no-op)。
                var referencedCellIds = Set<String>()
                for g in rows.grids {
                    referencedCellIds.insert(g.centerCellId)
                    if let parent = g.parentCellId { referencedCellIds.insert(parent) }
                }
                deleteMissingGridsAndCells(
                    mandalartId: rows.mandalart.id,
                    vaultGridIds: vaultGridIds,
                    vaultCellIds: vaultCellIds,
                    referencedCellIds: referencedCellIds,
                    in: context
                )
            }
        }

        if options.deleteMissingMandalarts {
            report.deletedMandalarts = deleteMandalartsNotIn(vaultMandalartIds, in: context)
        }

        try? context.save()
        return report
    }

    // MARK: - folder ensure

    private static func ensureFolderByName(_ name: String, in context: ModelContext) -> String {
        let descriptor = FetchDescriptor<Folder>(
            predicate: #Predicate<Folder> { $0.name == name && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\Folder.createdAt)]
        )
        if let existing = try? context.fetch(descriptor).first {
            return existing.id
        }
        let activeFolders = (try? context.fetch(
            FetchDescriptor<Folder>(predicate: #Predicate<Folder> { $0.deletedAt == nil })
        )) ?? []
        let maxSort = activeFolders.map(\.sortOrder).max() ?? -1
        let folder = Folder(id: IDGenerator.uuid(), name: name, sortOrder: maxSort + 1, isSystem: false)
        context.insert(folder)
        return folder.id
    }

    // MARK: - upsert (id で insert/update 分岐)

    private static func upsertMandalart(_ m: VaultMandalart, folderId: String, in context: ModelContext) {
        let id = m.id
        let created = VaultTimestamp.parse(m.createdAt) ?? Date()
        let updated = VaultTimestamp.parse(m.updatedAt) ?? Date()
        let descriptor = FetchDescriptor<Mandalart>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            local.title = m.title
            local.rootCellId = m.rootCellId
            local.folderId = folderId
            local.showCheckbox = m.showCheckbox
            local.lastGridId = m.lastGridId
            local.sortOrder = m.sortOrder
            local.pinned = m.pinned
            local.locked = m.locked
            local.createdAt = created
            local.updatedAt = updated
            local.deletedAt = nil // soft-delete 復活。syncedAt は触らない (cloud 状態温存)
        } else {
            context.insert(Mandalart(
                id: m.id, title: m.title, rootCellId: m.rootCellId, imagePath: nil,
                showCheckbox: m.showCheckbox, lastGridId: m.lastGridId, sortOrder: m.sortOrder,
                pinned: m.pinned, folderId: folderId, locked: m.locked,
                createdAt: created, updatedAt: updated, deletedAt: nil, syncedAt: nil
            ))
        }
    }

    private static func upsertGrid(_ g: VaultGrid, in context: ModelContext) {
        let id = g.id
        let created = VaultTimestamp.parse(g.createdAt) ?? Date()
        let updated = VaultTimestamp.parse(g.updatedAt) ?? Date()
        let descriptor = FetchDescriptor<Grid>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            local.mandalartId = g.mandalartId
            local.centerCellId = g.centerCellId
            local.parentCellId = g.parentCellId
            local.sortOrder = g.sortOrder
            local.memo = g.memo
            local.createdAt = created
            local.updatedAt = updated
            local.deletedAt = nil
        } else {
            context.insert(Grid(
                id: g.id, mandalartId: g.mandalartId, centerCellId: g.centerCellId,
                parentCellId: g.parentCellId, sortOrder: g.sortOrder, memo: g.memo,
                createdAt: created, updatedAt: updated, deletedAt: nil, syncedAt: nil
            ))
        }
    }

    private static func upsertCell(_ c: VaultCell, in context: ModelContext) {
        let id = c.id
        let created = VaultTimestamp.parse(c.createdAt) ?? Date()
        let updated = VaultTimestamp.parse(c.updatedAt) ?? Date()
        let descriptor = FetchDescriptor<Cell>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            local.gridId = c.gridId
            local.position = c.position
            local.text = c.text
            local.imagePath = c.imagePath
            local.color = c.color
            local.done = c.done
            local.createdAt = created
            local.updatedAt = updated
            local.deletedAt = nil
        } else {
            context.insert(Cell(
                id: c.id, gridId: c.gridId, position: c.position, text: c.text,
                color: c.color, imagePath: c.imagePath, done: c.done,
                createdAt: created, updatedAt: updated, deletedAt: nil, syncedAt: nil
            ))
        }
    }

    // MARK: - 削除

    /// vault に無い grid (とその cells) を hard delete し、残った grid 内で vault に無い cell を削除。
    /// ただし `referencedCellIds` (grid の centerCellId / parentCellId に参照されるセル) は削除しない孤児ガード。
    private static func deleteMissingGridsAndCells(
        mandalartId: String,
        vaultGridIds: Set<String>,
        vaultCellIds: Set<String>,
        referencedCellIds: Set<String>,
        in context: ModelContext
    ) {
        let gridDescriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.mandalartId == mandalartId && $0.deletedAt == nil }
        )
        let dbGrids = (try? context.fetch(gridDescriptor)) ?? []
        var survivingGridIds: [String] = []
        for grid in dbGrids {
            if vaultGridIds.contains(grid.id) {
                survivingGridIds.append(grid.id)
            } else {
                deleteCells(ofGrid: grid.id, in: context) { _ in true }
                context.delete(grid)
            }
        }
        for gid in survivingGridIds {
            deleteCells(ofGrid: gid, in: context) { !vaultCellIds.contains($0) && !referencedCellIds.contains($0) }
        }
    }

    private static func deleteCells(ofGrid gid: String, in context: ModelContext, where predicate: (String) -> Bool) {
        let cellDescriptor = FetchDescriptor<Cell>(predicate: #Predicate<Cell> { $0.gridId == gid })
        for cell in (try? context.fetch(cellDescriptor)) ?? [] where predicate(cell.id) {
            context.delete(cell)
        }
    }

    /// vault に無いマンダラート全体 (grids/cells 含む) を hard delete し、削除数を返す。
    private static func deleteMandalartsNotIn(_ keep: Set<String>, in context: ModelContext) -> Int {
        let descriptor = FetchDescriptor<Mandalart>(predicate: #Predicate<Mandalart> { $0.deletedAt == nil })
        let dbMandalarts = (try? context.fetch(descriptor)) ?? []
        var deleted = 0
        for mandalart in dbMandalarts where !keep.contains(mandalart.id) {
            let mid = mandalart.id
            let gridDescriptor = FetchDescriptor<Grid>(predicate: #Predicate<Grid> { $0.mandalartId == mid })
            for grid in (try? context.fetch(gridDescriptor)) ?? [] {
                deleteCells(ofGrid: grid.id, in: context) { _ in true }
                context.delete(grid)
            }
            context.delete(mandalart)
            deleted += 1
        }
        return deleted
    }
}
