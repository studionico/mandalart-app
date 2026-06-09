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

    // MARK: - Sanitize / Tombstone

    /// 参照整合性サニタイズ: 親が local SwiftData に存在しない行を hard delete する (落とし穴 #12)。
    ///
    /// **背景**: 過去のバグ (削除時に子が残った / 部分 sync で分裂 / クラッシュ中断) で
    /// `mandalart_id` が孤立した grids、`grid_id` が孤立した cells が残ることがある。
    /// これらが `synced_at == nil` (= cloud には未登録) のまま push されると RLS 403 で失敗 →
    /// 毎回 push のたびに同じ失敗が連鎖して全体パフォーマンスが劣化する (= push thrash)。
    ///
    /// pullAll 冒頭で実行することで cloud fetch 前に local をクリーンに保ち、
    /// 続く push 経路で thrash が発生しないようにする。
    private func sanitizeZombies(in context: ModelContext) {
        guard let mandalarts = try? context.fetch(FetchDescriptor<Mandalart>()) else { return }
        let mandalartIds = Set(mandalarts.map { $0.id })

        // 1. 親 mandalart が消えた zombie grid を hard delete
        if let grids = try? context.fetch(FetchDescriptor<Grid>()) {
            var zombieGridCount = 0
            for grid in grids where !mandalartIds.contains(grid.mandalartId) {
                context.delete(grid)
                zombieGridCount += 1
            }
            if zombieGridCount > 0 {
                print("[sync] sanitized zombie grids: \(zombieGridCount)")
            }
        }

        // 2. 残った grid id 集合に対して、孤立した cell を hard delete
        if let remainingGrids = try? context.fetch(FetchDescriptor<Grid>()) {
            let gridIds = Set(remainingGrids.map { $0.id })
            if let cells = try? context.fetch(FetchDescriptor<Cell>()) {
                var zombieCellCount = 0
                for cell in cells where !gridIds.contains(cell.gridId) {
                    context.delete(cell)
                    zombieCellCount += 1
                }
                if zombieCellCount > 0 {
                    print("[sync] sanitized zombie cells: \(zombieCellCount)")
                }
            }
        }

        try? context.save()
    }

    /// 同一 `(gridId, position)` を持つ複数 Cell を `updatedAt` 最新 1 行に集約し、他を hard delete する。
    ///
    /// **背景**: cloud cells テーブルは `UNIQUE(grid_id, position)` を持ち、desktop は local SQLite にも
    /// 同制約があるため重複が物理的に作れない。一方 **SwiftData は複合 unique を宣言できない** ため、
    /// pull の id-only 突合 (`upsertCell`) が「同 (gridId, position) に別 id」を新規 INSERT して
    /// local 重複を作ってしまう経路が過去に存在した。重複が残ったまま push すると、
    /// batch upsert の配列内に同 (grid_id, position) が複数入って Postgres 21000
    /// (ON CONFLICT DO UPDATE cannot affect row a second time) を誘発する。
    ///
    /// このメソッドは sanitizeZombies (親なし行削除) の **直後** に呼び、生き残った cell の重複を解消する。
    /// 残すのは `updatedAt` 最新 (同値なら syncedAt 済 = cloud 一致を優先 → id 安定ソート)。
    /// 負けた行の text / 画像は失われるが last-write-wins の本来挙動と一致するので許容する。
    private func dedupCellsByPosition(in context: ModelContext) {
        guard let cells = try? context.fetch(FetchDescriptor<Cell>()) else { return }
        var groups: [String: [Cell]] = [:]
        for c in cells {
            groups["\(c.gridId)#\(c.position)", default: []].append(c)
        }
        var removed = 0
        for (_, group) in groups where group.count > 1 {
            let survivor = group.max {
                ($0.updatedAt, $0.syncedAt ?? .distantPast, $0.id)
                    < ($1.updatedAt, $1.syncedAt ?? .distantPast, $1.id)
            }!
            for c in group where c.id != survivor.id {
                context.delete(c)
                removed += 1
            }
        }
        if removed > 0 {
            print("[sync] deduped cells by (gridId,position): \(removed)")
            try? context.save()
        }
    }

    /// `CloudDeleteTombstone` に積まれた mandalart id について cloud cascade delete を再試行する。
    /// 成功した id は tombstone から除去。失敗した id は残しておき、次回の pullAll でリトライ。
    /// サインインしていない場合は no-op (tombstone は維持)。
    private func drainCloudDeleteTombstones() async {
        let pending = CloudDeleteTombstone.current()
        guard !pending.isEmpty else { return }
        guard (try? await client.auth.session) != nil else { return }

        for mandalartId in pending {
            do {
                // cloud から該当 mandalart の grid id を引いて cascade delete
                let cloudGrids: [CloudGridIdOnly] = try await client.from("grids")
                    .select("id")
                    .eq("mandalart_id", value: mandalartId)
                    .execute().value
                let gridIds = cloudGrids.map { $0.id }
                try await MandalartFactory.deleteFromCloud(
                    mandalartId: mandalartId,
                    gridIds: gridIds,
                    client: client
                )
                CloudDeleteTombstone.remove(mandalartId)
            } catch {
                print("[sync] tombstone drain failed for \(mandalartId):", error)
                // tombstone 残置、次回リトライ
            }
        }
    }

    /// PostgREST のデフォルト max-rows。cloud fetch がこの件数ちょうどだと truncation
    /// (= cloud 行を取りこぼしている) の疑いがあるため、その種別の reconcile を skip する。
    private let postgrestRowLimit = 1000

    /// cloud に存在しない (= 他デバイスで hard delete された) ローカルの mandalart / grid を
    /// 配下ごと hard delete する。pull は upsert 専用で「cloud から消えた行」を検知できないため、
    /// 対向 desktop の `permanentDeleteMandalart` / `permanentDeleteGrid` (cloud DELETE) は
    /// ここで初めて iOS に伝播する。
    ///
    /// `syncedAt != nil` (= 過去に push 済) の行だけを対象にし、未 push の local-only 行
    /// (`syncedAt == nil`) は絶対に消さない。cell 単体の物理削除経路は無い (必ず grid/mandalart
    /// の cascade) ので reconcile 対象は mandalart + grid のみ。配下 cell は cascade で消す。
    private func reconcileRemoteDeletions(
        cloudMandalartIds: Set<String>,
        cloudGridIds: Set<String>,
        mandalartTruncated: Bool,
        gridTruncated: Bool,
        in context: ModelContext
    ) {
        var changed = false

        // 1. mandalart reconcile (+ 配下 grid/cell を即時 cascade)
        if !mandalartTruncated, let mandalarts = try? context.fetch(FetchDescriptor<Mandalart>()) {
            let toDelete = RemoteDeletionReconciler.idsToDelete(
                local: mandalarts.map { .init(id: $0.id, isSynced: $0.syncedAt != nil) },
                cloudIds: cloudMandalartIds,
                truncated: false
            )
            if !toDelete.isEmpty {
                for m in mandalarts where toDelete.contains(m.id) { context.delete(m) }
                if let grids = try? context.fetch(FetchDescriptor<Grid>()) {
                    let orphanGridIds = Set(
                        grids.filter { toDelete.contains($0.mandalartId) }.map { $0.id }
                    )
                    for g in grids where toDelete.contains(g.mandalartId) { context.delete(g) }
                    if let cells = try? context.fetch(FetchDescriptor<Cell>()) {
                        for c in cells where orphanGridIds.contains(c.gridId) { context.delete(c) }
                    }
                }
                changed = true
                print("[sync] reconciled remote-deleted mandalarts: \(toDelete.count)")
            }
        }

        // 2. grid reconcile (mandalart 健在で並列グリッド等だけ permanentDeleteGrid されたケース)
        if !gridTruncated, let grids = try? context.fetch(FetchDescriptor<Grid>()) {
            let toDelete = RemoteDeletionReconciler.idsToDelete(
                local: grids.map { .init(id: $0.id, isSynced: $0.syncedAt != nil) },
                cloudIds: cloudGridIds,
                truncated: false
            )
            if !toDelete.isEmpty {
                for g in grids where toDelete.contains(g.id) { context.delete(g) }
                if let cells = try? context.fetch(FetchDescriptor<Cell>()) {
                    for c in cells where toDelete.contains(c.gridId) { context.delete(c) }
                }
                changed = true
                print("[sync] reconciled remote-deleted grids: \(toDelete.count)")
            }
        }

        if changed { try? context.save() }
    }

    // MARK: - Pull

    @discardableResult
    func pullAll(into context: ModelContext) async throws -> (folders: Int, mandalarts: Int, grids: Int, cells: Int) {
        isSyncing = true
        defer { isSyncing = false }

        // 0a. 参照整合性サニタイズ: 親が消えた zombie grid / cell を hard delete (落とし穴 #12)
        sanitizeZombies(in: context)
        // 0a'. (gridId, position) 重複を解消 (SwiftData は複合 unique 不可、push 23505/21000 防止)
        dedupCellsByPosition(in: context)

        // 0b. tombstone drain: オフライン / 未サインイン中に permanent delete された
        //     マンダラートを cloud から cascade delete する。これがないと次の fetch で
        //     zombie 復活する (落とし穴 #6)。
        await drainCloudDeleteTombstones()

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

        // 他デバイスで hard delete された mandalart / grid をローカルからも消す
        // (upsert では cloud から消えた行を検知できないため、ここで reconcile する)。
        reconcileRemoteDeletions(
            cloudMandalartIds: Set(mandalarts.map { $0.id }),
            cloudGridIds: Set(grids.map { $0.id }),
            mandalartTruncated: mandalarts.count >= postgrestRowLimit,
            gridTruncated: grids.count >= postgrestRowLimit,
            in: context
        )

        // 他端末 (folder API 未対応の旧 iOS 等) から folder_id=null で push された
        // マンダラートを Inbox に振り分ける (desktop 側 adoptOrphanMandalartsToInbox 相当)。
        // Dashboard が folder filter を入れたとき (Phase 4) に必要。
        if let adopted = try? FolderRepository.adoptOrphansToInbox(in: context), adopted > 0 {
            print("[sync] adopted orphan mandalarts to Inbox: \(adopted)")
        }

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
            // id 一致なし = 新規候補。INSERT 前に同 (gridId, position) を持つ別 id の local を削除する
            // (= pull は cloud 勝ち、cloud の id 体系に local を寄せる)。SwiftData は複合 unique を
            // 宣言できないので、これをやらないと local に (gridId, position) 重複が生まれ、次の push で
            // 23505 / 21000 を再発させる。updatedAt 比較はここでは挟まない (挟むと同 position に 2 行
            // 残り得るため)。local の新しい編集は push 時の onConflict 経路で既に cloud に反映済の前提。
            let gid = c.grid_id
            let pos = c.position
            let posDesc = FetchDescriptor<Cell>(
                predicate: #Predicate { $0.gridId == gid && $0.position == pos }
            )
            if let conflicting = try? context.fetch(posDesc) {
                for old in conflicting { context.delete(old) }
            }
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

    // MARK: - Image backfill

    /// ローカル画像のうち Storage 未アップロード分を回収する (fullSync / 手動同期の後に呼ぶ、best-effort)。
    /// オフライン中に追加した画像を、オンライン復帰後にまとめて Storage へ上げる保険。
    @MainActor
    func backfillImages(from context: ModelContext) async {
        let cells: [Cell] = (try? context.fetch(FetchDescriptor<Cell>())) ?? []
        let paths = Array(Set(cells.compactMap { $0.imagePath }.filter { !$0.isEmpty }))
        await ImageStorage.backfillUpload(localImagePaths: paths)
    }

    // MARK: - Push

    @discardableResult
    func pushPending(from context: ModelContext) async throws -> (folders: Int, mandalarts: Int, grids: Int, cells: Int) {
        guard let session = try? await client.auth.session else {
            throw SyncError.notSignedIn
        }
        let userId = session.user.id.uuidString

        // pushPending を直接呼ぶ経路 (scene .background 等) でも参照整合性を保証する。
        // pullAll → push の流れで来る場合は冗長だが、save() のみで何もしない時は no-op。
        sanitizeZombies(in: context)
        // (gridId, position) 重複を解消してから push する (= pendingCells 内に同 (grid_id, position)
        // を入れない → batch upsert + onConflict での Postgres 21000 を防ぐ)。
        dedupCellsByPosition(in: context)

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
            // cells のみ onConflict を (grid_id, position) に指定する (desktop push.ts と対称)。
            // 複数デバイス / 歴史的な sync ズレで同じ (grid_id, position) に local と cloud で
            // 異なる cell id が並ぶケースがあり、PK (id) ベースの upsert だと INSERT 扱いになって
            // cloud の UNIQUE(grid_id, position) 制約に弾かれる (code 23505)。onConflict で一意制約
            // 側を指定すると「同じ (grid_id, position) の既存行を local 内容で UPDATE」= local 勝ち
            // になる。cells は leaf で他テーブルから id 参照されない (grids.center_cell_id は grid 単位
            // 1 行) ため cloud 側 id が変わっても整合性に影響なし。
            // batch upsert なので push 前に dedupCellsByPosition で local の (grid_id, position) 重複を
            // 解消しておく (= pendingCells 内に同 (grid_id, position) を入れない → Postgres 21000 回避)。
            try await client.from("cells")
                .upsert(pendingCells.map(cellPayload), onConflict: "grid_id,position")
                .execute()
            for c in pendingCells { c.syncedAt = c.updatedAt }
        }
        // 変更があるときだけ save する。pending 0 件 + zombie 変更なしの空 push で無条件 save すると
        // ModelContext.didSave が発火し、SyncDirtyTracker が再 push を arm して空 push がループする
        // (落とし穴 #24 復帰時の dirty-flag 駆動と組み合わせると顕在化)。挙動は等価で defensive。
        if context.hasChanges {
            try context.save()
        }

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

/// Tombstone drain で「mandalart に紐づく grid の id だけ」を取りたいときの軽量 DTO。
struct CloudGridIdOnly: Codable {
    let id: String
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
