import SwiftUI
import SwiftData

/// Landscape 2-pane editor: left = 3×3 grid (square), right = breadcrumb / memo placeholder.
struct EditorView: View {
    let mandalartId: String
    let onBack: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Query private var mandalarts: [Mandalart]
    @Query private var grids: [Grid]

    init(mandalartId: String, onBack: @escaping () -> Void) {
        self.mandalartId = mandalartId
        self.onBack = onBack
        _mandalarts = Query(filter: #Predicate<Mandalart> { $0.id == mandalartId })
        _grids = Query(
            filter: #Predicate<Grid> { $0.mandalartId == mandalartId && $0.deletedAt == nil },
            sort: [SortDescriptor(\Grid.sortOrder)]
        )
    }

    private var mandalart: Mandalart? { mandalarts.first }

    /// Current grid: prefer mandalart.lastGridId, fallback to root grid (parentCellId == nil).
    private var currentGrid: Grid? {
        if let lastId = mandalart?.lastGridId,
           let g = grids.first(where: { $0.id == lastId }) {
            return g
        }
        return grids.first(where: { $0.parentCellId == nil })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let m = mandalart, let grid = currentGrid {
                    landscapeBody(mandalart: m, grid: grid)
                } else {
                    Text("マンダラートが見つかりません")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button(action: onBack) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                            Text("ダッシュボード")
                        }
                    }
                }
                if let m = mandalart, m.locked {
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill")
                            Text("ロック中")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func landscapeBody(mandalart: Mandalart, grid: Grid) -> some View {
        HStack(alignment: .top, spacing: 16) {
            // 左ペイン: 3×3 グリッド (正方形クランプ + 垂直中央寄せ)
            VStack {
                Spacer(minLength: 0)
                GridView3x3(gridId: grid.id, mandalart: mandalart)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)

            // 右ペイン: breadcrumb + メモ placeholder
            VStack(alignment: .leading, spacing: 12) {
                breadcrumb(mandalart: mandalart, grid: grid)
                Divider()
                memoPlaceholder(grid: grid)
                Spacer()
            }
            .frame(maxWidth: 320)
            .padding(.trailing, 8)
        }
        .padding(16)
    }

    @ViewBuilder
    private func breadcrumb(mandalart: Mandalart, grid: Grid) -> some View {
        HStack(spacing: 4) {
            Text(mandalart.title.isEmpty ? "(無題)" : mandalart.title)
                .font(.headline)
            if grid.parentCellId != nil {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("子グリッド")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
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
}
