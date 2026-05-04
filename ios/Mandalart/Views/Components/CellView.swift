import SwiftUI
import SwiftData

/// Single cell: tap to edit, commit on focus loss / submit.
/// Lazy cell creation: empty cells (no row in DB) are passed as `cell: nil`,
/// and a new Cell is INSERTed only when the user types something.
struct CellView: View {
    let cell: Cell?
    let gridId: String
    let position: Int
    let mandalart: Mandalart

    @Environment(\.modelContext) private var modelContext
    @State private var text: String
    @FocusState private var isFocused: Bool

    init(cell: Cell?, gridId: String, position: Int, mandalart: Mandalart) {
        self.cell = cell
        self.gridId = gridId
        self.position = position
        self.mandalart = mandalart
        _text = State(initialValue: cell?.text ?? "")
    }

    private var isCenter: Bool { position == GridConstants.centerPosition }
    private var isLocked: Bool { mandalart.locked }
    /// Root center cell mirrors mandalart.title.
    private var isRootCell: Bool { cell?.id == mandalart.rootCellId }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(uiColor: .secondarySystemBackground))
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.primary.opacity(0.4), lineWidth: isCenter ? 2 : 1)
            TextField("", text: $text, axis: .vertical)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .font(.system(size: isCenter ? 14 : 12, weight: isCenter ? .semibold : .regular))
                .padding(6)
                .focused($isFocused)
                .disabled(isLocked)
                .onSubmit { commit() }
                .onChange(of: isFocused) { _, nowFocused in
                    if !nowFocused { commit() }
                }
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onChange(of: cell?.text) { _, newText in
            // Update from sync (other device edited): refresh local state if not focused.
            if !isFocused, let newText, newText != text {
                text = newText
            }
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
