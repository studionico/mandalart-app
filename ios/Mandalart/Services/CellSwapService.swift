import Foundation
import SwiftData

/// 周辺セル同士のセル入れ替え (subtree swap)。
///
/// desktop の [`swapCellSubtree`](../../../desktop/src/lib/api/cells.ts) と等価な振る舞いを
/// SwiftData で実装する。**周辺 ↔ 周辺のみ** 許可し、中心セル絡みは `centerInvolved` を throw
/// (desktop `resolveDndAction` の rule と整合、落とし穴 #15)。
///
/// **入れ替え対象**:
/// - cells: `text` / `imagePath` / `color` (3 フィールド)。**`done` は入れ替えない** —
///   done 状態はポジション付随で残り、内容だけ移動する (= desktop と同挙動)
/// - grids: 配下 sub-grid 群の `parentCellId` と `centerCellId` を双方向で付け替え。
///   自グリッド (= cell が center を担当している grid 行自身) は除外して root 自己参照を保つ
///
/// **新モデル (X=C 統一) でのセマンティクス**: A 位置から drill すると B の旧 subtree、
/// B 位置から drill すると A の旧 subtree が見える状態を作る。drill 経路は `parentCellId`、
/// drill 後の中央セル merge は `centerCellId` で決まるため両軸を swap する必要がある。
///
/// 全更新を 1 トランザクションにまとめ、最後に `context.save()` を 1 度だけ呼ぶ。
enum CellSwapService {
    enum SwapError: Error {
        case sourceMissing
        case targetMissing
        case sameCell
        case centerInvolved
    }

    static func swap(
        sourceCellId: String,
        targetCellId: String,
        in context: ModelContext
    ) throws {
        guard sourceCellId != targetCellId else { throw SwapError.sameCell }
        guard let source = fetchCell(id: sourceCellId, in: context) else {
            throw SwapError.sourceMissing
        }
        guard let target = fetchCell(id: targetCellId, in: context) else {
            throw SwapError.targetMissing
        }
        let centerPos = GridConstants.centerPosition
        guard source.position != centerPos, target.position != centerPos else {
            throw SwapError.centerInvolved
        }

        let ts = Date()
        let sourceGridId = source.gridId
        let targetGridId = target.gridId

        // 1. parentCellId 付け替え (= drill 経路)。root は parentCellId == nil で影響なし
        for g in fetchGrids(parentCellId: sourceCellId, in: context) {
            g.parentCellId = targetCellId
            g.updatedAt = ts
        }
        for g in fetchGrids(parentCellId: targetCellId, in: context) {
            g.parentCellId = sourceCellId
            g.updatedAt = ts
        }

        // 2. centerCellId 付け替え (= drill 先の中央セル merge)。自グリッド除外
        for g in fetchGrids(centerCellId: sourceCellId, excludingGridId: sourceGridId, in: context) {
            g.centerCellId = targetCellId
            g.updatedAt = ts
        }
        for g in fetchGrids(centerCellId: targetCellId, excludingGridId: targetGridId, in: context) {
            g.centerCellId = sourceCellId
            g.updatedAt = ts
        }

        // 3. content swap (text / imagePath / color)。done は swap しない (= ポジション付随)
        let srcText = source.text
        let srcImage = source.imagePath
        let srcColor = source.color
        source.text = target.text
        source.imagePath = target.imagePath
        source.color = target.color
        source.updatedAt = ts
        target.text = srcText
        target.imagePath = srcImage
        target.color = srcColor
        target.updatedAt = ts

        try context.save()
    }

    // MARK: - helpers

    private static func fetchCell(id: String, in context: ModelContext) -> Cell? {
        let descriptor = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == id && $0.deletedAt == nil }
        )
        return (try? context.fetch(descriptor))?.first
    }

    private static func fetchGrids(parentCellId: String, in context: ModelContext) -> [Grid] {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.parentCellId == parentCellId && $0.deletedAt == nil
            }
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    private static func fetchGrids(
        centerCellId: String,
        excludingGridId: String,
        in context: ModelContext
    ) -> [Grid] {
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.centerCellId == centerCellId
                    && $0.id != excludingGridId
                    && $0.deletedAt == nil
            }
        )
        return (try? context.fetch(descriptor)) ?? []
    }
}
