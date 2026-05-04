import Foundation
import SwiftData

@Model
final class Mandalart {
    @Attribute(.unique) var id: String
    var title: String
    var rootCellId: String
    var imagePath: String?
    var showCheckbox: Bool
    var lastGridId: String?
    var sortOrder: Int?
    var pinned: Bool
    var folderId: String?
    var locked: Bool
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?
    var syncedAt: Date?

    init(
        id: String = UUID().uuidString,
        title: String,
        rootCellId: String,
        imagePath: String? = nil,
        showCheckbox: Bool = false,
        lastGridId: String? = nil,
        sortOrder: Int? = nil,
        pinned: Bool = false,
        folderId: String? = nil,
        locked: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        deletedAt: Date? = nil,
        syncedAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.rootCellId = rootCellId
        self.imagePath = imagePath
        self.showCheckbox = showCheckbox
        self.lastGridId = lastGridId
        self.sortOrder = sortOrder
        self.pinned = pinned
        self.folderId = folderId
        self.locked = locked
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.syncedAt = syncedAt
    }
}
