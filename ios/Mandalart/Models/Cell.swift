import Foundation
import SwiftData

@Model
final class Cell {
    @Attribute(.unique) var id: String
    var gridId: String
    var position: Int
    var text: String
    var color: String?
    var imagePath: String?
    var done: Bool
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?
    var syncedAt: Date?

    init(
        id: String = IDGenerator.uuid(),
        gridId: String,
        position: Int,
        text: String = "",
        color: String? = nil,
        imagePath: String? = nil,
        done: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        deletedAt: Date? = nil,
        syncedAt: Date? = nil
    ) {
        self.id = id
        self.gridId = gridId
        self.position = position
        self.text = text
        self.color = color
        self.imagePath = imagePath
        self.done = done
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.syncedAt = syncedAt
    }
}
