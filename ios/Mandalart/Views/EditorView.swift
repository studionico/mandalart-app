import SwiftUI
import SwiftData
import UniformTypeIdentifiers

/// Landscape 2-pane editor (NavigationStack なし、floating control overlay でスペース最大化):
/// - 左ペイン: 3×3 グリッド (正方形、垂直中央)
/// - 右ペイン: breadcrumb + メモ プレースホルダ
/// - 左上 floating: home (ダッシュボードへ戻る) + ロック indicator (ロック時のみ)
struct EditorView: View {
    let mandalartId: String
    let onBack: () -> Void

    @Environment(\.modelContext) private var modelContext
    /// 9×9 view を実用可能な画面幅か (= iPad regular)。compact (iPhone / iPad Split View 1/3 等)
    /// では grid セルが 14pt 級まで縮小して読めなくなるため非表示にする。
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Query private var mandalarts: [Mandalart]
    @Query private var grids: [Grid]
    @Query private var allCells: [Cell]

    @State private var currentGridId: String?
    @State private var breadcrumb: [BreadcrumbItem] = []
    @State private var didBootstrap: Bool = false
    @State private var showLockHint: Bool = false
    @State private var parallelGrids: [Grid] = []
    @State private var parallelIndex: Int = 0
    /// 直近の grid 遷移種別。drill / drill-up / 並列ナビ / 初回表示で stagger 順序を
    /// 切替えるため、各 handler 末尾でこの値を更新 → GridView3x3 → CellView へ伝搬。
    @State private var lastTransitionKind: DrillTransitionKind = .initial
    /// 3×3 編集モード / 9×9 俯瞰モード。toggle ボタンで切替。9×9 中は edit / drill 全 NOOP。
    @State private var viewMode: EditorViewMode = .grid3x3
    /// 右ペインのタブ (= メモ / ストック)。
    @State private var rightPaneTab: RightPaneTab = .memo
    /// ストックペースト先選択モード中の対象 stock item id。nil = 通常モード。
    @State private var stockPasteTargetItemId: String?

    // Cell 単位の Export 状態 (= cell context menu → format dialog → .fileExporter)
    /// Format 選択ダイアログの対象 cell。`presenting:` に渡す。
    @State private var cellExportTarget: Cell?
    @State private var exportDocument: MandalartExportDocument?
    @State private var exportFilename: String = ""
    @State private var exportContentType: UTType = .json
    @State private var showFileExporter = false
    // Cell 単位の Import 状態 (= cell context menu → fileImporter → importIntoCell)
    @State private var pendingImportCellId: String?
    @State private var showCellFileImporter = false
    /// Export / Import の結果フィードバック alert。
    @State private var transferAlert: TransferAlertState?

    /// Floating 編集 Bar の対象 cell.id (nil = 非編集中)。Bar の表示 / scrim / CellView highlight に連動。
    /// Landscape iOS 純正キーボードがエディター下半分を覆う問題への対策で、編集は CellView の inline
    /// TextField ではなく画面最上部の Floating Bar に集約している。
    @State private var editingCellId: String?
    /// Floating Bar の TextField と双方向 bind する draft text。`commitEditing()` で SwiftData 反映、
    /// `cancelEditing()` で破棄。
    @State private var editingDraft: String = ""

    /// 9×9 view が実用可能かどうか (horizontalSizeClass == .regular の時のみ)。
    /// iPhone / iPad compact ではトグルボタン非表示 + viewMode 強制 .grid3x3。
    private var nineByNineSupported: Bool {
        horizontalSizeClass == .regular
    }

