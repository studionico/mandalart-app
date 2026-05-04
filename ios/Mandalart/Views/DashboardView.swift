import SwiftUI
import SwiftData

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AuthStore.self) private var auth
    @Query(filter: #Predicate<Mandalart> { $0.deletedAt == nil },
           sort: [SortDescriptor(\Mandalart.updatedAt, order: .reverse)])
    private var mandalarts: [Mandalart]
    @State private var showSettings = false

    let onOpenMandalart: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                if mandalarts.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(mandalarts) { m in
                            MandalartCard(mandalart: m)
                                .onTapGesture { onOpenMandalart(m.id) }
                                .contextMenu {
                                    Button(role: .destructive) {
                                        try? MandalartFactory.permanentDelete(m, in: modelContext)
                                    } label: {
                                        Label("削除", systemImage: "trash")
                                    }
                                }
                        }
                    }
                    .padding(12)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: auth.isSignedIn ? "person.crop.circle.fill" : "person.crop.circle")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        try? MandalartFactory.create(title: "新規マンダラート", in: modelContext)
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environment(auth)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("マンダラートがありません")
                .foregroundStyle(.secondary)
            Button("新規作成") {
                try? MandalartFactory.create(title: "新規マンダラート", in: modelContext)
            }
            .buttonStyle(.borderedProminent)
            .tint(.primary)
        }
        .padding(.top, 80)
        .frame(maxWidth: .infinity)
    }
}

private struct MandalartCard: View {
    let mandalart: Mandalart

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(uiColor: .secondarySystemBackground))
                .aspectRatio(1, contentMode: .fit)
                .overlay(
                    Text(mandalart.title)
                        .font(.system(size: 14, weight: .medium))
                        .multilineTextAlignment(.center)
                        .padding(8)
                        .foregroundStyle(.primary)
                )
            Text(mandalart.updatedAt.formatted(.relative(presentation: .named)))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
