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
        let rootCellId = UUID().uuidString
        let rootGridId = UUID().uuidString
        let mandalartId = UUID().uuidString

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
        let mandalart = Mandalart(
            id: mandalartId,
            title: title,
            rootCellId: rootCellId,
            lastGridId: rootGridId
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
