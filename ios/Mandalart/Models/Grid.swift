import Foundation
import SwiftData

@Model
final class Grid {
    @Attribute(.unique) var id: String
    var mandalartId: String
    var centerCellId: String
    var parentCellId: String?
    var sortOrder: Int
    var memo: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?
    var syncedAt: Date?

    init(
        id: String = UUID().uuidString,
        mandalartId: String,
        centerCellId: String,
        parentCellId: String? = nil,
        sortOrder: Int = 0,
        memo: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        deletedAt: Date? = nil,
        syncedAt: Date? = nil
    ) {
        self.id = id
        self.mandalartId = mandalartId
        self.centerCellId = centerCellId
        self.parentCellId = parentCellId
        self.sortOrder = sortOrder
        self.memo = memo
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.syncedAt = syncedAt
    }
}
