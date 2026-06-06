import Foundation
import SwiftData

/// SwiftData `@Model` → vault のピュア行型 `[MandalartRows]` への **read-only** 変換ブリッジ。
/// desktop [`dbRows.ts`](../../../desktop/src/lib/vault/dbRows.ts) の read 側に対応。
///
/// `@Model` (Mandalart/Grid/Cell/Folder) を参照するため SwiftData 依存 = **Vault/ には置けない**
/// (Vault/ は test ターゲットにも直接コンパイルされ @Model を含まない不変条件)。よって app 限定の
/// Services/ に置く。タイムスタンプは [`VaultTimestamp`](../Vault/VaultTimestamp.swift) で
/// cloud/desktop と同形式の ISO8601 文字列に変換する。
@MainActor
enum VaultRowsBridge {

    /// 全マンダラート (deletedAt == nil) を MandalartRows 群に変換する。
    static func loadAllMandalartRows(in context: ModelContext) -> [MandalartRows] {
        let mandalarts = (try? context.fetch(FetchDescriptor<Mandalart>())) ?? []
        let grids = (try? context.fetch(FetchDescriptor<Grid>())) ?? []
        let cells = (try? context.fetch(FetchDescriptor<Cell>())) ?? []
        let folders = (try? context.fetch(FetchDescriptor<Folder>())) ?? []

        let folderNameById = Dictionary(folders.map { ($0.id, $0.name) }, uniquingKeysWith: { _, name in name })

        var gridsByMandalart: [String: [Grid]] = [:]
        for grid in grids where grid.deletedAt == nil {
            gridsByMandalart[grid.mandalartId, default: []].append(grid)
        }
        var cellsByGrid: [String: [Cell]] = [:]
        for cell in cells where cell.deletedAt == nil {
            cellsByGrid[cell.gridId, default: []].append(cell)
        }

        var result: [MandalartRows] = []
        for mandalart in mandalarts where mandalart.deletedAt == nil {
            let mGrids = gridsByMandalart[mandalart.id] ?? []
            let mCells = mGrids.flatMap { cellsByGrid[$0.id] ?? [] }
            let folderName = mandalart.folderId.flatMap { folderNameById[$0] } ?? "Inbox"
            result.append(MandalartRows(
                mandalart: toVaultMandalart(mandalart),
                folderName: folderName,
                grids: mGrids.map(toVaultGrid),
                cells: mCells.map(toVaultCell)
            ))
        }
        return result
    }

    // MARK: - @Model → struct mappers

    private static func toVaultMandalart(_ m: Mandalart) -> VaultMandalart {
        VaultMandalart(
            id: m.id,
            userId: "",
            title: m.title,
            rootCellId: m.rootCellId,
            showCheckbox: m.showCheckbox,
            lastGridId: m.lastGridId,
            sortOrder: m.sortOrder,
            pinned: m.pinned,
            folderId: m.folderId,
            locked: m.locked,
            createdAt: VaultTimestamp.format(m.createdAt),
            updatedAt: VaultTimestamp.format(m.updatedAt)
        )
    }

    private static func toVaultGrid(_ g: Grid) -> VaultGrid {
        VaultGrid(
            id: g.id,
            mandalartId: g.mandalartId,
            centerCellId: g.centerCellId,
            parentCellId: g.parentCellId,
            sortOrder: g.sortOrder,
            memo: g.memo,
            createdAt: VaultTimestamp.format(g.createdAt),
            updatedAt: VaultTimestamp.format(g.updatedAt)
        )
    }

    private static func toVaultCell(_ c: Cell) -> VaultCell {
        VaultCell(
            id: c.id,
            gridId: c.gridId,
            position: c.position,
            text: c.text,
            imagePath: c.imagePath,
            color: c.color,
            done: c.done,
            createdAt: VaultTimestamp.format(c.createdAt),
            updatedAt: VaultTimestamp.format(c.updatedAt)
        )
    }
}
