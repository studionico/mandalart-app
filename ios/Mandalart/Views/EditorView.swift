import SwiftUI
import SwiftData

/// Landscape 2-pane editor (NavigationStack なし、floating control overlay でスペース最大化):
/// - 左ペイン: 3×3 グリッド (正方形、垂直中央)
/// - 右ペイン: breadcrumb + メモ プレースホルダ
/// - 左上 floating: home (ダッシュボードへ戻る) + ロック indicator (ロック時のみ)
struct EditorView: View {
    let mandalartId: String
    let onBack: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Query private var mandalarts: [Mandalart]
    @Query private var grids: [Grid]
    @Query private var allCells: [Cell]

    @State private var currentGridId: String?
    @State private var breadcrumb: [BreadcrumbItem] = []
    @State private var didBootstrap: Bool = false
    @State private var showLockHint: Bool = false
    @State private var parallelGrids: [Grid] = []
    @State private var parallelIndex: Int = 0

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
                // 左ペイン: chevron + grid + (chevron or +)。grid サイズを明示指定。
                HStack(spacing: leftInnerSpacing) {
                    parallelNavButton(
                        systemName: "chevron.left",
                        visible: parallelIndex > 0,
                        accessibilityLabel: "前の並列グリッドへ"
                    ) {
                        handleParallelNav(direction: -1, mandalart: mandalart)
                    }
                    GridView3x3(
                        gridId: grid.id,
                        displayCells: GridRepository.displayCells(for: grid, in: modelContext),
                        mandalart: mandalart,
                        onDrillRequest: { cell in handleDrill(cell: cell, mandalart: mandalart) }
                    )
                    .frame(width: gridSize, height: gridSize)
                    rightSlotButton(mandalart: mandalart, grid: grid)
                }
                .padding(.leading, leadingPad)

                // 右ペイン: breadcrumb / divider / memo。高さ = grid と同じ (bottom 揃え)
                VStack(alignment: .leading, spacing: 8) {
                    Breadcrumb(items: breadcrumb) { index in
                        navigateToBreadcrumb(index, mandalart: mandalart)
                    }
                    Divider()
                    MemoTab(grid: grid, mandalart: mandalart)
                        .id(grid.id)  // grid 切替時に MemoTab の @State を再初期化
                        .frame(maxHeight: .infinity)  // 残り縦領域を memo が吸収
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
}
