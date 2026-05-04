import Foundation
import SwiftData

@Model
final class Folder {
    @Attribute(.unique) var id: String
    var name: String
    var sortOrder: Int
    var isSystem: Bool
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?
    var syncedAt: Date?

    init(
        id: String = UUID().uuidString,
        name: String,
        sortOrder: Int = 0,
        isSystem: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        deletedAt: Date? = nil,
        syncedAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.sortOrder = sortOrder
        self.isSystem = isSystem
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.syncedAt = syncedAt
    }
}
