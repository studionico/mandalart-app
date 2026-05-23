import Foundation
import SwiftData
import Supabase

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

    /// 指定 grid の displayCells 9 要素について、**各 cell に "意味のある" 子グリッドが存在するか** を
    /// Bool 配列で返す。CellView の border 太さ (= 子あり時 1.5pt、なし時 0.5pt) 描画に使う。
    ///
    /// "意味のある" = 子グリッドの周辺セル (position != 4) に 1 つでも `text` (trim 後非空) または
    /// `imagePath` を持つ cell がある。drill-down 直後で空のまま戻ったケースは false 扱いとなり、
    /// ユーザーが実際に内容を入れるまで太枠化されない (= desktop の `fetchChildCountsFor` 等価)。
    ///
    /// 中心 (position=4) は drill 元にならないので常に false。
    /// 最悪 8 cells × (1 grid fetch + 8 peripheral cells fetch) ≒ 72 fetch まで膨らみうるが、
    /// 子グリッド未作成のセルは findChildGrid で即 nil → スキップされるので実測コストは軽い。
    static func hasChildMaskForGrid(
        displayCells: [Cell?],
        in context: ModelContext
    ) -> [Bool] {
        var mask: [Bool] = Array(repeating: false, count: GridConstants.gridCellCount)
        for (i, cell) in displayCells.enumerated() {
            guard i != GridConstants.centerPosition, let cell else { continue }
            guard let child = findChildGrid(parentCellId: cell.id, in: context) else { continue }
            mask[i] = hasMeaningfulPeripheralContent(in: child, context: context)
        }
        return mask
    }

    /// 子グリッドが「意味のある中身」を持つかを判定する。
    /// = 周辺セル (position != 4) に 1 つでも `text` (trim 後非空) または `imagePath` を持つ
    /// cell が存在すれば true。中心 (position=4) は X=C 統一モデルで親 peripheral と共有のため
    /// 除外する (= 親側の入力が子の「意味」にカウントされるのを防ぐ)。
    /// desktop の `EditorLayout.tsx` `fetchChildCountsFor`
    /// (`EXISTS (… position != 4 AND (text != '' OR image_path IS NOT NULL))`) と等価。
    private static func hasMeaningfulPeripheralContent(
        in grid: Grid,
        context: ModelContext
    ) -> Bool {
        let gridId = grid.id
        let center = GridConstants.centerPosition
        let descriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> {
                $0.gridId == gridId && $0.position != center && $0.deletedAt == nil
            }
        )
        guard let cells = try? context.fetch(descriptor) else { return false }
        return cells.contains { c in
            let textNonEmpty = !c.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return textNonEmpty || c.imagePath != nil
        }
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

    /// セルの content をクリア + 配下 sub-grid 群を再帰削除する (= cut / 「ストックに移動」用)。
    ///
    /// desktop の `shredCellSubtree` ([`../../desktop/src/lib/api/cells.ts`](../../desktop/src/lib/api/cells.ts)) と同等:
    /// 1. 引数の cell の text / imagePath / color を空にし、done=false に戻す
    /// 2. `parentCellId == cellId` の grid (= primary drilled + 並列) を BFS で全部集めて、
    ///    各 grid 内の cells と更に孫 grids を再帰的に物理削除
    /// 3. X=C 統一モデルでは子グリッドの中心は親 peripheral cell と共有なので、削除時に
    ///    親 peripheral cell 自体は残す (= step 1 の content クリアだけにとどめる)
    ///
    /// 非中心セルの cut でも中心セルの cut でも安全に動く:
    /// - 中心セル (= position=4) の場合: `centerCellId == cellId` の grid 群 (= root / レガシー並列)
    ///   は **削除しない** (= grid 自体を消すと mandalart が壊れる)。content だけクリアして子グリッド経路は
    ///   parentCellId 経由で別途辿る (実質的に中心セルからの直接 child grid は無いので影響なし)
    static func shredCellSubtree(
        cellId: String,
        in context: ModelContext
    ) throws {
        // 1) source cell の content をクリア
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == cellId && $0.deletedAt == nil }
        )
        if let cell = try context.fetch(cellFetch).first {
            let now = Date()
            cell.text = ""
            cell.imagePath = nil
            cell.color = nil
            cell.done = false
            cell.updatedAt = now
        }

        // 2) parentCellId == cellId の grid 群を起点に BFS で配下 grid id を全収集
        var gridIdsToDelete: [String] = []
        var queue: [String] = [cellId]
        var visited = Set<String>()

        while let parentId = queue.popLast() {
            let descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> {
                    $0.parentCellId == parentId && $0.deletedAt == nil
                }
            )
            let childGrids = try context.fetch(descriptor)
            for g in childGrids {
                if visited.contains(g.id) { continue }
                visited.insert(g.id)
                gridIdsToDelete.append(g.id)

                // この grid 内の cells を queue に追加 (孫 grid 探索用)
                let gid = g.id
                let cFetch = FetchDescriptor<Cell>(
                    predicate: #Predicate<Cell> { $0.gridId == gid && $0.deletedAt == nil }
                )
                let inner = try context.fetch(cFetch)
                for ic in inner {
                    queue.append(ic.id)
                }
            }
        }

        // 3) 収集した grid 群を物理削除 (= cells 先 → grids 後)
        for gid in gridIdsToDelete {
            let cFetch = FetchDescriptor<Cell>(
                predicate: #Predicate<Cell> { $0.gridId == gid }
            )
            let cells = try context.fetch(cFetch)
            for c in cells { context.delete(c) }

            let gFetch = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.id == gid }
            )
            if let grid = try context.fetch(gFetch).first {
                context.delete(grid)
            }
        }

        // 4) セル内容を空にしたので親 (中心セル) の done を再計算する (上方伝播)。
        //    空になったセルは done 判定の母数から外れるため「残った非空周辺が全て done なら中心も done」。
        //    desktop cells.ts shredCellSubtree 末尾の propagateDoneUp と対称。
        CellCheckboxService.recomputeDoneUpward(fromCellId: cellId, in: context)

        try context.save()
    }

    /// 指定 grid を物理削除 (= 自所属 cells + 配下 grids 含めた cascade hard-delete)。
    /// 用途: シュレッダー (並列 grid を 1 本まるごと消す)。
    ///
    /// - `cleanupGridIfEmpty` が「空のときだけ消す」のに対し、こちらは **内容問わず消す**。
    /// - 並列 root grid 中心セル (= self-centered な center cell) シュレッダー時に呼ぶ想定。
    /// - cloud 削除は `MandalartFactory.deleteFromCloud` と同等の cells → grids 順で実行し、
    ///   失敗時は `CloudDeleteTombstone` に積んで次回 pullAll 冒頭で再試行 (落とし穴 #6 zombie 復活防止)。
    ///
    /// 削除順序:
    /// 1. BFS で `gridId` + 配下 grid id を全収集 (自 grid 所属 cells から派生する parentCellId
    ///    マッチの grid を再帰的に辿る)
    /// 2. ローカル: cells 先 → grids 後の順で `context.delete` → `save`
    /// 3. クラウド: cells WHERE grid_id IN (...) → grids WHERE id IN (...) を best-effort。
    ///    失敗時は CloudDeleteTombstone に各 grid_id を mandalartId として登録 (= 同テーブル
    ///    再利用、削除復活ガードは grid id でも同様に効く)。
    @MainActor
    static func permanentDeleteGrid(
        gridId: String,
        in context: ModelContext
    ) async throws {
        // 1) BFS で配下 grid id を全収集 (= 自 grid + 孫 grid)
        var gridIdsToDelete: [String] = [gridId]
        var queue: [String] = [gridId]
        var visited = Set<String>([gridId])
        while let gid = queue.popLast() {
            let cFetch = FetchDescriptor<Cell>(
                predicate: #Predicate<Cell> { $0.gridId == gid && $0.deletedAt == nil }
            )
            let cells = try context.fetch(cFetch)
            for c in cells {
                let cid = c.id
                let descriptor = FetchDescriptor<Grid>(
                    predicate: #Predicate<Grid> {
                        $0.parentCellId == cid && $0.deletedAt == nil
                    }
                )
                let childGrids = try context.fetch(descriptor)
                for g in childGrids where !visited.contains(g.id) {
                    visited.insert(g.id)
                    gridIdsToDelete.append(g.id)
                    queue.append(g.id)
                }
            }
        }

        // 2) ローカル物理削除: cells 先 → grids 後
        for gid in gridIdsToDelete {
            let cFetch = FetchDescriptor<Cell>(predicate: #Predicate<Cell> { $0.gridId == gid })
            for c in try context.fetch(cFetch) { context.delete(c) }
            let gFetch = FetchDescriptor<Grid>(predicate: #Predicate<Grid> { $0.id == gid })
            if let g = try context.fetch(gFetch).first { context.delete(g) }
        }
        try context.save()

        // 3) クラウド削除 (best-effort)。失敗時は tombstone へ。
        let client = SupabaseService.shared.client
        guard (try? await client.auth.session) != nil else {
            for gid in gridIdsToDelete { CloudDeleteTombstone.add(gid) }
            return
        }
        do {
            try await client.from("cells")
                .delete()
                .in("grid_id", values: gridIdsToDelete)
                .execute()
            try await client.from("grids")
                .delete()
                .in("id", values: gridIdsToDelete)
                .execute()
        } catch {
            print("[permanentDeleteGrid] cloud delete failed → tombstone:", error)
            for gid in gridIdsToDelete { CloudDeleteTombstone.add(gid) }
        }
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
