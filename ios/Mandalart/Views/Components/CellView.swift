import SwiftUI
import SwiftData
import PhotosUI
import UIKit

/// 1 セル: 表示 + tap 操作 (drill or inline edit) + commit + 長押し context menu。
///
/// **タップ動作分岐**:
/// - 中心セル (position=4) → 常に inline edit (root center は title 編集、child center は親 peripheral と X=C 共有編集)
/// - 周辺セル (position 0-3, 5-8) で空 → inline edit
/// - 周辺セル + 非空 → `onDrillRequest` 呼び出し (drill-down)
/// - ロック中 → 編集ブロック、ただし drill (= 閲覧 navigation) は許可
///
/// **長押し**: cell が存在 + 非ロック中なら context menu を表示
/// (色プリセット 10 + 画像追加 / 削除 + 内容クリア)。
///
/// **画像**: PhotosPicker で写真選択 → [`ImageStorage`](../../Services/ImageStorage.swift) で
/// JPEG 圧縮 (最大辺 1200pt) して Application Support/images/ に保存、`Cell.imagePath` に
/// 相対パスを記録。**ローカル保存のみで cross-device 同期されない**は既知の制約 (desktop と同じ仕様)。
struct CellView: View {
    let cell: Cell?
    let gridId: String
    let position: Int
    let mandalart: Mandalart
    let onDrillRequest: ((Cell) -> Void)?
    /// drill / drill-up / 並列ナビ / 初回表示それぞれで stagger 順序を切替えるための種別。
    /// `onAppear` 時に `AnimationStagger.delay(...)` に渡して visible: false → true を補間。
    let transitionKind: DrillTransitionKind
    /// readOnly mode (= 9×9 view 内の inner 3×3)。tap / longPress / context menu 全 NOOP、focus 不可。
    let readOnly: Bool
    /// このセルが drill 元として子グリッドを持つか (= peripheral で既に drill 済)。border 太さ出し分けに使用。
    /// 中心セル / 空セル / readOnly では未使用。
    let hasChild: Bool

    @Environment(\.modelContext) private var modelContext
    @Environment(\.colorScheme) private var colorScheme
    @State private var text: String
    @FocusState private var isFocused: Bool
    @State private var photoItem: PhotosPickerItem?
    @State private var loadedImage: UIImage?
    /// drill アニメ用 opacity 補間。`onAppear` で stagger delay 経過後に true に切替。
    @State private var animatedVisible: Bool = false

    init(
        cell: Cell?,
        gridId: String,
        position: Int,
        mandalart: Mandalart,
        transitionKind: DrillTransitionKind = .initial,
        readOnly: Bool = false,
        hasChild: Bool = false,
        onDrillRequest: ((Cell) -> Void)? = nil
    ) {
        self.cell = cell
        self.gridId = gridId
        self.position = position
        self.mandalart = mandalart
        self.transitionKind = transitionKind
        self.readOnly = readOnly
        self.hasChild = hasChild
        self.onDrillRequest = onDrillRequest
        _text = State(initialValue: cell?.text ?? "")
        _loadedImage = State(initialValue: ImageStorage.loadImage(at: cell?.imagePath))
        // stagger 順序に含まれない position は X=C 連続セル (= drill-down 中心) なので
        // 最初から visible=true。fade-in 動作なし、ちらつきも防げる。
        let inSequence = AnimationStagger.staggerIndex(for: position, kind: transitionKind) != nil
        _animatedVisible = State(initialValue: !inSequence)
    }

    private var isCenter: Bool { position == GridConstants.centerPosition }
    private var isLocked: Bool { mandalart.locked }
    private var isRootCell: Bool { cell?.id == mandalart.rootCellId }
    private var isEmpty: Bool {
        (cell?.text.isEmpty ?? true) && (cell?.imagePath == nil)
    }
    /// drill 経路 (周辺 + 非空)。**ロック中も drill は許可** (= 閲覧用の階層 navigation)。
    /// readOnly mode (= 9×9 view inner) では drill しない。
    private var shouldDrillOnTap: Bool {
        !readOnly && !isCenter && !isEmpty
    }

    /// セル背景色 (画像がない場合のみ): cell.color → preset / なければ desktop と同じ
    /// `bg-white dark:bg-neutral-900` トーン。
    private var cellBackground: Color {
        if let key = cell?.color, let preset = PresetColors.find(key) {
            return preset.backgroundColor(for: colorScheme)
        }
        return NeutralPalette.surfaceBackground
    }

    /// 中心 / 周辺 / 子あり / readOnly に応じた border 太さ。
    /// readOnly (= 9×9 view 内の inner) は中心 1pt / 周辺 1pt で hairline 回避。
    private var borderLineWidth: CGFloat {
        if readOnly {
            return LayoutConstants.cellNineByNineInnerBorder
        }
        if isCenter {
            return LayoutConstants.cellCenterBorder
        }
        return hasChild
            ? LayoutConstants.cellPeripheralWithChildBorder
            : LayoutConstants.cellPeripheralBorder
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // 背景: 画像 or preset color
                if let img = loadedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                    // テキストありの場合は半透明黒オーバーレイで読みやすく
                    if !text.isEmpty {
                        Color.black.opacity(0.25)
                    }
                } else {
                    cellBackground
                }

                RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius)
                    .stroke(Color.primary.opacity(0.4), lineWidth: borderLineWidth)

                // TextField は常時 render (focus binding を機能させるため)
                TextField("", text: $text, axis: .vertical)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .font(.system(size: isCenter ? 14 : 12, weight: isCenter ? .semibold : .regular))
                    .foregroundStyle(loadedImage != nil ? Color.white : Color.primary)
                    .padding(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .focused($isFocused)
                    .disabled(isLocked || readOnly)
                    .allowsHitTesting(isFocused && !readOnly)
                    .onSubmit { commit() }
                    .onChange(of: isFocused) { _, nowFocused in
                        if !nowFocused { commit() }
                    }

                // 編集モード以外では透明 overlay が全 tap を吸い、drill or focus に分岐する。
                // readOnly では tap 自体を取らず、上位 view (9×9) の操作に流す。
                if !isFocused && !readOnly {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { handleTap() }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        // GeometryReader 内で `.frame()` + `.clipped()` で Image を正確に枠内サイズに固定済だが、
        // 念のため外側でも `.clipShape` を適用して角丸を確保。
        .clipShape(RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius))
        // drill / drill-up / 並列ナビ / 初回表示で stagger fade-in。
        // remount (= GridView3x3 が `.id(...)` で view identity を変える) ごとに onAppear が
        // 発火し、position と transitionKind から計算した delay 後に visible=true に補間。
        // X=C 連続セル (drill-down の中心) は init で既に visible=true なので no-op。
        .opacity(animatedVisible ? 1 : 0)
        .onAppear {
            guard !animatedVisible else { return }
            let delay = AnimationStagger.delay(for: position, kind: transitionKind)
            let duration = Double(TimingConstants.animFadeMs) / 1000.0
            withAnimation(.easeOut(duration: duration).delay(delay)) {
                animatedVisible = true
            }
        }
        .contextMenu { if !readOnly { cellContextMenu } }
        .photosPicker(
            isPresented: photosPickerBinding,
            selection: $photoItem,
            matching: .images
        )
        .onChange(of: photoItem) { _, newItem in
            guard let newItem else { return }
            Task {
                await handlePhotoSelection(newItem)
                photoItem = nil
            }
        }
        .onChange(of: cell?.text) { _, newText in
            if !isFocused, let newText, newText != text {
                text = newText
            }
        }
        .onChange(of: cell?.imagePath) { _, newPath in
            // sync 経路 / context menu 経由の imagePath 変更を反映
            loadedImage = ImageStorage.loadImage(at: newPath)
        }
    }

    // MARK: - Tap / commit

    private func handleTap() {
        guard !readOnly else { return }
        if shouldDrillOnTap, let c = cell {
            onDrillRequest?(c)
            return
        }
        guard !isLocked else { return }
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

    @State private var showImagePicker: Bool = false
    private var photosPickerBinding: Binding<Bool> {
        Binding(get: { showImagePicker }, set: { showImagePicker = $0 })
    }

    @ViewBuilder
    private var cellContextMenu: some View {
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

            Button {
                showImagePicker = true
            } label: {
                Label(cell.imagePath == nil ? "画像を追加" : "画像を変更",
                      systemImage: "photo.badge.plus")
            }

            if cell.imagePath != nil {
                Button(role: .destructive) {
                    clearImage(of: cell)
                } label: {
                    Label("画像を削除", systemImage: "photo.badge.xmark")
                }
            }

            Divider()

            Button(role: .destructive) {
                clearContent(of: cell)
            } label: {
                Label("内容をクリア", systemImage: "eraser")
            }
        } else if !isLocked, cell == nil {
            // 空 slot でも画像追加だけは出す (lazy create で cell を生成)
            Button {
                showImagePicker = true
            } label: {
                Label("画像を追加", systemImage: "photo.badge.plus")
            }
        }
    }

    private func applyColor(_ key: String?, to cell: Cell) {
        cell.color = key
        cell.updatedAt = Date()
        try? modelContext.save()
    }

    private func clearContent(of cell: Cell) {
        if let path = cell.imagePath {
            ImageStorage.deleteImage(at: path)
        }
        cell.text = ""
        cell.color = nil
        cell.imagePath = nil
        cell.updatedAt = Date()
        text = ""
        loadedImage = nil
        if isRootCell {
            mandalart.title = ""
            mandalart.updatedAt = Date()
        }
        try? modelContext.save()
    }

    private func clearImage(of cell: Cell) {
        if let path = cell.imagePath {
            ImageStorage.deleteImage(at: path)
        }
        cell.imagePath = nil
        cell.updatedAt = Date()
        loadedImage = nil
        try? modelContext.save()
    }

    // MARK: - Photo selection

    /// PhotosPicker の選択結果を受けて、画像を圧縮保存し cell.imagePath に紐付け。
    /// cell が未生成 (lazy slot) の場合はここで先に Cell row を作る。
    private func handlePhotoSelection(_ item: PhotosPickerItem) async {
        guard !isLocked else { return }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            print("[cell] PhotosPicker loadTransferable failed")
            return
        }

        let now = Date()
        let target: Cell
        if let existing = cell {
            target = existing
        } else {
            // lazy create
            let newCell = Cell(
                gridId: gridId,
                position: position,
                text: "",
                createdAt: now,
                updatedAt: now
            )
            modelContext.insert(newCell)
            target = newCell
        }

        do {
            // 古い画像があれば削除してから新規保存
            if let oldPath = target.imagePath {
                ImageStorage.deleteImage(at: oldPath)
            }
            let relPath = try ImageStorage.saveImage(data: data, cellId: target.id)
            target.imagePath = relPath
            target.updatedAt = Date()
            try modelContext.save()
            loadedImage = ImageStorage.loadImage(at: relPath)
        } catch {
            print("[cell] image save failed:", error)
        }
    }
}
