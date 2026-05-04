import SwiftUI
import SwiftData

struct EditorView: View {
    let mandalartId: String
    let onBack: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Query private var mandalarts: [Mandalart]

    init(mandalartId: String, onBack: @escaping () -> Void) {
        self.mandalartId = mandalartId
        self.onBack = onBack
        _mandalarts = Query(filter: #Predicate<Mandalart> { $0.id == mandalartId })
    }

    private var mandalart: Mandalart? { mandalarts.first }

    var body: some View {
        NavigationStack {
            VStack {
                if let m = mandalart {
                    Text(m.title)
                        .font(.title)
                        .padding()
                    Text("Editor placeholder")
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    Text("マンダラートが見つかりません")
                        .foregroundStyle(.secondary)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                        Text("ダッシュボード")
                    }
                }
            }
        }
    }
}
