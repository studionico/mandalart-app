import SwiftUI
import SwiftData

/// Landscape 2-pane editor (NavigationStack なし、floating control overlay でスペース最大化):
/// - 左ペイン: 3×3 グリッド (正方形、垂直中央)
/// - 右ペイン: breadcrumb + メモ プレースホルダ
/// - 左上 floating: home (ダッシュボードへ戻る) + ロック indicator (ロック時のみ)
struct EditorView: View {
    let mandalartId: String
    let onBack: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Query private var mandalarts: [Mandalart]
    @Query private var grids: [Grid]
    @Query private var allCells: [Cell]

    @State private var currentGridId: String?
    @State private var breadcrumb: [BreadcrumbItem] = []
    @State private var didBootstrap: Bool = false
    @State private var showLockHint: Bool = false

    init(mandalartId: String, onBack: @escaping () -> Void) {
        self.mandalartId = mandalartId
        self.onBack = onBack
        _mandalarts = Query(filter: #Predicate<Mandalart> { $0.id == mandalartId })
        _grids = Query(
            filter: #Predicate<Grid> { $0.mandalartId == mandalartId && $0.deletedAt == nil },
            sort: [SortDescriptor(\Grid.sortOrder)]
        )
        _allCells = Query(
            filter: #Predicate<Cell> { $0.deletedAt == nil }
        )
    }

    private var mandalart: Mandalart? { mandalarts.first }

    private var currentGrid: Grid? {
        if let id = currentGridId, let g = grids.first(where: { $0.id == id }) {
            return g
        }
        return grids.first(where: { $0.parentCellId == nil })
    }

    var body: some View {
        Group {
            if let m = mandalart, let grid = currentGrid {
                VStack(spacing: 0) {
                    if m.locked {
                        lockBanner
                    }
                    ZStack(alignment: .topLeading) {
                        content(mandalart: m, grid: grid)
                            .onAppear { bootstrapIfNeeded(mandalart: m) }

                        // 左上 floating home button (lock banner と縦並び)
                        Button(action: onBack) {
                            Image(systemName: "house.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(.primary)
                                .frame(width: 36, height: 36)
                                .background(.ultraThinMaterial, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .padding(.leading, 12)
                        .padding(.top, 8)
                    }
                }
            } else {
                Text("マンダラートが見つかりません")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .alert("ロック中のマンダラート", isPresented: $showLockHint) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("編集するにはダッシュボードに戻り、カードを長押しして「ロックを外す」を選んでください。")
        }
    }

    /// 上部全幅 lock banner。tap で詳細 alert を表示。
    private var lockBanner: some View {
        Button {
            showLockHint = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill")
                Text("ロック中 — 編集できません")
                    .lineLimit(1)
                Spacer()
                Text("解除はダッシュボードから")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Image(systemName: "info.circle")
                    .foregroundStyle(.secondary)
            }
            .font(.callout)
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func content(mandalart: Mandalart, grid: Grid) -> some View {
        HStack(alignment: .top, spacing: 16) {
            // 左ペイン: 3×3 グリッド (正方形、上下センタリング)
            VStack {
                Spacer(minLength: 0)
                GridView3x3(
                    gridId: grid.id,
                    displayCells: GridRepository.displayCells(for: grid, in: modelContext),
                    mandalart: mandalart,
                    onDrillRequest: { cell in handleDrill(cell: cell, mandalart: mandalart) }
                )
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
            // 左上 home button と被らないように左を少しだけ空ける
            .padding(.leading, 56)

            // 右ペイン: breadcrumb + メモ
            VStack(alignment: .leading, spacing: 12) {
                Breadcrumb(items: breadcrumb) { index in
                    navigateToBreadcrumb(index, mandalart: mandalart)
                }
                Divider()
                memoPlaceholder(grid: grid)
                Spacer()
            }
            .frame(maxWidth: 320)
            .padding(.trailing, 8)
            .padding(.top, 4)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private func memoPlaceholder(grid: Grid) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("メモ")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(grid.memo ?? "(未実装)")
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Navigation

    private func bootstrapIfNeeded(mandalart: Mandalart) {
        guard !didBootstrap else { return }
        didBootstrap = true

        let root = grids.first(where: { $0.parentCellId == nil })
        guard let root else { return }

        let lastId = mandalart.lastGridId
        if let lastId, lastId != root.id,
           let ancestry = GridRepository.getGridAncestry(gridId: lastId, in: modelContext),
           ancestry.count > 1 {
            currentGridId = ancestry.last?.id
            breadcrumb = ancestry.map { g in
                BreadcrumbItem(
                    gridId: g.id,
                    cellId: g.parentCellId,
                    label: labelForGrid(g, mandalart: mandalart)
                )
            }
        } else {
            currentGridId = root.id
            breadcrumb = [BreadcrumbItem(
                gridId: root.id,
                cellId: nil,
                label: mandalart.title.isEmpty ? "(無題)" : mandalart.title
            )]
        }
    }

    private func handleDrill(cell: Cell, mandalart: Mandalart) {
        let child: Grid?
        if mandalart.locked {
            // ロック中: 既存子のみ navigate (新規作成は抑制 = 書き込み禁止)。
            child = GridRepository.findChildGrid(parentCellId: cell.id, in: modelContext)
            guard child != nil else { return }
        } else {
            do {
                child = try GridRepository.findOrCreateChildGrid(
                    parentCellId: cell.id,
                    mandalartId: mandalart.id,
                    in: modelContext
                )
            } catch {
                print("[editor] drill-down failed:", error)
                return
            }
        }
        guard let target = child else { return }
        breadcrumb.append(BreadcrumbItem(
            gridId: target.id,
            cellId: cell.id,
            label: cell.text.isEmpty ? "(無題)" : cell.text
        ))
        currentGridId = target.id
        // lastGridId / updatedAt 更新は書き込み → ロック中はスキップ (sync dirty 化を避ける)
        if !mandalart.locked {
            mandalart.lastGridId = target.id
            mandalart.updatedAt = Date()
            try? modelContext.save()
        }
    }

    private func navigateToBreadcrumb(_ index: Int, mandalart: Mandalart) {
        guard index >= 0, index < breadcrumb.count else { return }
        let target = breadcrumb[index]
        breadcrumb = Array(breadcrumb.prefix(index + 1))
        currentGridId = target.gridId
        // ロック中は lastGridId 更新スキップ (drill-up も navigation 専用、書き込みなし)
        if !mandalart.locked {
            mandalart.lastGridId = target.gridId
            mandalart.updatedAt = Date()
            try? modelContext.save()
        }
    }

    private func labelForGrid(_ grid: Grid, mandalart: Mandalart) -> String {
        if grid.parentCellId == nil {
            return mandalart.title.isEmpty ? "(無題)" : mandalart.title
        }
        let parentId = grid.parentCellId!
        if let parent = allCells.first(where: { $0.id == parentId }) {
            return parent.text.isEmpty ? "(無題)" : parent.text
        }
        return "(無題)"
    }
}
