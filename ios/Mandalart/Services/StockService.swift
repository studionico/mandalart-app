import Foundation
import SwiftData

// MARK: - Snapshot 型 (desktop と完全に揃える)

/// セル + 配下 sub-grid 群の snapshot。
/// desktop の `CellSnapshot` ([`../../desktop/src/types/index.ts`](../../../desktop/src/types/index.ts)) と完全に揃える。
///
/// X=C 統一モデル: 子グリッドには position=4 の cell 行が無いため、`GridSnapshot.cells` は
/// peripherals (= 8 cells) のみを持つ。
///
/// - `position`: stock 元 cell の position (0..8)。中心セル (=4) なら grid 全体を `children` 1 件で保存
/// - `children`: この cell から drill した sub-grid 群 (= 並列含む)
struct CellSnapshot: Codable, Equatable {
    struct CellPayload: Codable, Equatable {
        var text: String
        var imagePath: String?
        var color: String?

        enum CodingKeys: String, CodingKey {
            case text
            case imagePath = "image_path"
            case color
        }
    }

    var cell: CellPayload
    var position: Int?
    var children: [GridSnapshot]
}

/// グリッド + 配下 sub-grid 群の snapshot。
/// desktop の `GridSnapshot` と完全に揃える。
struct GridSnapshot: Codable, Equatable {
    struct GridPayload: Codable, Equatable {
        var sortOrder: Int
        var memo: String?

        enum CodingKeys: String, CodingKey {
            case sortOrder = "sort_order"
            case memo
        }
    }

    struct CellInGrid: Codable, Equatable {
        var position: Int
        var text: String
        var imagePath: String?
        var color: String?

        enum CodingKeys: String, CodingKey {
            case position
            case text
            case imagePath = "image_path"
            case color
        }
    }

    var grid: GridPayload
    var cells: [CellInGrid]
    /// 親グリッドのどの位置 (0..8) から drill しているか。`nil` = root / 並列。
    var parentPosition: Int?
    var children: [GridSnapshot]
}

// MARK: - StockService

/// Stock = pasteboard 的な local-only 機能。
///
/// ユーザーが選んだセル + 配下 sub-grid 群を JSON snapshot として保存し、別のセルに paste できる。
/// `StockItem` は **local-only** (Supabase に同期しない)。
///
/// desktop 版 [`stock.ts`](../../../desktop/src/lib/api/stock.ts) と同等の動作:
/// - **add**: `addToStock(cellId:in:)` — snapshot 構築 + INSERT
/// - **move (cut)**: `moveCellToStock(cellId:in:)` — addToStock 後に元セル content クリア + 配下削除
/// - **delete**: `deleteStockItem(_:in:)`
/// - **paste**: `pasteFromStock(_:targetCellId:in:)` — snapshot を target に展開 (中心 / 周辺で挙動分岐)
@MainActor
enum StockService {

    // MARK: - Public API

    /// ストック一覧を `createdAt` 降順で取得する (= 新しい順)。
    static func getStockItems(in context: ModelContext) throws -> [StockItem] {
        let descriptor = FetchDescriptor<StockItem>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        return try context.fetch(descriptor)
    }

    /// セル (+ 配下 sub-grid 群) を snapshot 化してストックに追加する。
    @discardableResult
    static func addToStock(
        cellId: String,
        in context: ModelContext
    ) throws -> StockItem {
        let snapshot = try buildCellSnapshot(cellId: cellId, in: context)
        let data = try JSONEncoder().encode(snapshot)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        let item = StockItem(snapshot: json)
        context.insert(item)
        try context.save()
        return item
    }

    /// 「移動」アクション (= cut + ストック保存)。
    /// `addToStock` 成功後に元セル content をクリア + 配下 sub-grids を再帰削除する。
    /// 中心セルの場合は配下削除が広範になるので注意。
    @discardableResult
    static func moveCellToStock(
        cellId: String,
        in context: ModelContext
    ) throws -> StockItem {
        let item = try addToStock(cellId: cellId, in: context)
        try GridRepository.shredCellSubtree(cellId: cellId, in: context)
        return item
    }

