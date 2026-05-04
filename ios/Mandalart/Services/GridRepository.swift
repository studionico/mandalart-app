import Foundation
import SwiftData

/// Drill / ancestry / merged cell ヘルパ。
/// desktop の `lib/api/grids.ts` (`getGrid` / `createGrid` / `getGridAncestry`) を Swift / SwiftData に移植。
///
/// X=C 統一モデル ([`../../docs/data-model.md`](../../docs/data-model.md), [`../../desktop/docs/data-model.md`](../../desktop/docs/data-model.md)):
/// - **root grid**: 自グリッド内に position=4 の cell 行を持つ (= `centerCellId == ownCells[position=4].id`)
/// - **primary drilled child grid**: position=4 の cell 行を持たず、`centerCellId` は親 peripheral cell の id を指す
///   (X=C 統一: 子グリッドの中心と親の周辺は **同一 cell row を共有**)
/// - 子グリッド表示時は親 peripheral を merge して 9 セル view を作る
@MainActor
enum GridRepository {

    /// 親 peripheral cell の子グリッドを **read-only で** 検索する (= 新規作成しない)。
    /// 並列がある場合は `sortOrder` 昇順の最初の 1 件、なければ nil。
    /// ロック中の drill-down で「既存子のみ navigate して新規作成は抑制」したいときに使う。
    static func findChildGrid(
        parentCellId: String,
        in context: ModelContext
    ) -> Grid? {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.parentCellId == parentCellId && $0.deletedAt == nil
            },
            sortBy: [SortDescriptor(\Grid.sortOrder)]
        )
        return (try? context.fetch(descriptor))?.first
    }

    /// 親 peripheral cell から子グリッドを find or create する。
    /// 既存の子グリッドが複数ある (= 並列) 場合は `sortOrder` 昇順の最初の 1 件を返す。
    /// 新規作成は X=C primary drilled (`parentCellId == centerCellId == cell.id`)。
    @discardableResult
    static func findOrCreateChildGrid(
        parentCellId: String,
        mandalartId: String,
        in context: ModelContext
    ) throws -> Grid {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.parentCellId == parentCellId && $0.deletedAt == nil
            },
            sortBy: [SortDescriptor(\Grid.sortOrder)]
        )
        if let existing = try context.fetch(descriptor).first {
            return existing
        }
        // X=C primary drilled: 自グリッドに position=4 行は持たない、center は親 peripheral と共有
        let now = Date()
        let newGrid = Grid(
            mandalartId: mandalartId,
            centerCellId: parentCellId,
            parentCellId: parentCellId,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now
        )
        context.insert(newGrid)
        try context.save()
        return newGrid
    }

    /// 指定 grid を画面表示用 9 要素 (`[Cell?]`) に展開する。
    /// - 周辺 (position 0-8、ただし grid 種別による): ownCells を埋める
    /// - 中心 (position=4):
    ///   - root grid なら ownCells に含まれているのでそのまま
    ///   - 子グリッドなら親 peripheral cell を index 4 に merge (元の `position` 値は変えない)
    static func displayCells(
        for grid: Grid,
        in context: ModelContext
    ) -> [Cell?] {
        var slots: [Cell?] = Array(repeating: nil, count: GridConstants.gridCellCount)
        let gridId = grid.id
        let ownDescriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> {
                $0.gridId == gridId && $0.deletedAt == nil
            }
        )
        let ownCells = (try? context.fetch(ownDescriptor)) ?? []
        for cell in ownCells {
            let p = cell.position
            if p >= 0 && p < GridConstants.gridCellCount {
                slots[p] = cell
            }
        }
        // root grid なら ownCells に center が含まれているはず → 何もしない
        // 子グリッドなら center_cell_id が指す親 peripheral を index 4 に merge
        let centerCellId = grid.centerCellId
        let alreadyHasCenter = ownCells.contains(where: { $0.id == centerCellId })
        if !alreadyHasCenter {
            let centerDescriptor = FetchDescriptor<Cell>(
                predicate: #Predicate<Cell> {
                    $0.id == centerCellId && $0.deletedAt == nil
                }
            )
            if let parent = try? context.fetch(centerDescriptor).first {
                slots[GridConstants.centerPosition] = parent
            }
        }
        return slots
    }

    /// 指定 grid から root grid までの ancestry を返す (root が先頭、leaf が末尾)。
    /// `mandalart.lastGridId` から起動時に breadcrumb を復元するために使う。
    /// - 途中で grid / cell が見つからない場合は nil を返す → 呼出側で root にフォールバック。
    static func getGridAncestry(
        gridId: String,
        in context: ModelContext
    ) -> [Grid]? {
        var ancestry: [Grid] = []
        var seen = Set<String>()
        var currentId: String? = gridId
        while let id = currentId {
            if seen.contains(id) { return nil }
            seen.insert(id)

            let gridDescriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.id == id && $0.deletedAt == nil }
            )
            guard let grid = try? context.fetch(gridDescriptor).first else { return nil }
            ancestry.insert(grid, at: 0)
            guard let parentCellId = grid.parentCellId else { break }  // root 到達

            // parent cell がどの grid に属するか逆引き
            let cellDescriptor = FetchDescriptor<Cell>(
                predicate: #Predicate<Cell> { $0.id == parentCellId && $0.deletedAt == nil }
            )
            guard let parentCell = try? context.fetch(cellDescriptor).first else { return nil }
            currentId = parentCell.gridId
        }
        return ancestry
    }
}
