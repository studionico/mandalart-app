import Foundation
import SwiftData
import Supabase

/// Push / pull sync between SwiftData and Supabase, mirroring desktop's `lib/sync/{pull,push}.ts`.
/// Last-write-wins via `updatedAt` comparison. Folders / mandalarts / grids / cells in that order
/// (matches desktop ordering: parents first to avoid orphan rows during partial pulls).
@MainActor
final class SyncEngine {
    static let shared = SyncEngine()

    private let client = SupabaseService.shared.client
    private let dateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var isSyncing = false

    // MARK: - Pull

    @discardableResult
    func pullAll(into context: ModelContext) async throws -> (folders: Int, mandalarts: Int, grids: Int, cells: Int) {
        isSyncing = true
        defer { isSyncing = false }

        async let foldersTask: [CloudFolder] = client.from("folders")
            .select("id, name, sort_order, is_system, created_at, updated_at, deleted_at")
            .execute().value
        async let mandalartsTask: [CloudMandalart] = client.from("mandalarts")
            .select("id, title, root_cell_id, show_checkbox, last_grid_id, sort_order, pinned, folder_id, locked, created_at, updated_at, deleted_at")
            .execute().value
        async let gridsTask: [CloudGrid] = client.from("grids")
            .select("id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at, deleted_at")
            .execute().value
        async let cellsTask: [CloudCell] = client.from("cells")
            .select("id, grid_id, position, text, image_path, color, done, created_at, updated_at, deleted_at")
            .execute().value

        let (folders, mandalarts, grids, cells) = try await (foldersTask, mandalartsTask, gridsTask, cellsTask)

        for f in folders { upsertFolder(f, in: context) }
        for m in mandalarts { upsertMandalart(m, in: context) }
        for g in grids { upsertGrid(g, in: context) }
        for c in cells { upsertCell(c, in: context) }

        try context.save()
        return (folders.count, mandalarts.count, grids.count, cells.count)
    }

