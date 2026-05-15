import Foundation
import SwiftData

/// セルの `done` チェック状態をトグルし、サブツリーと親方向へ伝播する。
///
/// desktop の [`toggleCellDone`](../../../desktop/src/lib/api/cells.ts) と完全に等価な
/// 振る舞いを SwiftData で実装する。落とし穴 #10 (中心セル 3 パターン) を踏まえ、
/// 親子関係は **`grids.centerCellId` ベース** で辿り、`Mandalart.rootCellId` や
/// `grids.parentCellId` には依存しない (= cross-platform 不整合に対して堅牢)。
///
/// **ツリー定義** (新モデル / X=C 統一):
///  - Cell C の子 = すべての grid g (where `g.centerCellId == C.id`) の peripheral cells (= `gridId == g.id && id != C.id`)
///  - Cell C の親 = `C.gridId` の grid の `centerCellId` (それが自分なら root 中心 = 親なし)
///
/// **伝播ルール**:
///  - subtree: 自身と全子孫を新 done 状態に揃える (空セルは「タスクではない」として skip)
///  - parent (on done=true): 親の全子孫が done のときのみ親も done に
///  - parent (on done=false): 親が done なら必ず uncheck し再帰
///
/// 全更新を 1 トランザクションにまとめるため、最後に 1 度だけ `context.save()` を呼ぶ。
enum CellCheckboxService {
    /// 指定セルの done をトグル + 伝播。空セルは toggle 自体しない。
    static func toggle(cellId: String, in context: ModelContext) {
        guard let cell = fetchCell(id: cellId, in: context), !isEmpty(cell) else { return }
        let nextDone = !cell.done
        let ts = Date()

        markSubtreeDone(cellId: cellId, done: nextDone, ts: ts, in: context)

        if nextDone {
            propagateDoneUp(cellId: cellId, ts: ts, in: context)
        } else {
            propagateUndoneUp(cellId: cellId, ts: ts, in: context)
        }

        try? context.save()
    }

    // MARK: - subtree (down)

    /// 自身 + 配下の全 peripheral cells を `done` に揃える。
    /// 空セルは更新対象外 (= isEmpty で skip)。
    private static func markSubtreeDone(
        cellId: String,
        done: Bool,
        ts: Date,
        in context: ModelContext
    ) {
        if let cell = fetchCell(id: cellId, in: context),
           !isEmpty(cell),
           cell.done != done {
            cell.done = done
            cell.updatedAt = ts
        }

        // 自身を center cell とする grid 群 → その peripherals に再帰
        for g in fetchGridsCenteredOn(cellId: cellId, in: context) {
            let peripherals = fetchCells(
                inGrid: g.id,
                excludingId: cellId,
                in: context
            )
            for p in peripherals where !isEmpty(p) {
                markSubtreeDone(cellId: p.id, done: done, ts: ts, in: context)
            }
        }
    }

    // MARK: - parent (up)

    /// ツリー上の親セル: `cell.gridId` の grid の `centerCellId`。
    /// それが自身なら root 中心 = 親なしで `nil`。
    private static func getParentCellInTree(
        cellId: String,
        in context: ModelContext
    ) -> Cell? {
        guard let cell = fetchCell(id: cellId, in: context) else { return nil }
        guard let grid = fetchGrid(id: cell.gridId, in: context) else { return nil }
        if grid.centerCellId == cellId { return nil }
        return fetchCell(id: grid.centerCellId, in: context)
    }

    /// 指定セル配下 (自身を除く) の **非空** cell が全て `done == true` か。
    /// 空セルは「タスクではない」として判定除外 (= 自動的に true 扱い)。
    private static func areDescendantsAllDone(
        cellId: String,
        in context: ModelContext
    ) -> Bool {
        for g in fetchGridsCenteredOn(cellId: cellId, in: context) {
            let peripherals = fetchCells(
                inGrid: g.id,
                excludingId: cellId,
                in: context
            )
            for p in peripherals {
                if isEmpty(p) { continue }
                if !p.done { return false }
                if !areDescendantsAllDone(cellId: p.id, in: context) { return false }
            }
        }
        return true
    }

    /// 親が done になれる条件 (= 全子孫が done) を満たすときだけ親も done に。
    /// 親方向へ再帰的に伝播。
    private static func propagateDoneUp(
        cellId: String,
        ts: Date,
        in context: ModelContext
    ) {
        guard let parent = getParentCellInTree(cellId: cellId, in: context) else { return }
        guard areDescendantsAllDone(cellId: parent.id, in: context) else { return }
        if !parent.done {
            parent.done = true
            parent.updatedAt = ts
        }
        propagateDoneUp(cellId: parent.id, ts: ts, in: context)
    }

    /// 親が done のときは uncheck (= 子孫の 1 つが undone なので親 done 不変条件が壊れる)。
    /// 親方向へ再帰。
    private static func propagateUndoneUp(
        cellId: String,
        ts: Date,
        in context: ModelContext
    ) {
        guard let parent = getParentCellInTree(cellId: cellId, in: context) else { return }
        guard parent.done else { return }
        parent.done = false
        parent.updatedAt = ts
        propagateUndoneUp(cellId: parent.id, ts: ts, in: context)
    }

    // MARK: - helpers

    /// CellView の `isEmpty` 判定と一致させた上で desktop の `TRIM(text) != ''` も模倣する
    /// (= 空白のみの text も空扱い)。これで desktop と iOS の伝播結果が一致する。
    private static func isEmpty(_ cell: Cell) -> Bool {
        let trimmed = cell.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty && cell.imagePath == nil
    }

    private static func fetchCell(id: String, in context: ModelContext) -> Cell? {
        let descriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == id && $0.deletedAt == nil }
        )
        return (try? context.fetch(descriptor))?.first
    }

    private static func fetchGrid(id: String, in context: ModelContext) -> Grid? {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == id && $0.deletedAt == nil }
        )
        return (try? context.fetch(descriptor))?.first
    }

    private static func fetchGridsCenteredOn(
        cellId: String,
        in context: ModelContext
    ) -> [Grid] {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.centerCellId == cellId && $0.deletedAt == nil
            }
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    /// 指定 grid の peripherals (= 指定 cell id を除く全 cells)。空判定は呼出側で行う。
    private static func fetchCells(
        inGrid gridId: String,
        excludingId excludedId: String,
        in context: ModelContext
    ) -> [Cell] {
        let descriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> {
                $0.gridId == gridId && $0.id != excludedId && $0.deletedAt == nil
            }
        )
        return (try? context.fetch(descriptor)) ?? []
    }
}
