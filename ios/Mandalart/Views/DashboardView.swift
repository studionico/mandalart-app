import SwiftUI
import SwiftData

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AuthStore.self) private var auth

    /// 削除されていないマンダラートを fetch。並び順は Swift 側で決める
    /// (`@Query` の SortDescriptor 配列だと型推論が落ちる SwiftData 制約回避)。
    @Query(filter: #Predicate<Mandalart> { $0.deletedAt == nil })
    private var mandalartsRaw: [Mandalart]

    @State private var showSettings = false
    @State private var query: String = ""

    let onOpenMandalart: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 12)]

    /// 並び順: pinned 優先 → sortOrder ASC (nil は後ろ) → createdAt DESC (desktop と同等)
    private var sortedMandalarts: [Mandalart] {
        mandalartsRaw.sorted { lhs, rhs in
            // pinned == true を先頭に
            if lhs.pinned != rhs.pinned { return lhs.pinned }
            // sortOrder ASC、nil は後ろに送る
            switch (lhs.sortOrder, rhs.sortOrder) {
            case let (a?, b?) where a != b: return a < b
            case (_?, nil): return true
            case (nil, _?): return false
            default: break
            }
            // createdAt DESC
            return lhs.createdAt > rhs.createdAt
        }
    }

    /// 検索クエリ (空でない時) で title をケースインセンシティブ部分一致 filter。
    private var visibleMandalarts: [Mandalart] {
        guard !query.isEmpty else { return sortedMandalarts }
        let lower = query.lowercased()
        return sortedMandalarts.filter { $0.title.lowercased().contains(lower) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if visibleMandalarts.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(visibleMandalarts) { m in
                            MandalartCard(mandalart: m)
                                .onTapGesture { onOpenMandalart(m.id) }
                                .contextMenu { contextMenu(for: m) }
                        }
                    }
                    .padding(12)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .toolbar, prompt: "検索")
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

    @ViewBuilder
    private func contextMenu(for m: Mandalart) -> some View {
        Button {
            m.pinned.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(
                m.pinned ? "ピン留めを外す" : "ピン留め",
                systemImage: m.pinned ? "pin.slash" : "pin"
            )
        }

        Button {
            m.locked.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(
                m.locked ? "ロックを外す" : "ロック",
                systemImage: m.locked ? "lock.open" : "lock"
            )
        }

        Button {
            try? MandalartFactory.duplicate(m, in: modelContext)
        } label: {
            Label("複製", systemImage: "doc.on.doc")
        }

        Divider()

        Button(role: .destructive) {
            Task { try? await MandalartFactory.permanentDelete(m, in: modelContext) }
        } label: {
            Label("削除", systemImage: "trash")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(query.isEmpty ? "マンダラートがありません" : "「\(query)」に一致するマンダラートはありません")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if query.isEmpty {
                Button("新規作成") {
                    try? MandalartFactory.create(title: "新規マンダラート", in: modelContext)
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
            }
        }
        .padding(.top, 80)
        .padding(.horizontal, 32)
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
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 4) {
                        if mandalart.pinned {
                            Image(systemName: "pin.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if mandalart.locked {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(6)
                }
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