    private func upsertFolder(_ f: CloudFolder, in context: ModelContext) {
        let id = f.id
        let cloudUpdated = parseDate(f.updated_at) ?? Date()
        let descriptor = FetchDescriptor<Folder>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            guard cloudUpdated > local.updatedAt else { return }
            local.name = f.name
            local.sortOrder = f.sort_order
            local.isSystem = f.is_system
            local.updatedAt = cloudUpdated
            local.deletedAt = parseDate(f.deleted_at)
            local.syncedAt = cloudUpdated
        } else {
            let folder = Folder(
                id: f.id, name: f.name, sortOrder: f.sort_order,
                isSystem: f.is_system,
                createdAt: parseDate(f.created_at) ?? Date(),
                updatedAt: cloudUpdated,
                deletedAt: parseDate(f.deleted_at),
                syncedAt: cloudUpdated
            )
            context.insert(folder)
        }
    }

    private func upsertMandalart(_ m: CloudMandalart, in context: ModelContext) {
        let id = m.id
        let cloudUpdated = parseDate(m.updated_at) ?? Date()
        let descriptor = FetchDescriptor<Mandalart>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            guard cloudUpdated > local.updatedAt else { return }
            local.title = m.title
            local.rootCellId = m.root_cell_id
            local.showCheckbox = m.show_checkbox
            local.lastGridId = m.last_grid_id
            local.sortOrder = m.sort_order
            local.pinned = m.pinned
            local.folderId = m.folder_id
            local.locked = m.locked
            local.updatedAt = cloudUpdated
            local.deletedAt = parseDate(m.deleted_at)
            local.syncedAt = cloudUpdated
        } else {
            let mandalart = Mandalart(
                id: m.id, title: m.title, rootCellId: m.root_cell_id,
                showCheckbox: m.show_checkbox, lastGridId: m.last_grid_id,
                sortOrder: m.sort_order, pinned: m.pinned,
                folderId: m.folder_id, locked: m.locked,
                createdAt: parseDate(m.created_at) ?? Date(),
                updatedAt: cloudUpdated,
                deletedAt: parseDate(m.deleted_at),
                syncedAt: cloudUpdated
            )
            context.insert(mandalart)
        }
    }

    private func upsertGrid(_ g: CloudGrid, in context: ModelContext) {
        let id = g.id
        let cloudUpdated = parseDate(g.updated_at) ?? Date()
        let descriptor = FetchDescriptor<Grid>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            guard cloudUpdated > local.updatedAt else { return }
            local.mandalartId = g.mandalart_id
            local.centerCellId = g.center_cell_id
            local.parentCellId = g.parent_cell_id
            local.sortOrder = g.sort_order
            local.memo = g.memo
            local.updatedAt = cloudUpdated
            local.deletedAt = parseDate(g.deleted_at)
            local.syncedAt = cloudUpdated
        } else {
            let grid = Grid(
                id: g.id, mandalartId: g.mandalart_id,
                centerCellId: g.center_cell_id, parentCellId: g.parent_cell_id,
                sortOrder: g.sort_order, memo: g.memo,
                createdAt: parseDate(g.created_at) ?? Date(),
                updatedAt: cloudUpdated,
                deletedAt: parseDate(g.deleted_at),
                syncedAt: cloudUpdated
            )
            context.insert(grid)
        }
    }

    private func upsertCell(_ c: CloudCell, in context: ModelContext) {
        let id = c.id
        let cloudUpdated = parseDate(c.updated_at) ?? Date()
        let descriptor = FetchDescriptor<Cell>(predicate: #Predicate { $0.id == id })
        if let local = try? context.fetch(descriptor).first {
            guard cloudUpdated > local.updatedAt else { return }
            local.gridId = c.grid_id
            local.position = c.position
            local.text = c.text
            local.imagePath = c.image_path
            local.color = c.color
            local.done = c.done
            local.updatedAt = cloudUpdated
            local.deletedAt = parseDate(c.deleted_at)
            local.syncedAt = cloudUpdated
        } else {
            let cell = Cell(
                id: c.id, gridId: c.grid_id, position: c.position,
                text: c.text, color: c.color, imagePath: c.image_path,
                done: c.done,
                createdAt: parseDate(c.created_at) ?? Date(),
                updatedAt: cloudUpdated,
                deletedAt: parseDate(c.deleted_at),
                syncedAt: cloudUpdated
            )
            context.insert(cell)
        }
    }

    // MARK: - Push

    @discardableResult
    func pushPending(from context: ModelContext) async throws -> (folders: Int, mandalarts: Int, grids: Int, cells: Int) {
        guard let session = try? await client.auth.session else {
            throw SyncError.notSignedIn
        }
        let userId = session.user.id.uuidString

        let folderRows: [Folder] = (try? context.fetch(FetchDescriptor<Folder>())) ?? []
        let mandalartRows: [Mandalart] = (try? context.fetch(FetchDescriptor<Mandalart>())) ?? []
        let gridRows: [Grid] = (try? context.fetch(FetchDescriptor<Grid>())) ?? []
        let cellRows: [Cell] = (try? context.fetch(FetchDescriptor<Cell>())) ?? []

        let pendingFolders = folderRows.filter { needsPush($0.syncedAt, $0.updatedAt) }
        let pendingMandalarts = mandalartRows.filter { needsPush($0.syncedAt, $0.updatedAt) }
        let pendingGrids = gridRows.filter { needsPush($0.syncedAt, $0.updatedAt) }
        let pendingCells = cellRows.filter { needsPush($0.syncedAt, $0.updatedAt) }

        if !pendingFolders.isEmpty {
            try await client.from("folders").upsert(pendingFolders.map { folderPayload($0, userId: userId) }).execute()
            for f in pendingFolders { f.syncedAt = f.updatedAt }
        }
        if !pendingMandalarts.isEmpty {
            try await client.from("mandalarts").upsert(pendingMandalarts.map { mandalartPayload($0, userId: userId) }).execute()
            for m in pendingMandalarts { m.syncedAt = m.updatedAt }
        }
        if !pendingGrids.isEmpty {
            try await client.from("grids").upsert(pendingGrids.map(gridPayload)).execute()
            for g in pendingGrids { g.syncedAt = g.updatedAt }
        }
        if !pendingCells.isEmpty {
            try await client.from("cells").upsert(pendingCells.map(cellPayload)).execute()
            for c in pendingCells { c.syncedAt = c.updatedAt }
        }
        try context.save()

        return (pendingFolders.count, pendingMandalarts.count, pendingGrids.count, pendingCells.count)
    }

    enum SyncError: LocalizedError {
        case notSignedIn
        var errorDescription: String? {
            switch self {
            case .notSignedIn: return "サインインが必要です。"
            }
        }
    }

    private func needsPush(_ syncedAt: Date?, _ updatedAt: Date) -> Bool {
        guard let s = syncedAt else { return true }
        return s < updatedAt
    }

    // MARK: - Helpers

    private func parseDate(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return dateFormatter.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    private func formatDate(_ d: Date) -> String {
        dateFormatter.string(from: d)
    }

    private func formatDateOptional(_ d: Date?) -> String? {
        guard let d else { return nil }
        return dateFormatter.string(from: d)
    }
}

// MARK: - DTOs (snake_case to match Postgres)

struct CloudFolder: Codable {
    let id: String
    let name: String
    let sort_order: Int
    let is_system: Bool
    let created_at: String
    let updated_at: String
    let deleted_at: String?
}

struct CloudMandalart: Codable {
    let id: String
    let title: String
    let root_cell_id: String
    let show_checkbox: Bool
    let last_grid_id: String?
    let sort_order: Int?
    let pinned: Bool
    let folder_id: String?
    let locked: Bool
    let created_at: String
    let updated_at: String
    let deleted_at: String?
}

struct CloudGrid: Codable {
    let id: String
    let mandalart_id: String
    let center_cell_id: String
    let parent_cell_id: String?
    let sort_order: Int
    let memo: String?
    let created_at: String
    let updated_at: String
    let deleted_at: String?
}

struct CloudCell: Codable {
    let id: String
    let grid_id: String
    let position: Int
    let text: String
    let image_path: String?
    let color: String?
    let done: Bool
    let created_at: String
    let updated_at: String
    let deleted_at: String?
}

// MARK: - Push payload builders

private extension SyncEngine {
    func folderPayload(_ f: Folder, userId: String) -> [String: AnyJSON] {
        [
            "id": .string(f.id),
            "user_id": .string(userId),
            "name": .string(f.name),
            "sort_order": .integer(f.sortOrder),
            "is_system": .bool(f.isSystem),
            "created_at": .string(formatDate(f.createdAt)),
            "updated_at": .string(formatDate(f.updatedAt)),
            "deleted_at": f.deletedAt.map { .string(formatDate($0)) } ?? .null,
        ]
    }
    func mandalartPayload(_ m: Mandalart, userId: String) -> [String: AnyJSON] {
        [
            "id": .string(m.id),
            "user_id": .string(userId),
            "title": .string(m.title),
            "root_cell_id": .string(m.rootCellId),
            "show_checkbox": .bool(m.showCheckbox),
            "last_grid_id": m.lastGridId.map { .string($0) } ?? .null,
            "sort_order": m.sortOrder.map { .integer($0) } ?? .null,
            "pinned": .bool(m.pinned),
            "folder_id": m.folderId.map { .string($0) } ?? .null,
            "locked": .bool(m.locked),
            "created_at": .string(formatDate(m.createdAt)),
            "updated_at": .string(formatDate(m.updatedAt)),
            "deleted_at": m.deletedAt.map { .string(formatDate($0)) } ?? .null,
        ]
    }
    func gridPayload(_ g: Grid) -> [String: AnyJSON] {
        [
            "id": .string(g.id),
            "mandalart_id": .string(g.mandalartId),
            "center_cell_id": .string(g.centerCellId),
            "parent_cell_id": g.parentCellId.map { .string($0) } ?? .null,
            "sort_order": .integer(g.sortOrder),
            "memo": g.memo.map { .string($0) } ?? .null,
            "created_at": .string(formatDate(g.createdAt)),
            "updated_at": .string(formatDate(g.updatedAt)),
            "deleted_at": g.deletedAt.map { .string(formatDate($0)) } ?? .null,
        ]
    }
    func cellPayload(_ c: Cell) -> [String: AnyJSON] {
        [
            "id": .string(c.id),
            "grid_id": .string(c.gridId),
            "position": .integer(c.position),
            "text": .string(c.text),
            "image_path": c.imagePath.map { .string($0) } ?? .null,
            "color": c.color.map { .string($0) } ?? .null,
            "done": .bool(c.done),
            "created_at": .string(formatDate(c.createdAt)),
            "updated_at": .string(formatDate(c.updatedAt)),
            "deleted_at": c.deletedAt.map { .string(formatDate($0)) } ?? .null,
        ]
    }
}
