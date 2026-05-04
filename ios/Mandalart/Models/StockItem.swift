import Foundation
import SwiftData

/// Local-only stock items (not synced to Supabase per desktop schema).
/// `snapshot` stores a JSON-serialized cell snapshot.
@Model
final class StockItem {
    @Attribute(.unique) var id: String
    var snapshot: String
    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        snapshot: String = "",
        createdAt: Date = Date()
    ) {
        self.id = id
        self.snapshot = snapshot
        self.createdAt = createdAt
    }
}
