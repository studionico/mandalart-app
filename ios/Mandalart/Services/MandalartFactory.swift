import Foundation
import SwiftData

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

    /// Permanent delete: cascade grids + cells, then mandalart row.
    static func permanentDelete(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) throws {
        let mandalartId = mandalart.id
        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate { $0.mandalartId == mandalartId }
        )
        let grids = try context.fetch(gridFetch)
        let gridIds = Set(grids.map { $0.id })
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate { gridIds.contains($0.gridId) }
        )
        let cells = try context.fetch(cellFetch)
        for cell in cells { context.delete(cell) }
        for grid in grids { context.delete(grid) }
        context.delete(mandalart)
        try context.save()
    }
}
