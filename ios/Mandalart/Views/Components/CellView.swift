import SwiftUI
import SwiftData

/// 1 セル: 表示 + tap 操作 (drill or inline edit) + commit + 長押し context menu。
///
/// **タップ動作分岐**:
/// - 中心セル (position=4) → 常に inline edit (root center は title 編集、child center は親 peripheral と X=C 共有編集)
/// - 周辺セル (position 0-3, 5-8) で空 → inline edit
/// - 周辺セル + 非空 → `onDrillRequest` 呼び出し (drill-down)
/// - ロック中 → 全操作無効
///
/// **長押し**: cell が存在 + 非ロック中なら context menu を表示 (色プリセット 10 + クリア)。
///
/// **実装注意**: TextField を `if isFocused` で render 切替すると `.focused` binding が
/// 反映されない (= 初回タップで focus が乗らない) ので、TextField は **常時 render** し、
/// drill 用の透明 overlay で tap を上書きする方式を採用。
struct CellView: View {
    let cell: Cell?
    let gridId: String
    let position: Int
    let mandalart: Mandalart
    let onDrillRequest: ((Cell) -> Void)?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.colorScheme) private var colorScheme
    @State private var text: String
    @FocusState private var isFocused: Bool

    init(
        cell: Cell?,
        gridId: String,
        position: Int,
        mandalart: Mandalart,
        onDrillRequest: ((Cell) -> Void)? = nil
    ) {
        self.cell = cell
        self.gridId = gridId
        self.position = position
        self.mandalart = mandalart
        self.onDrillRequest = onDrillRequest
        _text = State(initialValue: cell?.text ?? "")
    }

    private var isCenter: Bool { position == GridConstants.centerPosition }
    private var isLocked: Bool { mandalart.locked }
    /// root center cell かどうか (= mandalart.rootCellId と一致)。
    private var isRootCell: Bool { cell?.id == mandalart.rootCellId }
    private var isEmpty: Bool {
        (cell?.text.isEmpty ?? true) && (cell?.imagePath == nil)
    }
    /// drill 経路 (周辺 + 非空)。**ロック中も drill は許可** (= 閲覧用の階層 navigation)。
    private var shouldDrillOnTap: Bool {
        !isCenter && !isEmpty
    }

    /// セル背景色: cell.color (preset key) があれば該当 PresetColor、なければ system 既定色。
    private var cellBackground: Color {
        if let key = cell?.color, let preset = PresetColors.find(key) {
            return preset.backgroundColor(for: colorScheme)
        }
        return Color(uiColor: .secondarySystemBackground)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(cellBackground)
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.primary.opacity(0.4), lineWidth: isCenter ? 2 : 1)

            // TextField は常時 render (focus binding を機能させるため)
            // 編集中以外は hit テスト無効にして、上位 tap overlay に処理を委ねる
            TextField("", text: $text, axis: .vertical)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .font(.system(size: isCenter ? 14 : 12, weight: isCenter ? .semibold : .regular))
                .padding(6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .focused($isFocused)
                .disabled(isLocked)
                .allowsHitTesting(isFocused)
                .onSubmit { commit() }
                .onChange(of: isFocused) { _, nowFocused in
                    if !nowFocused { commit() }
                }

            // 編集モード以外では透明 overlay が全 tap を吸い、drill or focus に分岐する。
            if !isFocused {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { handleTap() }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .contextMenu { cellContextMenu }
        .onChange(of: cell?.text) { _, newText in
            // sync で更新された場合、focus 中でなければローカル state を追従させる
            if !isFocused, let newText, newText != text {
                text = newText
            }
        }
    }

    private func handleTap() {
        // ロック中でも drill (= 閲覧用 navigation) は許可。edit のみブロックする。
        if shouldDrillOnTap, let c = cell {
            onDrillRequest?(c)
            return
        }
        guard !isLocked else { return }
        // 中心セル / 空 周辺セル → 編集モード
        isFocused = true
    }

    private func commit() {
        guard !isLocked else { return }
        let now = Date()
        if let existing = cell {
            guard existing.text != text else { return }
            existing.text = text
            existing.updatedAt = now
        } else if !text.isEmpty {
            let newCell = Cell(
                gridId: gridId,
                position: position,
                text: text,
                createdAt: now,
                updatedAt: now
            )
            modelContext.insert(newCell)
        } else {
            return
        }
        if isRootCell {
            mandalart.title = text
            mandalart.updatedAt = now
        }
        try? modelContext.save()
    }

    // MARK: - Context menu

    @ViewBuilder
    private var cellContextMenu: some View {
        // ロック中 / 行未生成 (= lazy slot) の場合はメニュー項目を一切出さない。
        // SwiftUI は空 contextMenu を long-press で表示しないので結果として noop になる。
        if !isLocked, let cell {
            Menu {
                ForEach(PresetColors.all) { preset in
                    Button {
                        applyColor(preset.key, to: cell)
                    } label: {
                        if cell.color == preset.key {
                            Label(preset.label, systemImage: "checkmark")
                        } else {
                            Text(preset.label)
                        }
                    }
                }
                if cell.color != nil {
                    Divider()
                    Button("色をクリア") {
                        applyColor(nil, to: cell)
                    }
                }
            } label: {
                Label("色", systemImage: "paintpalette")
            }

            Divider()

            Button(role: .destructive) {
                clearContent(of: cell)
            } label: {
                Label("内容をクリア", systemImage: "eraser")
            }
        }
    }

    private func applyColor(_ key: String?, to cell: Cell) {
        cell.color = key
        cell.updatedAt = Date()
        try? modelContext.save()
    }

    private func clearContent(of cell: Cell) {
        cell.text = ""
        cell.color = nil
        cell.imagePath = nil
        cell.updatedAt = Date()
        text = ""
        if isRootCell {
            mandalart.title = ""
            mandalart.updatedAt = Date()
        }
        try? modelContext.save()
    }
}
