import SwiftUI
import SwiftData

/// ゴミ箱画面: soft delete 済の Mandalart 一覧 + 復元 / 完全削除。
///
/// desktop の [`TrashDialog.tsx`](../../../desktop/src/components/dashboard/TrashDialog.tsx) と
/// 等価な機能を iOS で提供する。
///
/// - **復元** (`restore`): `deletedAt = nil` に戻して dashboard に戻す
/// - **完全削除** (`permanentDelete`): cells / grids / mandalart を物理削除 + cloud cascade。
///   2 段階確認 (.alert) で誤操作防止。Tauri の `window.confirm` 不可問題は iOS には無いので
///   SwiftUI 標準 alert で OK
/// - **すべて削除** (`deleteAll`): ゴミ箱内の全マンダラートを一括完全削除。1 段階 .alert 確認。
///   desktop の `handleDeleteAll` 相当 (StockTab の「すべて削除」と同じ native pattern)
struct TrashView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(
        filter: #Predicate<Mandalart> { $0.deletedAt != nil },
        sort: [SortDescriptor(\.deletedAt, order: .reverse)]
    )
    private var deletedMandalarts: [Mandalart]

    @State private var pendingPermanentDelete: Mandalart?
    @State private var showDeleteAllAlert = false

    var body: some View {
        NavigationStack {
            content
                .background(NeutralPalette.rootBackground.ignoresSafeArea())
                .navigationTitle("ゴミ箱")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("閉じる") { dismiss() }
                    }
                }
                .alert(
                    "完全削除しますか?",
                    isPresented: Binding(
                        get: { pendingPermanentDelete != nil },
                        set: { if !$0 { pendingPermanentDelete = nil } }
                    ),
                    presenting: pendingPermanentDelete
                ) { m in
                    Button("削除", role: .destructive) {
                        let target = m
                        Task {
                            try? await MandalartFactory.permanentDelete(target, in: modelContext)
                        }
                    }
                    Button("キャンセル", role: .cancel) { }
                } message: { m in
                    Text("「\(m.title)」を完全に削除します。この操作は取り消せません。")
                }
                .alert("すべて削除しますか?", isPresented: $showDeleteAllAlert) {
                    Button("削除", role: .destructive) { deleteAll() }
                    Button("キャンセル", role: .cancel) { }
                } message: {
                    Text("\(deletedMandalarts.count) 件をすべて完全に削除します。この操作は取り消せません。")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if deletedMandalarts.isEmpty {
            emptyState
        } else {
            List {
                Section {
                    ForEach(deletedMandalarts) { m in
                        row(for: m)
                    }
                } header: {
                    HStack {
                        Spacer()
                        Button(role: .destructive) {
                            showDeleteAllAlert = true
                        } label: {
                            Text("すべて削除 (\(deletedMandalarts.count))")
                                .font(.caption2)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.red)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "trash")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("ゴミ箱は空です")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func row(for m: Mandalart) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(m.title.isEmpty ? "(無題)" : m.title)
                    .font(.body)
                    .lineLimit(1)
                if let deletedAt = m.deletedAt {
                    Text("削除: \(deletedAt.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button {
                try? MandalartFactory.restore(m, in: modelContext)
            } label: {
                Label("復元", systemImage: "arrow.uturn.backward")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.bordered)
            .tint(.primary)

            Button(role: .destructive) {
                pendingPermanentDelete = m
            } label: {
                Label("完全削除", systemImage: "trash.fill")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.bordered)
        }
    }

    // MARK: - Actions

    /// ゴミ箱内の全マンダラートを一括完全削除する (desktop の `handleDeleteAll` 相当)。
    /// ロック中マンダラートは `softDelete` 段階で弾かれるためそもそもゴミ箱に入らない
    /// (= ここに到達する対象は全て unlocked)。個別失敗は握りつぶす
    /// (= desktop の `Promise.allSettled` 相当) ことで残りの削除を継続する。
    private func deleteAll() {
        let targets = deletedMandalarts
        Task {
            for m in targets {
                try? await MandalartFactory.permanentDelete(m, in: modelContext)
            }
        }
    }
}