    /// ストックアイテムを削除する。
    static func deleteStockItem(
        _ item: StockItem,
        in context: ModelContext
    ) throws {
        context.delete(item)
        try context.save()
    }

    /// ストックアイテムをセルにペーストする。
    ///
    /// 動作分岐 (desktop の `pasteFromStock` と等価):
    /// 1. **target cell content を上書き** (text / imagePath / color)
    /// 2. **target が mandalart の root_cell_id** ならば mandalart.title も同期更新
    /// 3. **stock 元が中心セル & target も中心セル & children あり** → grid 展開モード
    ///    (`expandGridSnapshotInto`: 既存 8 peripherals を上書き + 子グリッド再帰挿入)
    /// 4. それ以外 → children を target cell 配下の新 grids として再帰挿入
    ///
    /// **paste ガード**: target が周辺セル (position != 4) で中心セルが空の場合 throw。
    static func pasteFromStock(
        _ item: StockItem,
        targetCellId: String,
        in context: ModelContext
    ) throws {
        let snapshotData = item.snapshot.data(using: .utf8) ?? Data()
        let snapshot = try JSONDecoder().decode(CellSnapshot.self, from: snapshotData)

        // target cell を取得
        let targetFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == targetCellId && $0.deletedAt == nil }
        )
        guard let targetCell = try context.fetch(targetFetch).first else {
            throw StockError.targetNotFound
        }
        let targetGridId = targetCell.gridId

        // 周辺セルにペーストする場合、中心セルが空ならエラー
        if targetCell.position != GridConstants.centerPosition {
            try assertCenterNotEmpty(gridId: targetGridId, in: context)
        }

        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == targetGridId && $0.deletedAt == nil }
        )
        guard let targetGrid = try context.fetch(gridFetch).first else {
            throw StockError.targetNotFound
        }
        let mandalartId = targetGrid.mandalartId

        let now = Date()

        // 1) target cell 内容を上書き
        targetCell.text = snapshot.cell.text
        targetCell.imagePath = snapshot.cell.imagePath
        targetCell.color = snapshot.cell.color
        targetCell.updatedAt = now

        // 1b) target が mandalart の root_cell_id なら title も同期
        let rootOwnerFetch = FetchDescriptor<Mandalart>(
            predicate: #Predicate<Mandalart> { $0.rootCellId == targetCellId && $0.deletedAt == nil }
        )
        if let rootOwner = try context.fetch(rootOwnerFetch).first {
            rootOwner.title = snapshot.cell.text
            rootOwner.updatedAt = now
        }

        // 2) 中心セル snapshot 判定
        let isCenterSnapshot = (snapshot.position == GridConstants.centerPosition)

        // 3) 中心 → 中心 でグリッド展開
        if isCenterSnapshot,
           targetCell.position == GridConstants.centerPosition,
           let firstChild = snapshot.children.first {
            try expandGridSnapshotInto(
                gridSnap: firstChild,
                targetGridId: targetGridId,
                mandalartId: mandalartId,
                in: context
            )
            try context.save()
            return
        }

        // 4) それ以外: children を target cell 配下の新 grids として挿入
        for child in snapshot.children {
            try insertGridSnapshot(
                snap: child,
                parentCellId: targetCellId,
                mandalartId: mandalartId,
                in: context
            )
        }
        try context.save()
    }

    // MARK: - Errors

    enum StockError: Error, LocalizedError {
        case targetNotFound
        case sourceNotFound
        case centerEmpty

        var errorDescription: String? {
            switch self {
            case .targetNotFound: return "ペースト先のセルが見つかりません"
            case .sourceNotFound: return "ストック元のセルが見つかりません"
            case .centerEmpty: return "中心セルが空のグリッドの周辺セルにはペーストできません"
            }
        }
    }

    // MARK: - Private: snapshot 構築

    /// セル種別 (中心 / 周辺) に応じて適切な sub-grid 群を集めて CellSnapshot を返す。
    /// - 中心セル (position=4): `centerCellId == cellId` の grids (= root / レガシー並列共有)
    /// - 周辺セル (position != 4): `parentCellId == cellId` の grids (= primary + 並列)
    private static func buildCellSnapshot(
        cellId: String,
        in context: ModelContext
    ) throws -> CellSnapshot {
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == cellId && $0.deletedAt == nil }
        )
        guard let cell = try context.fetch(cellFetch).first else {
            throw StockError.sourceNotFound
        }

        var children: [GridSnapshot] = []
        let isCenter = (cell.position == GridConstants.centerPosition)

        if isCenter {
            let descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.centerCellId == cellId && $0.deletedAt == nil },
                sortBy: [SortDescriptor(\.sortOrder)]
            )
            for g in try context.fetch(descriptor) {
                children.append(try buildGridSnapshot(grid: g, in: context))
            }
        } else {
            let descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.parentCellId == cellId && $0.deletedAt == nil },
                sortBy: [SortDescriptor(\.sortOrder)]
            )
            for g in try context.fetch(descriptor) {
                children.append(try buildGridSnapshot(grid: g, in: context))
            }
        }

        return CellSnapshot(
            cell: CellSnapshot.CellPayload(
                text: cell.text,
                imagePath: cell.imagePath,
                color: cell.color
            ),
            position: cell.position,
            children: children
        )
    }

    /// グリッド snapshot: peripherals (= center 以外) のみ保存。center は paste 時に target が担う。
    /// 各 peripheral から派生する sub-grid 群を `parentPosition` 付きで `children` に再帰収集する。
    private static func buildGridSnapshot(
        grid: Grid,
        in context: ModelContext
    ) throws -> GridSnapshot {
        let gridId = grid.id
        let centerId = grid.centerCellId

        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.gridId == gridId && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.position)]
        )
        let cells = try context.fetch(cellFetch)
        let peripherals = cells.filter { $0.id != centerId }

        let cellSnaps = peripherals.map { c in
            GridSnapshot.CellInGrid(
                position: c.position,
                text: c.text,
                imagePath: c.imagePath,
                color: c.color
            )
        }

        var children: [GridSnapshot] = []
        for sc in peripherals {
            let scId = sc.id
            let subFetch = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> {
                    $0.parentCellId == scId && $0.id != gridId && $0.deletedAt == nil
                },
                sortBy: [SortDescriptor(\.sortOrder)]
            )
            for sub in try context.fetch(subFetch) {
                var childSnap = try buildGridSnapshot(grid: sub, in: context)
                childSnap.parentPosition = sc.position
                children.append(childSnap)
            }
        }

        return GridSnapshot(
            grid: GridSnapshot.GridPayload(
                sortOrder: grid.sortOrder,
                memo: grid.memo
            ),
            cells: cellSnaps,
            parentPosition: nil,
            children: children
        )
    }

    // MARK: - Private: paste 展開

    /// 中心セル snapshot のグリッド展開 (= target 中心セル → 既存 grid を上書き + 子グリッド再構築)。
    /// 既存 8 peripherals を上書き、不足分は新規 INSERT、既存子グリッドは parentCellId が一致する
    /// 限り維持しつつ snapshot からの children を新規挿入する。
    private static func expandGridSnapshotInto(
        gridSnap: GridSnapshot,
        targetGridId: String,
        mandalartId: String,
        in context: ModelContext
    ) throws {
        let now = Date()

        // 既存 cells を position でマップ化
        let existingFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.gridId == targetGridId && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.position)]
        )
        let existingCells = try context.fetch(existingFetch)
        var cellByPos: [Int: Cell] = [:]
        for c in existingCells { cellByPos[c.position] = c }

        let snapByPos: [Int: GridSnapshot.CellInGrid] = Dictionary(
            uniqueKeysWithValues: gridSnap.cells.map { ($0.position, $0) }
        )

        for pos in 0..<GridConstants.gridCellCount {
            if pos == GridConstants.centerPosition { continue }
            let sc = snapByPos[pos]
            if let existing = cellByPos[pos] {
                // 上書き (空でも UPDATE する旧挙動踏襲)
                existing.text = sc?.text ?? ""
                existing.imagePath = sc?.imagePath
                existing.color = sc?.color
                existing.updatedAt = now
            } else if let sc, !sc.text.isEmpty || sc.imagePath != nil || sc.color != nil {
                // 不足セル新規 INSERT (空セルは lazy policy により skip)
                let newCell = Cell(
                    gridId: targetGridId,
                    position: pos,
                    text: sc.text,
                    color: sc.color,
                    imagePath: sc.imagePath,
                    createdAt: now,
                    updatedAt: now
                )
                context.insert(newCell)
                cellByPos[pos] = newCell
            }
        }

        // 子グリッドを parentPosition に従って target 周辺セルへ紐付け。
        // parentPosition 未設定 (= レガシー並列 / 共有 root) は desktop と同様 skip。
        for child in gridSnap.children {
            guard let parentPos = child.parentPosition else { continue }
            if let parentCell = cellByPos[parentPos] {
                try insertGridSnapshot(
                    snap: child,
                    parentCellId: parentCell.id,
                    mandalartId: mandalartId,
                    in: context
                )
            }
        }
    }

    /// snap を新しい drilled grid として DB に挿入する (再帰)。
    /// 新モデル: center_cell_id = parentCellId。新グリッドには 8 peripherals のみ INSERT (lazy: 内容ありのみ)。
    private static func insertGridSnapshot(
        snap: GridSnapshot,
        parentCellId: String,
        mandalartId: String,
        in context: ModelContext
    ) throws {
        let now = Date()
        // X=C 統一: center_cell_id = parent peripheral cell id。parent_cell_id も同じ値。
        let newGrid = Grid(
            mandalartId: mandalartId,
            centerCellId: parentCellId,
            parentCellId: parentCellId,
            sortOrder: snap.grid.sortOrder,
            memo: snap.grid.memo,
            createdAt: now,
            updatedAt: now
        )
        context.insert(newGrid)

        // peripherals 8 個の挿入 (内容ありのみ、空は lazy policy で skip)
        let snapByPos: [Int: GridSnapshot.CellInGrid] = Dictionary(
            uniqueKeysWithValues: snap.cells.map { ($0.position, $0) }
        )
        var newCellIdByPos: [Int: String] = [:]
        for pos in 0..<GridConstants.gridCellCount {
            if pos == GridConstants.centerPosition { continue }
            guard let sc = snapByPos[pos],
                  !sc.text.isEmpty || sc.imagePath != nil || sc.color != nil else {
                continue
            }
            let newCell = Cell(
                gridId: newGrid.id,
                position: pos,
                text: sc.text,
                color: sc.color,
                imagePath: sc.imagePath,
                createdAt: now,
                updatedAt: now
            )
            context.insert(newCell)
            newCellIdByPos[pos] = newCell.id
        }

        // 子グリッド再帰
        for child in snap.children {
            guard let parentPos = child.parentPosition else {
                // parentPosition 未設定 = 並列: 同じ parentCellId を再利用
                try insertGridSnapshot(snap: child, parentCellId: parentCellId, mandalartId: mandalartId, in: context)
                continue
            }
            if parentPos == GridConstants.centerPosition {
                // 中心 = parentCellId 自身を再利用
                try insertGridSnapshot(snap: child, parentCellId: parentCellId, mandalartId: mandalartId, in: context)
            } else if let cid = newCellIdByPos[parentPos] {
                try insertGridSnapshot(snap: child, parentCellId: cid, mandalartId: mandalartId, in: context)
            }
        }
    }

    // MARK: - Private: paste ガード

    /// 中心セルが空 (text 空 + imagePath nil) かどうかチェックし、空なら throw。
    private static func assertCenterNotEmpty(
        gridId: String,
        in context: ModelContext
    ) throws {
        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == gridId && $0.deletedAt == nil }
        )
        guard let grid = try context.fetch(gridFetch).first else { return }
        let centerId = grid.centerCellId
        let centerFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == centerId && $0.deletedAt == nil }
        )
        guard let center = try context.fetch(centerFetch).first else {
            throw StockError.centerEmpty
        }
        let isEmpty = center.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && center.imagePath == nil
        if isEmpty { throw StockError.centerEmpty }
    }
}