    init(mandalartId: String, onBack: @escaping () -> Void) {
        self.mandalartId = mandalartId
        self.onBack = onBack
        _mandalarts = Query(filter: #Predicate<Mandalart> { $0.id == mandalartId })
        _grids = Query(
            filter: #Predicate<Grid> { $0.mandalartId == mandalartId && $0.deletedAt == nil },
            sort: [SortDescriptor(\Grid.sortOrder)]
        )
        _allCells = Query(
            filter: #Predicate<Cell> { $0.deletedAt == nil }
        )
    }

    private var mandalart: Mandalart? { mandalarts.first }

    private var currentGrid: Grid? {
        if let id = currentGridId {
            if let g = grids.first(where: { $0.id == id }) {
                return g
            }
            // @Query 反映遅延 fallback: 直前に context.insert したばかりの新 grid (= 並列追加直後)
            // は @Query にまだ載っていないので context から直接引く
            let descriptor = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.id == id && $0.deletedAt == nil }
            )
            if let g = (try? modelContext.fetch(descriptor))?.first {
                return g
            }
        }
        return grids.first(where: { $0.parentCellId == nil })
    }

    var body: some View {
        Group {
            if let m = mandalart, let grid = currentGrid {
                // root GR で leading safe inset を **ignoreSafeArea 適用前に** 捕獲。
                // この値を content() に渡し、ZStack 拡張で広がった分の補正計算に使う。
                GeometryReader { rootGeo in
                    let capturedLeadingInset = rootGeo.safeAreaInsets.leading
                    VStack(spacing: 0) {
                        if m.locked {
                            lockBanner
                        }
                        if stockPasteTargetItemId != nil {
                            stockPasteBanner
                        }
                        ZStack(alignment: .topLeading) {
                            content(
                                mandalart: m,
                                grid: grid,
                                capturedLeadingInset: capturedLeadingInset
                            )
                            .onAppear { bootstrapIfNeeded(mandalart: m) }

                            // 左上 floating home button: ZStack 拡張領域 (= 物理画面左端付近) に
                            // 配置。padding 8pt で物理端から少し内側、top 20pt で grid 上端と
                            // 視覚的に被らない位置。
                            Button(action: onBack) {
                                Image(systemName: "house.fill")
                                    .font(.system(size: 18))
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(.ultraThinMaterial, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .padding(.leading, 32)
                            .padding(.top, 20)


                            // 右上 floating 9×9 / 3×3 toggle ボタン。iPad regular のみ表示。
                            // iPhone / iPad compact (Split View 1/3 等) では grid セルが小さすぎる
                            // ため非表示 + viewMode は .grid3x3 固定。
                            if nineByNineSupported {
                                Button {
                                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                        viewMode = viewMode == .grid3x3 ? .grid9x9 : .grid3x3
                                    }
                                } label: {
                                    Text(viewMode == .grid3x3 ? "9×9" : "3×3")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .foregroundStyle(.primary)
                                        .frame(width: 56, height: 36)
                                        .background(.ultraThinMaterial, in: Capsule())
                                }
                                .buttonStyle(.plain)
                                .frame(maxWidth: .infinity, alignment: .topTrailing)
                                .padding(.trailing, 16)
                                .padding(.top, 20)
                                .accessibilityLabel(viewMode == .grid3x3 ? "9×9 ビューに切替" : "3×3 ビューに戻る")
                            }

                        }
                        .onChange(of: horizontalSizeClass) { _, newClass in
                            // iPad で Split View を縮小して compact に変わった場合、
                            // 9×9 中なら 3×3 へ強制復帰 (= ボタンが消えてユーザーが戻れなくなるのを防止)
                            if newClass != .regular, viewMode != .grid3x3 {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                    viewMode = .grid3x3
                                }
                            }
                        }
                        .ignoresSafeArea(.container, edges: .leading)
                    }
                }
            } else {
                Text("マンダラートが見つかりません")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .alert("ロック中のマンダラート", isPresented: $showLockHint) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("編集するにはダッシュボードに戻り、カードを長押しして「ロックを外す」を選んでください。")
        }
        .confirmationDialog(
            "エクスポート形式",
            isPresented: Binding(
                get: { cellExportTarget != nil },
                set: { if !$0 { cellExportTarget = nil } }
            ),
            presenting: cellExportTarget
        ) { c in
            Button(ExportFormat.json.label) { startCellExport(cell: c, format: .json) }
            Button(ExportFormat.markdown.label) { startCellExport(cell: c, format: .markdown) }
            Button(ExportFormat.indentText.label) { startCellExport(cell: c, format: .indentText) }
            Button("キャンセル", role: .cancel) { cellExportTarget = nil }
        } message: { c in
            Text("「\(c.text.isEmpty ? "(空)" : c.text)」配下をエクスポート")
        }
        .fileExporter(
            isPresented: $showFileExporter,
            document: exportDocument,
            contentType: exportContentType,
            defaultFilename: exportFilename
        ) { result in
            handleExportResult(result)
        }
        .fileImporter(
            isPresented: $showCellFileImporter,
            allowedContentTypes: [.json, .plainText, UTType(filenameExtension: "md") ?? .plainText],
            allowsMultipleSelection: false
        ) { result in
            handleCellImportResult(result)
        }
        .alert(
            transferAlert?.title ?? "",
            isPresented: Binding(
                get: { transferAlert != nil },
                set: { if !$0 { transferAlert = nil } }
            ),
            presenting: transferAlert
        ) { _ in
            Button("OK", role: .cancel) { transferAlert = nil }
        } message: { state in
            Text(state.message)
        }
        // セル編集の全画面 sheet (Landscape キーボード覆い対策)。
        // NavigationStack + TextField の中で iOS 自動 keyboard avoidance が効く。
        .fullScreenCover(isPresented: Binding(
            get: { editingCellId != nil },
            set: { if !$0 { editingCellId = nil; editingDraft = "" } }
        )) {
            EditingSheet(
                title: "セルを編集",
                text: $editingDraft,
                multiline: false,
                onCancel: { cancelEditing() },
                onCommit: { commitEditing() }
            )
        }
        // editor 全体背景を desktop の `bg-neutral-50 dark:bg-neutral-950` トーンに揃える。
        // safe area 外まで塗りつぶして status bar / home indicator 周辺の透過を防止。
        .background(NeutralPalette.rootBackground.ignoresSafeArea())
    }

    /// 上部全幅 stock paste banner。ペースト先選択モード中に表示し、tap (or キャンセル) でモード解除。
    private var stockPasteBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "tray.and.arrow.down")
            Text("ペースト先のセルをタップ")
                .lineLimit(1)
            Spacer()
            Button("キャンセル") {
                stockPasteTargetItemId = nil
            }
            .font(.caption2)
            .buttonStyle(.bordered)
            .controlSize(.mini)
        }
        .font(.callout)
        .foregroundStyle(.primary)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    /// 上部全幅 lock banner。tap で詳細 alert を表示。
    private var lockBanner: some View {
        Button {
            showLockHint = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill")
                Text("ロック中 — 編集できません")
                    .lineLimit(1)
                Spacer()
                Text("解除はダッシュボードから")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Image(systemName: "info.circle")
                    .foregroundStyle(.secondary)
            }
            .font(.callout)
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func content(mandalart: Mandalart, grid: Grid, capturedLeadingInset: CGFloat) -> some View {
        // GeometryReader で available size を取り、grid を「縦最大の正方形」、memo を
        // 「残り横幅」に相対的に割り当てる。横幅余りなく / bottom 揃いを両立する。
        //
        // **物理画面での縦中央配置**: iOS の safe area は端末/向きで非対称になる
        // (例: iPhone Pro Landscape は top=0 / bottom=21pt の home indicator)。
        // GR は safe area 内に置かれるため SwiftUI の中央寄せだけだと物理画面では
        // 偏って見える。`geo.safeAreaInsets` で実 inset を読み、bottom が大きい側に
        // 合わせて top padding (or 逆) を補償することで全端末で物理中央配置を保つ。
        //
        // **leading safe area 補正**: 親 ZStack で `.ignoresSafeArea(.container, .leading)`
        // を適用しているため availW に leading inset 分が追加されている。
        // root GR で捕獲した `capturedLeadingInset` を使って HStack を内側に押し戻し、
        // grid/memo は元の safe area 内に + 数 pt 内側に配置する。
        GeometryReader { geo in
            let availH = geo.size.height
            let availW = geo.size.width
            let topInset = geo.safeAreaInsets.top
            let bottomInset = geo.safeAreaInsets.bottom
            // safe area 非対称補正 (bottom > top なら top に asymmetry pt 追加)
            let asymmetry = bottomInset - topInset
            let topCompensation: CGFloat = max(0, asymmetry)
            let bottomCompensation: CGFloat = max(0, -asymmetry)
            // 補正後の有効高さ (= 上下が物理的に対称になる有効領域)
            let usableH = max(0, availH - topCompensation - bottomCompensation)

            // home button は ZStack 拡張領域 (物理画面左) に出ているので chevron-left の
            // breathing room は 8pt で十分
            let leadingPad: CGFloat = 8
            let trailingPad: CGFloat = 0  // memo を safe area trailing 端まで伸ばす
            let outerSpacing: CGFloat = 12  // 左右ペイン間
            let chevronW: CGFloat = 36
            let leftInnerSpacing: CGFloat = 8
            let leftOverhead: CGFloat = chevronW * 2 + leftInnerSpacing * 2
            let memoMinW: CGFloat = 200
            // grid 上下に breathing room (= HStack 中央配置で自動的に均等になる)
            let verticalMargin: CGFloat = 16
            // grid を safe area 端からさらに数 pt 内側に押し込む (= 視覚的 breathing room)
            let extraInsidePush: CGFloat = 4
            // 実 content 領域 = availW から leading 拡張分と内押し分を除いた幅
            let contentW = max(0, availW - capturedLeadingInset - extraInsidePush)
            // grid は正方形なので min(有効高さ - 余白, 左ペインに割ける最大幅) で確定
            let leftPaneMaxInnerW = max(0, contentW - memoMinW - leadingPad - trailingPad - outerSpacing - leftOverhead)
            let gridSize = max(0, min(usableH - verticalMargin * 2, leftPaneMaxInnerW))
            // memo は残り横幅すべて
            let memoW = max(memoMinW, contentW - leadingPad - trailingPad - outerSpacing - leftOverhead - gridSize)

            HStack(spacing: outerSpacing) {
                // 左ペイン: 3×3 (chevron + grid + chevron/+) / 9×9 (chevron なし、grid 単体)
                HStack(spacing: leftInnerSpacing) {
                    if viewMode == .grid3x3 {
                        parallelNavButton(
                            systemName: "chevron.left",
                            visible: parallelIndex > 0,
                            accessibilityLabel: "前の並列グリッドへ"
                        ) {
                            handleParallelNav(direction: -1, mandalart: mandalart)
                        }
                        let cells = GridRepository.displayCells(for: grid, in: modelContext)
                        GridView3x3(
                            gridId: grid.id,
                            displayCells: cells,
                            mandalart: mandalart,
                            transitionKind: lastTransitionKind,
                            hasChildAtPosition: GridRepository.hasChildMaskForGrid(
                                displayCells: cells,
                                in: modelContext
                            ),
                            onDrillRequest: { cell in handleDrill(cell: cell, mandalart: mandalart) },
                            pasteMode: stockPasteTargetItemId != nil,
                            onPasteTargetTapped: { cell in handleStockPasteTarget(cell: cell) },
                            onExportRequest: { cell in cellExportTarget = cell },
                            onImportRequest: { cell in handleCellImportRequest(cell: cell) },
                            editingCellId: editingCellId,
                            onEditRequest: { cell in beginEditing(cell: cell) },
                            onCenterTapRequest: { handleCenterTap() }
                        )
                        .frame(width: gridSize, height: gridSize)
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                        rightSlotButton(mandalart: mandalart, grid: grid)
                    } else {
                        // 9×9 mode: chevron 非表示で grid を中央に。chevron 分の空白を予約して
                        // 3×3 と同じ grid 中心位置を保つ (= 切替時の視覚ぶれを抑える)。
                        Color.clear.frame(width: 36, height: 36)
                        GridView9x9(
                            layout: nineByNineLayout(mandalart: mandalart),
                            mandalart: mandalart
                        )
                        .frame(width: gridSize, height: gridSize)
                        .transition(.scale(scale: 1.5).combined(with: .opacity))
                        Color.clear.frame(width: 36, height: 36)
                    }
                }
                .padding(.leading, leadingPad)

                // 右ペイン: breadcrumb / tab picker / memo or stock。高さ = grid と同じ (bottom 揃え)
                VStack(alignment: .leading, spacing: 8) {
                    Breadcrumb(items: breadcrumb) { index in
                        navigateToBreadcrumb(index, mandalart: mandalart)
                    }
                    Divider()
                    // memo / stock 切替 segmented picker
                    Picker("タブ", selection: $rightPaneTab) {
                        ForEach(RightPaneTab.allCases) { tab in
                            Text(tab.label).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    switch rightPaneTab {
                    case .memo:
                        MemoTab(grid: grid, mandalart: mandalart)
                            .id(grid.id)  // grid 切替時に MemoTab の @State を再初期化
                            .frame(maxHeight: .infinity)  // 残り縦領域を memo が吸収
                    case .stock:
                        StockTab(
                            onPasteRequest: { item in
                                // stock タブで「ペースト」ボタンを押したら paste-target 選択モードに入る。
                                // 同じ item を再度押した場合はキャンセル扱い (toggle)。
                                if stockPasteTargetItemId == item.id {
                                    stockPasteTargetItemId = nil
                                } else {
                                    stockPasteTargetItemId = item.id
                                }
                            },
                            pasteRequestedItemId: stockPasteTargetItemId
                        )
                        .frame(maxHeight: .infinity)
                    }
                }
                .frame(width: memoW, height: gridSize)
                .padding(.trailing, trailingPad)
            }
            .frame(width: contentW, height: usableH)
            .padding(.leading, capturedLeadingInset + extraInsidePush)
            .padding(.top, topCompensation)
            .padding(.bottom, bottomCompensation)
        }
    }

    /// 右側の並列ナビスロット (= desktop と同様、">" or 末尾なら "+" を同位置に出す)。
    /// "+" は **末尾 + 周辺 1 セル以上に入力あり + 非ロック中** のみ表示 (= 空並列の連続生成を防ぐ)。
    @ViewBuilder
    private func rightSlotButton(mandalart: Mandalart, grid: Grid) -> some View {
        if parallelIndex < parallelGrids.count - 1 {
            parallelNavButton(
                systemName: "chevron.right",
                visible: true,
                accessibilityLabel: "次の並列グリッドへ"
            ) {
                handleParallelNav(direction: 1, mandalart: mandalart)
            }
        } else if !mandalart.locked, currentGridHasPeripheralInput(grid: grid) {
            parallelNavButton(
                systemName: "plus",
                visible: true,
                accessibilityLabel: "新しい並列グリッドを追加"
            ) {
                handleAddParallel(mandalart: mandalart)
            }
        } else {
            // layout 安定化用 placeholder (grid 中央寄せが揺れない)
            Color.clear.frame(width: 36, height: 36)
        }
    }

    /// 現在 grid の周辺セル (position != 4) の中に 1 つでも非空 (text/image/color/done) があるか。
    private func currentGridHasPeripheralInput(grid: Grid) -> Bool {
        let cells = GridRepository.displayCells(for: grid, in: modelContext)
        for (i, c) in cells.enumerated() where i != GridConstants.centerPosition {
            guard let c else { continue }
            if !c.text.isEmpty || c.imagePath != nil || c.color != nil || c.done {
                return true
            }
        }
        return false
    }

    /// 並列ナビ用の chevron ボタン (visible=false でも layout を予約して grid サイズを安定させる)。
    @ViewBuilder
    private func parallelNavButton(
        systemName: String,
        visible: Bool,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 36, height: 36)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
    }

    // MARK: - Inline editing (Floating Bar)

    /// 編集要求を受け取って Floating Bar を表示状態にする。CellView 側で空 slot は
    /// lazy create 済の Cell を渡してくる前提なので、ここでは draft セットのみ。
    private func beginEditing(cell: Cell) {
        guard let m = mandalart, !m.locked else { return }
        editingDraft = cell.text
        editingCellId = cell.id
    }

    /// Floating Bar の draft を SwiftData の cell.text に commit。root center の場合は
    /// mandalart.title も同期 (= ダッシュボードのタイトル表示と整合)。
    private func commitEditing() {
        defer {
            editingCellId = nil
            editingDraft = ""
        }
        guard let m = mandalart, !m.locked else { return }
        guard let id = editingCellId else { return }
        let descriptor = FetchDescriptor<Cell>(predicate: #Predicate<Cell> { $0.id == id })
        guard let target = (try? modelContext.fetch(descriptor))?.first else { return }
        guard target.text != editingDraft else { return }
        let now = Date()
        target.text = editingDraft
        target.updatedAt = now
        if target.id == m.rootCellId {
            m.title = editingDraft
            m.updatedAt = now
        }
        try? modelContext.save()
    }

    /// 編集を破棄。SwiftData は触らない (= cell.text は変更前のまま)。
    private func cancelEditing() {
        editingCellId = nil
        editingDraft = ""
    }

    /// 入力済み中心セル tap → desktop 同等の drill-up / home navigation。
    /// - root grid (breadcrumb 長 ≤ 1): `onBack()` でダッシュボードへ
    /// - 子グリッド: 親 breadcrumb (= count - 2) へ navigate (drill-up animation)
    /// ロック中も呼ばれる (= 閲覧 navigation として許可) が、navigateToBreadcrumb 内で
    /// 書き込みは locked ガード済。
    private func handleCenterTap() {
        guard let m = mandalart else { return }
        if breadcrumb.count <= 1 {
            onBack()
        } else {
            navigateToBreadcrumb(breadcrumb.count - 2, mandalart: m)
        }
    }

    // MARK: - Navigation

    private func bootstrapIfNeeded(mandalart: Mandalart) {
        guard !didBootstrap else { return }
        didBootstrap = true

        let root = grids.first(where: { $0.parentCellId == nil })
        guard let root else { return }

        let lastId = mandalart.lastGridId
        if let lastId, lastId != root.id,
           let ancestry = GridRepository.getGridAncestry(gridId: lastId, in: modelContext),
           ancestry.count > 1 {
            currentGridId = ancestry.last?.id
            breadcrumb = ancestry.map { g in
                BreadcrumbItem(
                    gridId: g.id,
                    cellId: g.parentCellId,
                    label: labelForGrid(g, mandalart: mandalart)
                )
            }
        } else {
            currentGridId = root.id
            breadcrumb = [BreadcrumbItem(
                gridId: root.id,
                cellId: nil,
                label: mandalart.title.isEmpty ? "(無題)" : mandalart.title
            )]
        }
        refreshParallelState(for: mandalart)
    }

    /// 現在 grid が属する並列セット (= 同じ parent_cell_id を持つ兄弟群) を再取得し、
    /// `parallelIndex` を現在 gridId に合わせる。
    /// drill / drill-up / breadcrumb-nav / parallel-nav / parallel-add の全ての遷移後に呼ぶ。
    ///
    /// **@Query 反映遅延を避けるため context 直 fetch**: 直前に context.insert したばかりの
    /// 新 grid は `grids` @Query にまだ載っていない可能性があるので、currentGridId 起点で
    /// SwiftData から直接 grid を引いて parentCellId を決める。
    private func refreshParallelState(for mandalart: Mandalart) {
        guard let id = currentGridId else {
            parallelGrids = []
            parallelIndex = 0
            return
        }
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == id && $0.deletedAt == nil }
        )
        guard let cur = (try? modelContext.fetch(descriptor))?.first else {
            parallelGrids = []
            parallelIndex = 0
            return
        }
        let siblings = GridRepository.getSiblingGrids(
            parentCellId: cur.parentCellId,
            mandalartId: mandalart.id,
            in: modelContext
        )
        parallelGrids = siblings
        parallelIndex = siblings.firstIndex(where: { $0.id == cur.id }) ?? 0
    }

    private func handleDrill(cell: Cell, mandalart: Mandalart) {
        let child: Grid?
        if mandalart.locked {
            // ロック中: 既存子のみ navigate (新規作成は抑制 = 書き込み禁止)。
            child = GridRepository.findChildGrid(parentCellId: cell.id, in: modelContext)
            guard child != nil else { return }
        } else {
            do {
                child = try GridRepository.findOrCreateChildGrid(
                    parentCellId: cell.id,
                    mandalartId: mandalart.id,
                    in: modelContext
                )
            } catch {
                print("[editor] drill-down failed:", error)
                return
            }
        }
        guard let target = child else { return }
        lastTransitionKind = .drillDown
        breadcrumb.append(BreadcrumbItem(
            gridId: target.id,
            cellId: cell.id,
            label: cell.text.isEmpty ? "(無題)" : cell.text
        ))
        currentGridId = target.id
        // lastGridId / updatedAt 更新は書き込み → ロック中はスキップ (sync dirty 化を避ける)
        if !mandalart.locked {
            mandalart.lastGridId = target.id
            mandalart.updatedAt = Date()
            try? modelContext.save()
        }
        refreshParallelState(for: mandalart)
    }

    private func navigateToBreadcrumb(_ index: Int, mandalart: Mandalart) {
        guard index >= 0, index < breadcrumb.count else { return }
        let target = breadcrumb[index]
        lastTransitionKind = .drillUp
        breadcrumb = Array(breadcrumb.prefix(index + 1))
        currentGridId = target.gridId
        // ロック中は lastGridId 更新スキップ (drill-up も navigation 専用、書き込みなし)
        if !mandalart.locked {
            mandalart.lastGridId = target.gridId
            mandalart.updatedAt = Date()
            try? modelContext.save()
        }
        refreshParallelState(for: mandalart)
    }

    // MARK: - Parallel grid

    /// `direction = -1` → 前 / `+1` → 次。範囲外なら何もしない。
    /// 切替後に旧 grid が完全に空 (cells が全部空 + 子グリッドなし) なら物理削除する。
    private func handleParallelNav(direction: Int, mandalart: Mandalart) {
        let nextIdx = parallelIndex + direction
        guard nextIdx >= 0, nextIdx < parallelGrids.count else { return }
        let nextGrid = parallelGrids[nextIdx]
        let oldGridId = currentGridId

        lastTransitionKind = .parallel
        currentGridId = nextGrid.id
        // breadcrumb 末尾 (= 現在地) の gridId を切替先に追従させる
        if !breadcrumb.isEmpty {
            let last = breadcrumb.last!
            breadcrumb[breadcrumb.count - 1] = BreadcrumbItem(
                gridId: nextGrid.id,
                cellId: last.cellId,
                label: last.label
            )
        }
        if !mandalart.locked {
            mandalart.lastGridId = nextGrid.id
            mandalart.updatedAt = Date()
            try? modelContext.save()
        }

        // 旧 grid が空なら物理削除 (ロック中は cleanup も書き込みなのでスキップ)
        if !mandalart.locked, let oldGridId, oldGridId != nextGrid.id {
            _ = GridRepository.cleanupGridIfEmpty(gridId: oldGridId, in: modelContext)
        }
        refreshParallelState(for: mandalart)
    }

    /// 並列グリッドを末尾に追加 (= 独立 center cell を持つ新規 grid)。
    /// ロック中は no-op (= 書き込み禁止)。
    private func handleAddParallel(mandalart: Mandalart) {
        guard !mandalart.locked else { return }
        guard let cur = currentGrid else { return }
        let nextSortOrder = (parallelGrids.map(\.sortOrder).max() ?? -1) + 1

        do {
            let newGrid = try GridRepository.createParallelGrid(
                parentCellId: cur.parentCellId,
                mandalartId: mandalart.id,
                sortOrder: nextSortOrder,
                in: modelContext
            )
            lastTransitionKind = .parallel
            currentGridId = newGrid.id
            // breadcrumb 末尾 (= 現在地) の gridId を新 grid に追従。label は親 cell ベースで不変
            if !breadcrumb.isEmpty {
                let last = breadcrumb.last!
                breadcrumb[breadcrumb.count - 1] = BreadcrumbItem(
                    gridId: newGrid.id,
                    cellId: last.cellId,
                    label: last.label
                )
            }
            mandalart.lastGridId = newGrid.id
            mandalart.updatedAt = Date()
            try? modelContext.save()
            refreshParallelState(for: mandalart)
        } catch {
            print("[editor] add parallel grid failed:", error)
        }
    }

    /// 9×9 view 用 layout (= 9 ブロック分の `(Grid?, displayCells)`)。
    /// 9×9 は **常に root grid 起点** で全体俯瞰するため、`currentGridId` がどこを指していても
    /// root から計算する (= drill 中に 9×9 へ切替えても全 81 セルが見られる)。
    /// root grid が存在しない異常状態 (= bootstrap 前など) は 9 個の空ブロックを返す。
    private func nineByNineLayout(mandalart: Mandalart) -> [(Grid?, [Cell?])] {
        guard let root = grids.first(where: { $0.parentCellId == nil }) else {
            let emptyDisplay: [Cell?] = Array(repeating: nil, count: GridConstants.gridCellCount)
            return Array(
                repeating: (nil, emptyDisplay),
                count: GridConstants.gridCellCount
            )
        }
        return GridRepository.loadNineByNineLayout(rootGrid: root, in: modelContext)
    }

    private func labelForGrid(_ grid: Grid, mandalart: Mandalart) -> String {
        if grid.parentCellId == nil {
            return mandalart.title.isEmpty ? "(無題)" : mandalart.title
        }
        let parentId = grid.parentCellId!
        if let parent = allCells.first(where: { $0.id == parentId }) {
            return parent.text.isEmpty ? "(無題)" : parent.text
        }
        return "(無題)"
    }

    // MARK: - Stock paste

    // MARK: - Cell-level Export / Import

    /// 選択された format で cell 単位の payload を構築し `.fileExporter` を起動する。
    /// confirmationDialog の各 format ボタンから呼ばれる。
    private func startCellExport(cell: Cell, format: ExportFormat) {
        do {
            let payload = try TransferService.buildCellExportPayload(
                cell: cell,
                format: format,
                in: modelContext
            )
            exportDocument = payload.document
            exportFilename = payload.filename
            exportContentType = payload.contentType
            cellExportTarget = nil
            showFileExporter = true
        } catch {
            cellExportTarget = nil
            transferAlert = TransferAlertState(
                title: "エクスポート失敗",
                message: error.localizedDescription
            )
        }
    }

    /// CellView の context menu「ここにインポート」から呼ばれる。
    /// pending cell id を保持してから fileImporter を起動する。
    private func handleCellImportRequest(cell: Cell) {
        pendingImportCellId = cell.id
        showCellFileImporter = true
    }

    /// `.fileImporter` の完了結果をハンドル。pendingImportCellId のセルに snapshot を import する。
    private func handleCellImportResult(_ result: Result<[URL], Error>) {
        defer { pendingImportCellId = nil }
        switch result {
        case .success(let urls):
            guard let url = urls.first, let cellId = pendingImportCellId else { return }
            let started = url.startAccessingSecurityScopedResource()
            defer { if started { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                let snapshot: GridSnapshot
                let ext = url.pathExtension.lowercased()
                if ext == "json" {
                    snapshot = try JSONDecoder().decode(GridSnapshot.self, from: data)
                } else {
                    let text = String(data: data, encoding: .utf8) ?? ""
                    snapshot = TransferService.parseTextToSnapshot(text)
                }
                if snapshot.cells.isEmpty && snapshot.children.isEmpty {
                    throw TransferService.TransferError.parseEmpty
                }
                try TransferService.importIntoCell(snapshot: snapshot, cellId: cellId, in: modelContext)
                transferAlert = TransferAlertState(
                    title: "インポート完了",
                    message: "セル配下にインポートしました"
                )
            } catch {
                transferAlert = TransferAlertState(
                    title: "インポート失敗",
                    message: error.localizedDescription
                )
            }
        case .failure(let error):
            let nsError = error as NSError
            if nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError {
                return
            }
            transferAlert = TransferAlertState(
                title: "インポート失敗",
                message: error.localizedDescription
            )
        }
    }

    /// `.fileExporter` の完了結果をハンドル。ユーザーキャンセルは alert を出さない。
    private func handleExportResult(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            transferAlert = TransferAlertState(
                title: "保存しました",
                message: url.lastPathComponent
            )
        case .failure(let error):
            let nsError = error as NSError
            if nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError {
                return
            }
            transferAlert = TransferAlertState(
                title: "エクスポート失敗",
                message: error.localizedDescription
            )
        }
    }

    /// stock paste-target 選択モードの cell tap ハンドラ。
    /// 1. 選択中の stock item id を modelContext から取り直して `pasteFromStock` を実行
    /// 2. 成功 / 失敗いずれもモード解除 (= banner を消す、再選択は stock タブから)
    /// 3. paste 後に right pane を memo に切り替え (= ユーザーが結果を grid で確認しやすい)
    /// 4. mandalart の `lastGridId` 更新は不要 (= 現在の grid に paste しただけ、navigation 不変)
    private func handleStockPasteTarget(cell: Cell) {
        guard let itemId = stockPasteTargetItemId else { return }
        let descriptor = FetchDescriptor<StockItem>(
            predicate: #Predicate<StockItem> { $0.id == itemId }
        )
        guard let item = (try? modelContext.fetch(descriptor))?.first else {
            stockPasteTargetItemId = nil
            return
        }
        do {
            try StockService.pasteFromStock(item, targetCellId: cell.id, in: modelContext)
        } catch {
            print("[EditorView] paste failed:", error)
        }
        stockPasteTargetItemId = nil
    }
}

// MARK: - RightPaneTab

/// 右ペインのタブ種別。Picker(.segmented) + switch rightPaneTab で出し分ける。
enum RightPaneTab: String, CaseIterable, Identifiable {
    case memo
    case stock

    var id: Self { self }
    var label: String {
        switch self {
        case .memo: return "メモ"
        case .stock: return "ストック"
        }
    }
}
