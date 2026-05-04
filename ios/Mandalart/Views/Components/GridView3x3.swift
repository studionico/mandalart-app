import SwiftUI
import SwiftData

/// 3×3 grid of cells for a given grid id. Filters cells by gridId at @Query level
/// so only the relevant 1-9 rows are observed.
struct GridView3x3: View {
    let gridId: String
    let mandalart: Mandalart

    @Query private var cells: [Cell]

    init(gridId: String, mandalart: Mandalart) {
        self.gridId = gridId
        self.mandalart = mandalart
        _cells = Query(
            filter: #Predicate<Cell> { $0.gridId == gridId && $0.deletedAt == nil }
        )
    }

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: LayoutConstants.outerGridGap),
        count: 3
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: LayoutConstants.outerGridGap) {
            ForEach(0..<GridConstants.gridCellCount, id: \.self) { position in
                CellView(
                    cell: cells.first(where: { $0.position == position }),
                    gridId: gridId,
                    position: position,
                    mandalart: mandalart
                )
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
