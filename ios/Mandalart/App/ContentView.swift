import SwiftUI
import SwiftData

struct ContentView: View {
    @State private var selectedMandalartId: String?

    var body: some View {
        if let id = selectedMandalartId {
            EditorView(mandalartId: id, onBack: { selectedMandalartId = nil })
        } else {
            DashboardView(onOpenMandalart: { selectedMandalartId = $0 })
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthStore())
        .modelContainer(for: [Mandalart.self, Grid.self, Cell.self, Folder.self, StockItem.self], inMemory: true)
}
