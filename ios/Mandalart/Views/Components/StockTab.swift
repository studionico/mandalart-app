import SwiftUI
import SwiftData

/// ストックタブ: pasteboard 的に保存されたセル snapshot 一覧を表示する。
///
/// desktop の [`StockTab.tsx`](../../../desktop/src/components/editor/StockTab.tsx) と等価:
/// - 3 列の正方形タイル grid
/// - 各タイル: テキスト or 画像 thumbnail + 「ペースト」「削除」ボタン
/// - 上部に「すべて削除」(.alert で 1 段階確認)
/// - 空状態は "ストックは空です"
///
/// **drag-drop は iPhone Landscape の hit-test 不安定さを避けるため未実装**。
/// paste は親 (EditorView) に `onPasteRequest` callback を渡し、上位で「選択モード + cell tap」で確定する。
struct StockTab: View {
    @Environment(\.modelContext) private var modelContext

    @Query(sort: [SortDescriptor(\StockItem.createdAt, order: .reverse)])
    private var items: [StockItem]

    /// ペーストボタンが押されたときに呼ばれる callback (= EditorView がペースト先選択モードに入る)。
    let onPasteRequest: (StockItem) -> Void

    /// 現在のペースト対象アイテム id (= EditorView が保持する選択モード state)。
    /// nil のときはハイライトなし、一致するアイテムだけ強調表示。
    let pasteRequestedItemId: String?

    @State private var showDeleteAllAlert = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if items.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6),
                        ],
                        spacing: 6
                    ) {
                        ForEach(items) { item in
                            tile(for: item)
                        }
                    }
                    .padding(.horizontal, 2)
                }
            }
        }
        .alert("すべて削除しますか?", isPresented: $showDeleteAllAlert) {
            Button("削除", role: .destructive) { deleteAll() }
            Button("キャンセル", role: .cancel) { }
        } message: {
            Text("ストック内の \(items.count) 件をすべて削除します。この操作は取り消せません。")
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("ストック")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            if !items.isEmpty {
                Button(role: .destructive) {
                    showDeleteAllAlert = true
                } label: {
                    Text("すべて削除 (\(items.count))")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.title3)
                .foregroundStyle(.secondary)
            Text("ストックは空です")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 24)
    }

    // MARK: - Tile

    @ViewBuilder
    private func tile(for item: StockItem) -> some View {
        let preview = previewContent(for: item)
        let isPasteSelected = (pasteRequestedItemId == item.id)
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(NeutralPalette.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            isPasteSelected ? Color.accentColor : Color.primary.opacity(0.08),
                            lineWidth: isPasteSelected ? 2 : 0.5
                        )
                )

            // 中央: 画像 (テキスト空のときだけ) or テキスト
            if let image = preview.image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            if !preview.text.isEmpty {
                Text(preview.text)
                    .font(.system(size: 10))
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .padding(4)
                    .foregroundStyle(.primary)
            }

            // 右上: paste / delete アクション (常時表示、iOS は hover 概念がないので)
            VStack {
                HStack(spacing: 4) {
                    Spacer()
                    Button {
                        onPasteRequest(item)
                    } label: {
                        Image(systemName: "arrow.down.to.line")
                            .font(.system(size: 10, weight: .semibold))
                            .frame(width: 16, height: 16)
                            .background(Color.primary.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)

                    Button(role: .destructive) {
                        try? StockService.deleteStockItem(item, in: modelContext)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                            .frame(width: 16, height: 16)
                            .background(Color.primary.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(4)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    // MARK: - Preview decoding

    /// snapshot JSON から表示用 (text / image) を取り出す。
    /// パース失敗時は安全に空文字列を返す。
    private func previewContent(for item: StockItem) -> (text: String, image: UIImage?) {
        guard let data = item.snapshot.data(using: .utf8),
              let snap = try? JSONDecoder().decode(CellSnapshot.self, from: data) else {
            return ("", nil)
        }
        let text = snap.cell.text
        // テキストが空の場合のみ画像を表示する (= desktop と同じ優先度)
        let image: UIImage? = text.isEmpty ? ImageStorage.loadImage(at: snap.cell.imagePath) : nil
        return (text, image)
    }

    // MARK: - Actions

    private func deleteAll() {
        for item in items {
            try? StockService.deleteStockItem(item, in: modelContext)
        }
    }
}
