import SwiftUI
import SwiftData
import PhotosUI
import UIKit

/// 1 セル: 表示 + tap 操作 (drill or 編集要求) + 長押し context menu。
///
/// **タップ動作分岐**:
/// - 中心セル (position=4) → 編集要求 (= EditorView の Floating Bar を開く)
/// - 周辺セル (position 0-3, 5-8) で空 → 編集要求
/// - 周辺セル + 非空 → `onDrillRequest` 呼び出し (drill-down)
/// - ロック中 → 編集ブロック、ただし drill (= 閲覧 navigation) は許可
///
/// **編集 UI**: TextField はこの View 内には持たない。tap → `onEditRequest(cell)`
/// で EditorView 側の全画面 sheet (`EditingSheet` を `.fullScreenCover` で表示) を起動する。
/// 理由は iPhone Landscape で iOS 純正キーボードがエディター下半分を覆うため
/// (`docs/pitfalls.md` 参照)。
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
    /// ストックペースト先選択モード中かどうか。`true` のとき tap は drill / focus せず
    /// `onPasteTargetTapped` を発火する。
    let pasteMode: Bool
    let onPasteTargetTapped: ((Cell) -> Void)?
    /// セル単位の Export / Import を EditorView 側に通知する callback。
    /// Export はロック中も許可 (= 読み取り専用)、Import は !isLocked かつ cell != nil の時のみ表示。
    let onExportRequest: ((Cell) -> Void)?
    let onImportRequest: ((Cell) -> Void)?
    /// EditorView の Floating Bar が現在編集中の cell.id (nil = 非編集中)。
    /// このセルが対象なら border を accent color + 太線にして highlight する。
    let editingCellId: String?
    /// セル tap で編集要求を上位 EditorView に通知する callback。空 slot の場合は
    /// この View 側で lazy create した Cell を渡す。
    let onEditRequest: ((Cell) -> Void)?
    /// 入力済み中心セル tap で「親階層へ戻る」or「ホームへ戻る」を上位に通知。
    /// 中心 + 非空のときに発火 (ロック中も閲覧 navigation として許可)。
    /// 空中心 / 周辺セルでは未使用。
    let onCenterTapRequest: (() -> Void)?
    /// Dashboard → Editor 遷移時に渡される morph 完了までの待機時間 (ms)。
    /// この値分だけ全 cell の delay を後ろにずらすことで、morph 中は周辺セルが opacity 0 を維持。
    /// drill / drill-up / 並列ナビでは 0 が渡され、既存挙動と完全一致。
    let initialDelayMs: Int
    /// 中心セル (position=4) の外枠と Dashboard MandalartCard の外枠を matchedGeometryEffect で
    /// 紐付けるための Namespace。`nil` なら付与しない (= drill 後の grid 表示等で不要)。
    /// 中心以外の position では未使用。
    let convergeNamespace: Namespace.ID?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(FontConstants.levelStorageKey) private var fontLevel: Int = FontConstants.levelDefault
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
        onDrillRequest: ((Cell) -> Void)? = nil,
        pasteMode: Bool = false,
        onPasteTargetTapped: ((Cell) -> Void)? = nil,
        onExportRequest: ((Cell) -> Void)? = nil,
        onImportRequest: ((Cell) -> Void)? = nil,
        editingCellId: String? = nil,
        onEditRequest: ((Cell) -> Void)? = nil,
        onCenterTapRequest: (() -> Void)? = nil,
        initialDelayMs: Int = 0,
        convergeNamespace: Namespace.ID? = nil
    ) {
        self.cell = cell
        self.gridId = gridId
        self.position = position
        self.mandalart = mandalart
        self.transitionKind = transitionKind
        self.readOnly = readOnly
        self.hasChild = hasChild
        self.onDrillRequest = onDrillRequest
        self.pasteMode = pasteMode
        self.onPasteTargetTapped = onPasteTargetTapped
        self.onExportRequest = onExportRequest
        self.onImportRequest = onImportRequest
        self.editingCellId = editingCellId
        self.onEditRequest = onEditRequest
        self.onCenterTapRequest = onCenterTapRequest
        self.initialDelayMs = initialDelayMs
        self.convergeNamespace = convergeNamespace
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
    /// EditorView の Floating Bar が現在このセルを編集中かどうか。
    private var isEditing: Bool {
        guard let id = cell?.id, let editing = editingCellId else { return false }
        return id == editing
    }
    /// border の色。
    /// - 編集中: accent color で highlight
    /// - locked: ロック中バナー廃止 (2026-05-10) に伴い、枠線を muted gray にしてロック状態を視覚化
    /// - 通常: `Color.primary.opacity(0.4)`
    private var borderColor: Color {
        if isEditing { return Color.accentColor }
        if isLocked { return Color.primary.opacity(0.15) }
        return Color.primary.opacity(0.4)
    }

    /// セル背景色 (画像がない場合のみ): cell.color → preset / なければ desktop と同じ
    /// `bg-white dark:bg-neutral-900` トーン。
    private var cellBackground: Color {
        if let key = cell?.color, let preset = PresetColors.find(key) {
            return preset.backgroundColor(for: colorScheme)
        }
        return NeutralPalette.surfaceBackground
    }

    /// 中心/周辺で size/weight は分けず desktop と同一方針。中心強調は borderLineWidth (1.5pt) のみ。
    /// readOnly (= 9×9 inner) は base を 1/3 に縮小 (desktop typography.md と同じ)。
    private var effectiveFontSize: CGFloat {
        let base = readOnly ? LayoutConstants.cellNineByNineFontSize : LayoutConstants.cellBaseFontSize
        return base * FontConstants.scale(for: fontLevel)
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
                    if !(cell?.text ?? "").isEmpty {
                        Color.black.opacity(0.25)
                    }
                } else {
                    cellBackground
                }

                // `.strokeBorder` (= 内側塗り) で clipShape の影響を受けず borderLineWidth が visible 太さと一致する。
                // 旧 `.stroke + clipShape` だと外側半分が clip されて visible が半分になり、Dashboard card との対比で
                // 見た目が約 2 倍ズレていた (= clip なしの card と整合しなかった)。Constants 側で値も 3 → 1.5 に半減済み。
                RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius)
                    .strokeBorder(borderColor, lineWidth: borderLineWidth * (isEditing ? 1.5 : 1.0))

                // 表示専用 Text (= 編集は EditorView の Floating Bar 側で行う)。
                // 中心/周辺で size/weight は分けない (desktop typography.md 67-77 ミラー、中心強調は border のみ)。
                Text(cell?.text ?? "")
                    .multilineTextAlignment(.leading)
                    .font(.system(size: effectiveFontSize, weight: .regular))
                    .foregroundStyle(loadedImage != nil ? Color.white : Color.primary)
                    .padding(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                // 透明 overlay が全 tap を吸い、drill or 編集要求に分岐する。
                // readOnly では tap 自体を取らず、上位 view (9×9) の操作に流す。
                // count: 2 を先に宣言して double-tap → 入力済みセル編集を優先判定。
                if !readOnly {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { handleDoubleTap() }
                        .onTapGesture(count: 1) { handleTap() }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        // GeometryReader 内で `.frame()` + `.clipped()` で Image を正確に枠内サイズに固定済だが、
        // 念のため外側でも `.clipShape` を適用して角丸を確保。
        .clipShape(RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius))
        // Dashboard MandalartCard 外枠 ↔ Editor 中心セル外枠の morph (= desktop の Converge Overlay と同等)。
        // position=4 かつ namespace 提供時のみ付与。drill / parallel ナビでは namespace=nil で no-op。
        .matchedGeometryEffectIfAvailable(
            id: "card-\(mandalart.id)",
            in: convergeNamespace,
            condition: position == GridConstants.centerPosition
        )
        // drill / drill-up / 並列ナビ / 初回表示で stagger fade-in。
        // remount (= GridView3x3 が `.id(...)` で view identity を変える) ごとに onAppear が
        // 発火し、position と transitionKind から計算した delay 後に visible=true に補間。
        // X=C 連続セル (drill-down の中心) は init で既に visible=true なので no-op。
        .opacity(animatedVisible ? 1 : 0)
        .onAppear {
            guard !animatedVisible else { return }
            let delay = AnimationStagger.delay(for: position, kind: transitionKind, initialDelayMs: initialDelayMs)
            // Dashboard 由来 (initialDelayMs > 0) かつ中心セルは 1ms snap で morph 完了の同フレームに opacity 1。
            // desktop の `animation: orbit-fade-in 1ms ease-out CONVERGE_DURATION_MS both` と同等。
            let isCenterFromConverge = (initialDelayMs > 0) && (position == GridConstants.centerPosition)
            let duration = isCenterFromConverge ? 0.001 : Double(TimingConstants.animFadeMs) / 1000.0
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
        .onChange(of: cell?.imagePath) { _, newPath in
            // sync 経路 / context menu 経由の imagePath 変更を反映
            loadedImage = ImageStorage.loadImage(at: newPath)
        }
    }

    // MARK: - Tap / commit

    private func handleTap() {
        guard !readOnly else { return }
        // ペースト先選択モード中: cell が無ければ lazy create で Cell 行を作成してから渡す。
        // 新規作成直後の mandalart では周辺セルは空 slot (= cell == nil) のため、
        // この lazy create が無いと「周辺セルに paste できない」(中心セルだけ paste できる) 症状になる。
        if pasteMode {
            let target: Cell
            if let existing = cell {
                target = existing
            } else {
                let now = Date()
                let newCell = Cell(
                    gridId: gridId,
                    position: position,
                    text: "",
                    createdAt: now,
                    updatedAt: now
                )
                modelContext.insert(newCell)
                try? modelContext.save()
                target = newCell
            }
            onPasteTargetTapped?(target)
            return
        }
        // 周辺 + 非空: drill-down (既存)
        if shouldDrillOnTap, let c = cell {
            onDrillRequest?(c)
            return
        }
        // 中心 + 非空: drill-up (子グリッド) or ホームへ戻る (root)。desktop と同じ挙動。
        // ロック中も閲覧 navigation として許可。
        if isCenter && !isEmpty {
            onCenterTapRequest?()
            return
        }
        // ここまで来るのは「中心 + 空」or「周辺 + 空」 → 新規入力なので編集 sheet 起動。
        guard !isLocked else { return }
        let target: Cell = cell ?? lazyCreateEmptyCell()
        onEditRequest?(target)
    }

    /// double-tap: 入力済みセル (中心 / 周辺両方) の編集 sheet 起動。
    /// desktop の double-click parity。空セルは single tap で既に編集に入るので no-op。
    private func handleDoubleTap() {
        guard !readOnly, !isLocked else { return }
        guard !isEmpty, let c = cell else { return }
        onEditRequest?(c)
    }

    // MARK: - Context menu

    @State private var showImagePicker: Bool = false
    private var photosPickerBinding: Binding<Bool> {
        Binding(get: { showImagePicker }, set: { showImagePicker = $0 })
    }

    @ViewBuilder
    private var cellContextMenu: some View {
        // 編集 (= double-tap と同等の経路)。入力済み + 非ロックのとき最上部に表示。
        // 空セルは context menu 自体ほぼ出ないが念のため !isEmpty ガード。
        if !isLocked, let cell, !isEmpty {
            Button {
                onEditRequest?(cell)
            } label: {
                Label("編集", systemImage: "pencil")
            }
            Divider()
        }
        // Export は読み取り専用なのでロック中も許可。cell != nil の時に表示。
        // Import は !isLocked のときのみ。
        if let cell {
            Button {
                onExportRequest?(cell)
            } label: {
                Label("エクスポート", systemImage: "square.and.arrow.up")
            }
            if !isLocked {
                Button {
                    onImportRequest?(cell)
                } label: {
                    Label("ここにインポート", systemImage: "square.and.arrow.down")
                }
                Divider()
            }
        }
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

            // ストック追加: 非破壊なので空セル以外で常に有効。中心セルなら grid 全体 snapshot。
            Button {
                try? StockService.addToStock(cellId: cell.id, in: modelContext)
            } label: {
                Label("ストックに追加", systemImage: "tray.and.arrow.down")
            }
            .disabled(isEmpty)

            // ストックに移動 (cut): 元セル content クリア + 配下 sub-grids 削除を伴う破壊操作。
            // ロック中は context menu 自体が出ないので追加ガードは不要だが、空セル時は意味がないので disable。
            Button(role: .destructive) {
                try? StockService.moveCellToStock(cellId: cell.id, in: modelContext)
            } label: {
                Label("ストックに移動", systemImage: "tray.and.arrow.up")
            }
            .disabled(isEmpty)

            Divider()

            Button(role: .destructive) {
                clearContent(of: cell)
            } label: {
                Label("内容をクリア", systemImage: "eraser")
            }
        } else if !isLocked, cell == nil {
            // 空 slot: 画像追加 + ここにインポート (= lazy create で Cell を生成してから対応 callback)。
            // PhotosPicker は cell.imagePath への lazy 経路が既存実装にあるので showImagePicker で OK。
            // インポートは新規 Cell を save してから onImportRequest に渡す (= 空 slot にも paste 経路が通るように)。
            Button {
                showImagePicker = true
            } label: {
                Label("画像を追加", systemImage: "photo.badge.plus")
            }
            Button {
                let target = lazyCreateEmptyCell()
                onImportRequest?(target)
            } label: {
                Label("ここにインポート", systemImage: "square.and.arrow.down")
            }
        }
    }

    /// 空 slot 用に Cell 行を lazy create + save。stock paste mode の handleTap 内ロジックと同等。
    private func lazyCreateEmptyCell() -> Cell {
        let now = Date()
        let newCell = Cell(
            gridId: gridId,
            position: position,
            text: "",
            createdAt: now,
            updatedAt: now
        )
        modelContext.insert(newCell)
        try? modelContext.save()
        return newCell
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

private extension View {
    /// `condition` が true かつ `namespace` が非 nil のときだけ `matchedGeometryEffect` を付与する。
    /// SwiftUI で nil ガードする標準形 (Namespace.ID は optional だと直接渡せないため)。
    @ViewBuilder
    func matchedGeometryEffectIfAvailable(
        id: String,
        in namespace: Namespace.ID?,
        condition: Bool
    ) -> some View {
        if condition, let ns = namespace {
            self.matchedGeometryEffect(id: id, in: ns, anchor: .center)
        } else {
            self
        }
    }
}
