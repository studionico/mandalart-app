import SwiftUI
import SwiftData

struct ContentView: View {
    @State private var selectedMandalartId: String?
    /// Dashboard カード ↔ Editor grid 容器の matchedGeometryEffect 用 Namespace。
    /// `withAnimation` で囲んだ state 切替時に「カード矩形 → grid 矩形」の morph を駆動する。
    @Namespace private var convergeNamespace

    private var convergeAnimation: Animation {
        .easeInOut(duration: Double(TimingConstants.convergeDurationMs) / 1000)
    }

    var body: some View {
        // ZStack で囲むことで遷移時に両 view が同時に view tree 上に存在でき、
        // matchedGeometryEffect が frame 補間する時間を確保する (= SwiftUI hero animation 標準)。
        // Group + if/else だと両 view が同時に存在しない瞬間があり morph が走らない。
        ZStack {
            if let id = selectedMandalartId {
                EditorView(
                    mandalartId: id,
                    namespace: convergeNamespace,
                    onBack: {
                        withAnimation(convergeAnimation) {
                            selectedMandalartId = nil
                        }
                    }
                )
            } else {
                DashboardView(
                    onOpenMandalart: { id in
                        withAnimation(convergeAnimation) {
                            selectedMandalartId = id
                        }
                    },
                    namespace: convergeNamespace
                )
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthStore())
        .modelContainer(for: [Mandalart.self, Grid.self, Cell.self, Folder.self, StockItem.self], inMemory: true)
}
