import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AuthStore.self) private var auth

    @Query(filter: #Predicate<Mandalart> { $0.deletedAt == nil })
    private var mandalartsRaw: [Mandalart]

    @Query(filter: #Predicate<Folder> { $0.deletedAt == nil })
    private var foldersRaw: [Folder]

    /// mandalart.rootCellId から root center cell の text を引くための索引 (= カード表示用)。
    /// 空 cell は lazy create policy で DB に無く、通常 mandalart 数 × 9 以下で十分小さい。
    /// @Query で reactive に追従するため cell.text 編集が即時カードに反映される。
    @Query(filter: #Predicate<Cell> { $0.deletedAt == nil })
    private var allCellsForRoot: [Cell]

    /// 各 mandalart の primary root grid (= parentCellId == nil で sortOrder 最小) を引くための索引。
    /// mandalart.rootCellId が並列 grid の中心セルを指してしまうデータ不整合があっても、
    /// ここで「実 root grid」を直接特定するため表示が乱れない。
    /// **sort は `\Grid.sortOrder` 単一 KeyPath に絞る** (`[SortDescriptor(...), SortDescriptor(...)]` の配列リテラルは
    /// SwiftData @Query で型推論 timeout になる落とし穴。pitfalls.md #12 派生)。MandalartFactory.create は 0、
    /// createParallelGrid は 1, 2, ... を採番するので createdAt タイブレーカーなしでも一意に判別できる。
    @Query(
        filter: #Predicate<Grid> { $0.parentCellId == nil && $0.deletedAt == nil },
        sort: \Grid.sortOrder
    )
    private var rootGrids: [Grid]

    /// 全 grid (子 grid 含む) — 検索時に cell.gridId → mandalartId を解決する目的で取得。
    /// rootGrids は parentCellId == nil で絞っているため、子 grid 配下の cell を検索範囲に入れるには
    /// 子 grid も含む別 query が必要。
    @Query(filter: #Predicate<Grid> { $0.deletedAt == nil })
    private var allGrids: [Grid]

    @State private var selectedFolderId: String?
    @State private var query: String = ""
    @State private var isSearchPresented: Bool = false
    /// .searchable(isPresented:) は Cancel タップで text binding を自動クリアするため、
    /// 直前の query を別 state にバックアップして虫眼鏡再オープン時に復元する。
    @State private var lastQuery: String = ""
    @State private var showSettings = false

    @State private var showAddFolder = false
    @State private var newFolderName: String = ""

    @State private var renameTarget: Folder?
    @State private var renameInput: String = ""

    @State private var showTrash = false

    // Export 状態
    @State private var exportTarget: Mandalart?
    @State private var showExportFormatDialog = false
    @State private var exportDocument: MandalartExportDocument?
    @State private var exportFilename: String = ""
    @State private var exportContentType: UTType = .json
    @State private var showFileExporter = false

    // Import 状態
    @State private var showFileImporter = false
    /// Import 結果のフィードバックを 1 行で出すための簡易 toast (= alert で表示)。
    @State private var transferAlert: TransferAlertState?

    let onOpenMandalart: (String) -> Void
    /// ContentView から渡される morph Namespace。MandalartCard の外枠 ↔ EditorView の grid 容器を
    /// matchedGeometryEffect でマッチさせ、Dashboard ↔ Editor 遷移時の expand / converge を駆動する。
    let namespace: Namespace.ID

    /// 並び順: Inbox (isSystem) を先頭に固定 → sortOrder ASC → createdAt ASC
    private var sortedFolders: [Folder] {
        foldersRaw.sorted { lhs, rhs in
            if lhs.isSystem != rhs.isSystem { return lhs.isSystem }
            if lhs.sortOrder != rhs.sortOrder { return lhs.sortOrder < rhs.sortOrder }
            return lhs.createdAt < rhs.createdAt
        }
    }

    /// 並び順 (Phase 4 phase 2 と同じ): pinned DESC → sortOrder ASC (nil 後ろ) → createdAt DESC
    private func sortedMandalarts(in folderId: String?) -> [Mandalart] {
        mandalartsRaw
            .filter { folderId == nil || $0.folderId == folderId }
            .sorted { lhs, rhs in
                if lhs.pinned != rhs.pinned { return lhs.pinned }
                switch (lhs.sortOrder, rhs.sortOrder) {
                case let (a?, b?) where a != b: return a < b
                case (_?, nil): return true
                case (nil, _?): return false
                default: break
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    /// 検索バー open かつ query 非空のときのみ全 folder 横断 filter。
    /// title / cell.text / grid.memo の OR 部分一致 (desktop searchMandalarts と同等)。
    /// 検索バーを閉じた瞬間に通常の folder filter に戻す。
    private var visibleMandalarts: [Mandalart] {
        if isSearchPresented && !query.isEmpty {
            let lower = query.lowercased()
            // gridId → mandalartId 解決マップ (子 grid 含む)
            let mandalartIdByGrid: [String: String] = Dictionary(
                uniqueKeysWithValues: allGrids.map { ($0.id, $0.mandalartId) }
            )
            // cell.text 部分一致 → 所属 mandalartId 集合
            var matchedByCellText: Set<String> = []
            for cell in allCellsForRoot {
                if cell.text.lowercased().contains(lower),
                   let mid = mandalartIdByGrid[cell.gridId] {
                    matchedByCellText.insert(mid)
                }
            }
            // grid.memo 部分一致 → 所属 mandalartId 集合 (memo は optional)
            var matchedByGridMemo: Set<String> = []
            for grid in allGrids {
                if let memo = grid.memo, memo.lowercased().contains(lower) {
                    matchedByGridMemo.insert(grid.mandalartId)
                }
            }
            return sortedMandalarts(in: nil).filter { m in
                m.title.lowercased().contains(lower)
                    || matchedByCellText.contains(m.id)
                    || matchedByGridMemo.contains(m.id)
            }
        }
        return sortedMandalarts(in: selectedFolderId)
    }

    var body: some View {
        NavigationStack {
            // .searchable は isPresented = false でも search field 自体を NavigationBar 配下に常時表示する
            // 仕様 (isPresented は active/Cancel 状態のみを制御)。アイコンタップ前は完全に隠したいため、
            // modifier 自体を isSearchPresented で条件付き適用する。
            Group {
                if isSearchPresented {
                    mainGrid
                        .searchable(text: $query, isPresented: $isSearchPresented, placement: .toolbar, prompt: "タイトル・セル本文・メモで検索...")
                } else {
                    mainGrid
                }
            }
            // dashboard 全体背景を desktop の `bg-neutral-50 dark:bg-neutral-950` に揃える。
            // NavigationStack の背景透過を防ぐため scrollContentBackground は hidden にせず、
            // ZStack overlay で root 全面に塗る。
            .background(NeutralPalette.rootBackground.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: {
                        Image(systemName: auth.isSignedIn ? "person.crop.circle.fill" : "person.crop.circle")
                    }
                }
                // 人アイコン横の空きスペースに folder tab を配置 (= 縦スペース節約)
                ToolbarItem(placement: .principal) {
                    folderTabBar
                }
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 8) {
                        Button {
                            // Cancel タップで Apple が自動クリアした query を直前値で復元
                            if query.isEmpty && !lastQuery.isEmpty {
                                query = lastQuery
                            }
                            isSearchPresented = true
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .accessibilityLabel("検索")
                        Button { showFileImporter = true } label: {
                            Image(systemName: "square.and.arrow.down")
                        }
                        .accessibilityLabel("インポート")
                        Button { showTrash = true } label: {
                            Image(systemName: "trash")
                        }
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView().environment(auth)
            }
            .sheet(isPresented: $showTrash) {
                TrashView()
            }
            .modifier(DashboardExportModifier(
                exportTarget: exportTarget,
                showExportFormatDialog: $showExportFormatDialog,
                exportDocument: exportDocument,
                exportContentType: exportContentType,
                exportFilename: exportFilename,
                showFileExporter: $showFileExporter,
                onPickFormat: { m, fmt in startExport(m, format: fmt) },
                onCancelFormat: { exportTarget = nil },
                onExportResult: { handleExportResult($0) }
            ))
            .modifier(DashboardImportAlertModifier(
                showFileImporter: $showFileImporter,
                transferAlert: $transferAlert,
                onImportResult: { handleImportResult($0) }
            ))
            .sheet(isPresented: $showAddFolder) {
                FolderNameSheet(
                    title: "新規フォルダ",
                    name: $newFolderName,
                    confirmLabel: "追加",
                    onConfirm: { addFolder() }
                )
                .presentationDetents([.height(200)])
            }
            .sheet(
                isPresented: Binding(
                    get: { renameTarget != nil },
                    set: { if !$0 { renameTarget = nil } }
                )
            ) {
                FolderNameSheet(
                    title: "フォルダ名を変更",
                    name: $renameInput,
                    confirmLabel: "保存",
                    onConfirm: { commitRename() }
                )
                .presentationDetents([.height(200)])
            }
        }
        .onAppear { initSelectedFolder() }
        .onChange(of: foldersRaw.count) { _, _ in initSelectedFolder() }
        // Cancel で query が "" にクリアされる前に直前値をバックアップ
        .onChange(of: query) { _, newValue in
            if !newValue.isEmpty {
                lastQuery = newValue
            }
        }
    }

    // MARK: - Folder tab bar (toolbar principal slot)

    private var folderTabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(sortedFolders) { folder in
                    folderTab(folder)
                }
                Button {
                    newFolderName = ""
                    showAddFolder = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func folderTab(_ folder: Folder) -> some View {
        let isSelected = folder.id == selectedFolderId
        let count = mandalartsRaw.filter { $0.folderId == folder.id && $0.deletedAt == nil }.count
        HStack(spacing: 4) {
            Image(systemName: folder.isSystem ? "tray.fill" : "folder.fill")
                .font(.caption2)
            Text(folder.name)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .lineLimit(1)
            if count > 0 {
                Text("\(count)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .foregroundStyle(isSelected ? Color.primary : Color.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(isSelected ? Color.primary.opacity(0.12) : Color.clear)
        )
        .contentShape(Capsule())
        .onTapGesture { selectedFolderId = folder.id }
        .contextMenu { folderContextMenu(for: folder) }
    }

    @ViewBuilder
    private func folderContextMenu(for folder: Folder) -> some View {
        Button {
            renameInput = folder.name
            renameTarget = folder
        } label: {
            Label("名前変更", systemImage: "pencil")
        }

        if !folder.isSystem {
            Button(role: .destructive) {
                try? FolderRepository.deleteFolder(folder, in: modelContext)
                if selectedFolderId == folder.id {
                    selectedFolderId = sortedFolders.first(where: { $0.isSystem })?.id
                }
            } label: {
                Label("削除 (中身を Inbox へ)", systemImage: "trash")
            }
        }
    }

    // MARK: - Main grid

    private var mainGrid: some View {
        // GeometryReader は ScrollView の外側に置く (内側だと content の高さしか取れない)。
        // geo.size.height = タブ + 検索バーを除いた content viewport の高さ。
        GeometryReader { geo in
            ScrollView {
                if visibleMandalarts.isEmpty {
                    emptyState
                } else {
                    // viewport の縦に 2 行が収まる正方形辺長を逆算 (= 絶対値 pt ではなく相対サイズ)。
                    // 1 row VStack: RoundedRectangle (square) + spacing(8) + 日時 caption(.caption2 ~14pt)
                    // 2 row 分 + row 間 spacing(12) + 上下 padding(12 * 2)
                    let captionAndSpacing: CGFloat = 8 + 14
                    let verticalChrome: CGFloat = 12 + 12 + 12
                    let cardSquareSize = max(80, (geo.size.height - verticalChrome - captionAndSpacing * 2) / 2)
                    let columns = [GridItem(.adaptive(minimum: cardSquareSize), spacing: 12)]
                    // mandalartId → primary root grid (sortOrder ASC で最初の 1 件)。
                    // mandalart.rootCellId が並列 grid の中心セルを指す異常データがあっても、
                    // 実 root grid (parentCellId == nil) の centerCellId 経由で確実に root 中心セルを引く。
                    let primaryRootByMandalart: [String: Grid] = rootGrids.reduce(into: [:]) { dict, g in
                        if dict[g.mandalartId] == nil { dict[g.mandalartId] = g }
                    }
                    let textByCellId = Dictionary(uniqueKeysWithValues: allCellsForRoot.map { ($0.id, $0.text) })
                    LazyVGrid(columns: columns, spacing: 12) {
                        // 検索バー open 中は新規作成カードを抑制し、検索結果の純粋な一覧にする。
                        if !isSearchPresented {
                            NewMandalartCard(squareSize: cardSquareSize) {
                                handleCreateNewMandalart()
                            }
                        }
                        ForEach(visibleMandalarts) { m in
                            // 1) primary root grid の centerCellId 経由 (= 並列 grid の cell を絶対に拾わない)
                            // 2) fallback: mandalart.rootCellId (root grid が一時的に @Query 未反映の異常系)
                            // 3) 最終 fallback: mandalart.title
                            let displayText: String = {
                                if let g = primaryRootByMandalart[m.id], let t = textByCellId[g.centerCellId] {
                                    return t
                                }
                                return textByCellId[m.rootCellId] ?? m.title
                            }()
                            MandalartCard(mandalart: m, displayText: displayText, namespace: namespace)
                                .onTapGesture { onOpenMandalart(m.id) }
                                .contextMenu { mandalartContextMenu(for: m) }
                        }
                    }
                    .padding(12)
                }
            }
            .scrollDismissesKeyboard(.immediately)
        }
    }

    @ViewBuilder
    private func mandalartContextMenu(for m: Mandalart) -> some View {
        Button {
            m.pinned.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(m.pinned ? "ピン留めを外す" : "ピン留め",
                  systemImage: m.pinned ? "pin.slash" : "pin")
        }

        Button {
            m.locked.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(m.locked ? "ロックを外す" : "ロック",
                  systemImage: m.locked ? "lock.open" : "lock")
        }

        Button {
            try? MandalartFactory.duplicate(m, in: modelContext)
        } label: {
            Label("複製", systemImage: "doc.on.doc")
        }

        Menu {
            ForEach(sortedFolders) { folder in
                Button {
                    m.folderId = folder.id
                    m.updatedAt = Date()
                    try? modelContext.save()
                } label: {
                    HStack {
                        if folder.id == m.folderId {
                            Image(systemName: "checkmark")
                        }
                        Text(folder.name)
                    }
                }
            }
        } label: {
            Label("フォルダ移動", systemImage: "folder")
        }

        Button {
            exportTarget = m
            showExportFormatDialog = true
        } label: {
            Label("エクスポート", systemImage: "square.and.arrow.up")
        }

        // ロック中マンダラートは削除できない (誤操作防止のため context menu から削除項目を非表示)。
        // ロック解除すると削除メニューが復活する。defensive ガードは
        // `MandalartFactory.softDelete` 冒頭に同等の locked check あり。
        // 「削除」はゴミ箱に移動 (= soft delete)。完全削除はゴミ箱画面 (TrashView) から行う。
        if !m.locked {
            Divider()

            Button(role: .destructive) {
                try? MandalartFactory.softDelete(m, in: modelContext)
            } label: {
                Label("ゴミ箱へ移動", systemImage: "trash")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            if isSearchPresented && !query.isEmpty {
                Text("「\(query)」に一致するマンダラートはありません")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if let folder = sortedFolders.first(where: { $0.id == selectedFolderId }) {
                Text("\(folder.name) は空です")
                    .foregroundStyle(.secondary)
                Button("新規作成") {
                    handleCreateNewMandalart()
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
            } else {
                Text("マンダラートがありません")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 60)
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func initSelectedFolder() {
        let hasSelected = selectedFolderId != nil &&
            sortedFolders.contains(where: { $0.id == selectedFolderId })
        if !hasSelected {
            selectedFolderId = sortedFolders.first(where: { $0.isSystem })?.id
                ?? sortedFolders.first?.id
        }
    }

    private func addFolder() {
        let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            newFolderName = ""
            return
        }
        do {
            let folder = try FolderRepository.createFolder(name: name, in: modelContext)
            selectedFolderId = folder.id
        } catch {
            print("[dashboard] createFolder failed:", error)
        }
        newFolderName = ""
    }

    private func commitRename() {
        guard let target = renameTarget else { return }
        do {
            try FolderRepository.renameFolder(target, to: renameInput, in: modelContext)
        } catch {
            print("[dashboard] renameFolder failed:", error)
        }
        renameTarget = nil
        renameInput = ""
    }

    /// dashed-border カード or emptyState ボタン tap → 空タイトルで mandalart を作成し
    /// そのまま Editor を開く。Editor 側で何も入力せず戻ると `EditorView.performBackWithCleanup()`
    /// で hard delete されるので、空カードが Dashboard に残ることはない (desktop の
    /// `DashboardPage.handleCreate` と同等の挙動)。
    private func handleCreateNewMandalart() {
        do {
            let m = try MandalartFactory.create(
                title: "",
                folderId: selectedFolderId,
                in: modelContext
            )
            onOpenMandalart(m.id)
        } catch {
            print("[dashboard] create mandalart failed:", error)
        }
    }

    // MARK: - Export / Import handlers

    /// 選択された `format` で payload を構築し、`.fileExporter` を起動する。
    private func startExport(_ m: Mandalart, format: ExportFormat) {
        do {
            let payload = try TransferService.buildExportPayload(for: m, format: format, in: modelContext)
            exportDocument = payload.document
            exportFilename = payload.filename
            exportContentType = payload.contentType
            showFileExporter = true
        } catch {
            transferAlert = TransferAlertState(
                title: "エクスポート失敗",
                message: error.localizedDescription
            )
        }
    }

    /// `.fileExporter` の完了結果をハンドル。成功で確認 alert、失敗で error alert。
    private func handleExportResult(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            transferAlert = TransferAlertState(
                title: "保存しました",
                message: url.lastPathComponent
            )
        case .failure(let error):
            // ユーザーキャンセルは alert を出さない (= cancellationError 系)
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

    /// `.fileImporter` の完了結果をハンドル。
    /// 1. URL を security-scoped でアクセスして読み込み
    /// 2. .json なら `JSONDecoder` で `GridSnapshot` にデコード、それ以外は `parseTextToSnapshot`
    /// 3. `TransferService.importFromJSON` で新規マンダラート作成
    /// 4. 成功 / 失敗を alert で通知
    private func handleImportResult(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
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
                let mandalart = try TransferService.importFromJSON(
                    snapshot: snapshot,
                    targetFolderId: selectedFolderId,
                    in: modelContext
                )
                transferAlert = TransferAlertState(
                    title: "インポート完了",
                    message: "「\(mandalart.title.isEmpty ? "(無題)" : mandalart.title)」を作成しました"
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
}

// TransferAlertState / DashboardExportModifier / DashboardImportAlertModifier
// は SourceKit (= Live Issues 用 type-checker) の閾値を下げるため、
// `DashboardTransferSupport.swift` に切り出してある。

// MARK: - FolderNameSheet (日本語 IME 動作のため alert ではなく sheet ベース)

private struct FolderNameSheet: View {
    let title: String
    @Binding var name: String
    let confirmLabel: String
    let onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("フォルダ名", text: $name)
                    .focused($isFocused)
                    .submitLabel(.done)
                    .onSubmit {
                        if !trimmedName.isEmpty { confirm() }
                    }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(confirmLabel) { confirm() }
                        .disabled(trimmedName.isEmpty)
                }
            }
        }
        .onAppear { isFocused = true }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func confirm() {
        onConfirm()
        dismiss()
    }
}

private struct MandalartCard: View {
    let mandalart: Mandalart
    /// root center cell (= `mandalart.rootCellId`) の text。並列マンダラ有無に関わらず確実に root の中心セル内容を出すため、
    /// 親 (DashboardView) の @Query lookup から渡される。mandalart.title (mirror) は fallback として親側で適用済み。
    let displayText: String
    /// Dashboard ↔ Editor 遷移の expand/converge 用 morph namespace。
    /// `id: "card-\(mandalart.id)"` で EditorView の grid 容器と matched され、tap → grid morph が走る。
    let namespace: Namespace.ID

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 枠 / 角丸 / 描画方式を Editor 中心セル ([CellView.swift] body) と完全一致させる。
            // - cornerRadius: `cellCornerRadius` (= 8pt、card 専用 4pt は使わない)
            // - 描画方式: `.strokeBorder` (= 内側塗り)。`.stroke` だと clipShape 有無で visible 太さが変わるため、
            //   card (clip なし) と cell (clip あり) で見た目が約 2 倍ズレる。`.strokeBorder` は必ず shape 内側に
            //   描画するので両者で一致する
            // - 色 / 太さ: `Color.primary.opacity(0.4)` × `cellCenterBorder` (1.5pt = visible)
            // この一致が無いと matchedGeometryEffect の morph 中に shape が snap して別物に見える。
            RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius)
                .fill(NeutralPalette.cardBackground)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius)
                        .strokeBorder(Color.primary.opacity(0.4), lineWidth: LayoutConstants.cellCenterBorder)
                }
                .matchedGeometryEffect(id: "card-\(mandalart.id)", in: namespace, anchor: .center)
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
                    Text(displayText)
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

/// グリッド先頭に並ぶ「新規作成」用の dashed-border カード。tap で `handleCreateNewMandalart`
/// を呼ぶ。desktop の [`NewMandalartCard`](../../desktop/src/pages/DashboardPage.tsx) を移植。
/// - 既存 `MandalartCard` と同じ corner radius / 同じ caption スロット高さで整列する
///   (LazyVGrid の adaptive column が `MandalartCard` と同じ幅を割当てる)
/// - matchedGeometryEffect は **付けない** (morph 元が無いので default cross-dissolve で
///   Editor へ遷移する。desktop も同等)
/// - `squareSize` は + アイコンを viewport 比でスケールさせるためだけに使う
private struct NewMandalartCard: View {
    let squareSize: CGFloat
    let onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius)
                .strokeBorder(
                    Color.primary.opacity(0.25),
                    style: StrokeStyle(lineWidth: LayoutConstants.cellCenterBorder, dash: [6, 4])
                )
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    Image(systemName: "plus")
                        .font(.system(size: max(24, squareSize * 0.25), weight: .light))
                        .foregroundStyle(.secondary)
                }
                .contentShape(RoundedRectangle(cornerRadius: LayoutConstants.cellCornerRadius))
                .onTapGesture { onTap() }
                .accessibilityLabel("新規マンダラートを作成")
                .accessibilityAddTraits(.isButton)
            // MandalartCard の updatedAt caption と縦位置を揃えるための透明 placeholder。
            Text(" ")
                .font(.caption2)
                .accessibilityHidden(true)
        }
    }
}
