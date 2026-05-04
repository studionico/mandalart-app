import SwiftUI
import SwiftData

/// 1 セル: 表示 + tap 操作 (drill or inline edit) + commit。
///
/// **タップ動作分岐**:
/// - 中心セル (position=4) → 常に inline edit (root center は title 編集、child center は親 peripheral と X=C 共有編集)
/// - 周辺セル (position 0-3, 5-8) で空 → inline edit
/// - 周辺セル + 非空 → `onDrillRequest` 呼び出し (drill-down)
/// - ロック中 → 全操作無効
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
    /// 新規 child grid 作成 (= 書き込み) の抑制は EditorView 側 `handleDrill` で行う。
    private var shouldDrillOnTap: Bool {
        !isCenter && !isEmpty
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(uiColor: .secondarySystemBackground))
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
            // (空 TextField は hit area がゼロに近いので、overlay 経由でないと tap が
            // 中心以外のセルに届かない)
            if !isFocused {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { handleTap() }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .onChange(of: cell?.text) { _, newText in
            // sync で更新された場合、focus 中でなければローカル state を追従させる
            if !isFocused, let newText, newText != text {
                text = newText
            }
        }
    }

    private func handleTap() {
        guard !isLocked else { return }
        if shouldDrillOnTap, let c = cell {
            onDrillRequest?(c)
        } else {
            // 中心セル / 空 周辺セル → 編集モード
            isFocused = true
        }
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
}
