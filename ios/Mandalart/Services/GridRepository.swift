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

    /// 同じ `parent_cell_id` を持つ兄弟 grid 群 (= 並列) を `sortOrder` 昇順で返す。
    /// `parentCellId == nil` の場合は同じ mandalart の root grids 群 (= 並列ルート) を返す。
    /// 並列ナビ (← / →) の対象集合を計算するのに使う。
    static func getSiblingGrids(
        parentCellId: String?,
        mandalartId: String,
        in context: ModelContext
    ) -> [Grid] {
        let descriptor: FetchDescriptor<Grid>
        if let pcid = parentCellId {
            descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> {
                    $0.parentCellId == pcid && $0.deletedAt == nil
                },
                sortBy: [SortDescriptor(\Grid.sortOrder)]
            )
        } else {
            descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> {
                    $0.mandalartId == mandalartId && $0.parentCellId == nil && $0.deletedAt == nil
                },
                sortBy: [SortDescriptor(\Grid.sortOrder)]
            )
        }
        return (try? context.fetch(descriptor)) ?? []
    }

    /// 並列グリッドを新規作成する (= 独立 center cell を持つ兄弟 grid)。
    ///
    /// - parentCellId が drill 元 cell の id (root parallel なら nil)
    /// - 新 center cell を空コンテンツで先に INSERT し、その id を centerCellId に持つ grid を INSERT
    /// - desktop の `createGrid({ parentCellId, centerCellId: null, sortOrder })` と等価
    @discardableResult
    static func createParallelGrid(
        parentCellId: String?,
        mandalartId: String,
        sortOrder: Int,
        in context: ModelContext
    ) throws -> Grid {
        let now = Date()
        let newGridId = IDGenerator.uuid()
        let centerCellId = IDGenerator.uuid()
        let centerCell = Cell(
            id: centerCellId,
            gridId: newGridId,
            position: GridConstants.centerPosition,
            text: "",
            createdAt: now,
            updatedAt: now
        )
        let newGrid = Grid(
            id: newGridId,
            mandalartId: mandalartId,
            centerCellId: centerCellId,
            parentCellId: parentCellId,
            sortOrder: sortOrder,
            createdAt: now,
            updatedAt: now
        )
        context.insert(centerCell)
        context.insert(newGrid)
        try context.save()
        return newGrid
    }

    /// `gridId` の grid が完全に空 (= 自所属 cells が全て空 + 子グリッドなし) なら物理削除する。
    /// 並列ナビ後に旧 grid を片付ける用途。
    ///
    /// **削除対象**:
    /// - root / 並列 (独立 center) grid: 自所属 9 cells (center 含む) を全削除 + grid 削除
    /// - X=C primary drilled: 自所属 8 peripherals のみ削除 (共有 center は親 grid 側に残る)
    ///
    /// **抑制条件**: 自所属 cells のいずれかが non-empty / done=true / 色 / 画像 / 子グリッドあり
    ///
    /// - returns: 削除したかどうか
    @discardableResult
    static func cleanupGridIfEmpty(
        gridId: String,
        in context: ModelContext
    ) -> Bool {
        let gridDescriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == gridId && $0.deletedAt == nil }
        )
        guard let grid = try? context.fetch(gridDescriptor).first else { return false }

        let cellsDescriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.gridId == gridId && $0.deletedAt == nil }
        )
        let cells = (try? context.fetch(cellsDescriptor)) ?? []
        let allEmpty = cells.allSatisfy { c in
            c.text.isEmpty && c.imagePath == nil && c.color == nil && !c.done
        }
        if !allEmpty { return false }

        // 自所属 cell から派生する子グリッドが 1 つでもあれば cleanup を抑制
        for c in cells {
            let cid = c.id
            let childDescriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> {
                    $0.parentCellId == cid && $0.deletedAt == nil
                }
            )
            if let count = try? context.fetch(childDescriptor), !count.isEmpty {
                return false
            }
        }

        for c in cells {
            context.delete(c)
        }
        context.delete(grid)
        try? context.save()
        return true
    }

    /// 9×9 view 表示用 layout を返す。9 ブロック分の `(対応する Grid?, 9 要素 displayCells)` を
    /// blockIndex (= 3×3 内 position) 順で配列化する。
    ///
    /// - **blockIndex == 4 (中心)**: `rootGrid` 自身の displayCells (= root の 9 セル)
    /// - **blockIndex != 4 (周辺、子グリッドあり)**: 子グリッドの displayCells (X=C で中心に親 peripheral)
    /// - **blockIndex != 4 (周辺、子グリッド未作成)**: X=C **implicit** display
    ///   = 中心に root の対応 peripheral cell、周辺 8 cell は nil。子グリッドを作る前段階の
    ///   "seed" を 9×9 上で見せる (= drill すると即座にこの中心が継承される)
    /// - **blockIndex != 4 (周辺、root peripheral も空)**: 全 9 cell が nil の placeholder
    ///
    /// desktop の `useSubGrids` ([`../../desktop/src/components/editor/Grid9x9.tsx`](../../desktop/src/components/editor/Grid9x9.tsx) 系) と等価。
    static func loadNineByNineLayout(
        rootGrid: Grid,
        in context: ModelContext
    ) -> [(Grid?, [Cell?])] {
        var result: [(Grid?, [Cell?])] = []
        let rootDisplay = displayCells(for: rootGrid, in: context)

        for blockIndex in 0..<GridConstants.gridCellCount {
            if blockIndex == GridConstants.centerPosition {
                result.append((rootGrid, rootDisplay))
                continue
            }
            // 周辺 block: root grid の対応 position の cell → 子グリッド最初の 1 件
            let parentCell = rootDisplay[blockIndex]
            if let parentCell, let child = findChildGrid(parentCellId: parentCell.id, in: context) {
                let childDisplay = displayCells(for: child, in: context)
                result.append((child, childDisplay))
            } else {
                // implicit: 中心に親 peripheral (X=C seed)、周辺 8 は nil
                var implicit: [Cell?] = Array(repeating: nil, count: GridConstants.gridCellCount)
                implicit[GridConstants.centerPosition] = parentCell
                result.append((nil, implicit))
            }
        }
        return result
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
