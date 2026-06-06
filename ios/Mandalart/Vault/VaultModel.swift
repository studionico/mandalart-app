import Foundation

/// 1 マンダラート分の DB 行 ⇄ vault ファイル群 の純変換 (I/O なし、INSERT しない)。
/// desktop [`src/lib/vault/vaultModel.ts`](../../../desktop/src/lib/vault/vaultModel.ts) の Swift 移植。
///
/// vault レイアウト (マンダラートフォルダ内):
///   _mandalart.md     ... マンダラート単位メタ + 所属フォルダ名
///   <gridId>.md       ... grid 1 つ + その cells (lazy: 空 peripheral は含めない)
///
/// 真の id は各ファイルの frontmatter にあり、フォルダ名 / ファイル名は表示用。

/// `_mandalart.md` ファイル名 (desktop: `MANDALART_DOC_NAME`)。
let mandalartDocName = "_mandalart.md"
/// `_mandalart.md` への wiki-link 先 (basename、拡張子なし)。ルートグリッドの戻りリンク用。
private let mandalartDocLink = String(mandalartDocName.dropLast(".md".count))

/// パス/ファイル名に使えない文字を `-` に畳み、空なら untitled。
func slugifyTitle(_ title: String) -> String {
    var s = title.trimmingCharacters(in: .whitespacesAndNewlines)
    s = s.replacingOccurrences(of: "[/\\\\:*?\"<>|]+", with: "-", options: .regularExpression)
    s = s.replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
    s = s.replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
    s = s.replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
    return s.isEmpty ? "untitled" : s
}

/// マンダラートフォルダ名 = `<title-slug>-<id6>` (表示用)。
func mandalartDirName(_ title: String, _ id: String) -> String {
    "\(slugifyTitle(title))-\(id.prefix(6))"
}

/// グリッドの中心テキスト (戻りリンクのラベル用)。自グリッド position=4 のセル text があればそれ、
/// 無ければ (X=C drilled) 親 peripheral セルの text (中心セル 3 パターンの merge ルール)。
private func gridCenterText(_ grid: VaultGrid, _ cellsOfGrid: [VaultCell], _ cellById: [String: VaultCell]) -> String {
    if let own = cellsOfGrid.first(where: { $0.position == GridConstants.centerPosition }) {
        let t = own.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
    }
    if let pcid = grid.parentCellId, let pc = cellById[pcid] {
        let t = pc.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
    }
    return ""
}

/// DB 行 → vault ファイル群。
func mandalartToVaultFiles(_ rows: MandalartRows) -> MandalartVaultFiles {
    let mandalart = rows.mandalart
    let grids = rows.grids
    let cells = rows.cells

    var cellsByGrid: [String: [VaultCell]] = [:]
    for c in cells { cellsByGrid[c.gridId, default: []].append(c) }
    let cellById = Dictionary(cells.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
    let cellToGrid = Dictionary(cells.map { ($0.id, $0.gridId) }, uniquingKeysWith: { _, new in new })
    let gridById = Dictionary(grids.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })

    // lazy grid: cells も memo も無い空グリッドは vault に焼かない。drill で生成され drill-up で
    // auto-cleanup される空 X=C drilled grid (= ナビゲーション由来) がファイル churn を起こすのを防ぐ。
    func isWritten(_ g: VaultGrid) -> Bool {
        let gc = cellsByGrid[g.id] ?? []
        let memoEmpty = (g.memo ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return !(gc.isEmpty && memoEmpty)
    }

    // 親→子リンク: 親セル id → 子グリッド id。実在ファイル (= 焼くグリッド) にだけリンクを張る。
    var childByCell: [String: String] = [:]
    for g in grids {
        if let pc = g.parentCellId, isWritten(g) { childByCell[pc] = g.id }
    }
    // ルートグリッド (= _mandalart.md からの順方向リンク先)。
    let rootGrid = grids.first { $0.parentCellId == nil && $0.centerCellId == mandalart.rootCellId }
        ?? grids.first { $0.parentCellId == nil }
    // フォルダ名/戻りリンクの表示タイトル: mandalart.title は denormalized で空のことがあるので、
    // 空ならルート中心セルの text を使う。
    let displayTitle: String = {
        let t = mandalart.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
        if let rg = rootGrid { return gridCenterText(rg, cellsByGrid[rg.id] ?? [], cellById) }
        return ""
    }()

    var files: [VaultFile] = [
        VaultFile(
            path: mandalartDocName,
            content: buildMandalartDoc(mandalart, folderName: rows.folderName, rootGridId: rootGrid?.id)
        )
    ]
    // grid は sort_order → id の決定的順序でファイル化 (差分を安定させる)
    let orderedGrids = grids.sorted {
        $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : $0.id < $1.id
    }
    for grid in orderedGrids {
        if !isWritten(grid) { continue }
        let gridCells = cellsByGrid[grid.id] ?? []
        // 戻りリンク (子→親): 子グリッドは親セルから親グリッドへ、ルート/独立並列グリッドは _mandalart.md へ。
        var parent: (gridId: String, label: String)?
        if let pcid = grid.parentCellId {
            if let parentGridId = cellToGrid[pcid] {
                let label: String = {
                    if let pg = gridById[parentGridId] {
                        let t = gridCenterText(pg, cellsByGrid[pg.id] ?? [], cellById)
                        if !t.isEmpty { return t }
                    }
                    let pcText = (cellById[pcid]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    return pcText.isEmpty ? "親グリッド" : pcText
                }()
                parent = (parentGridId, label)
            }
        } else {
            // ルート/独立並列グリッド → _mandalart.md へ戻る (順方向の _mandalart→root と対の双方向)。
            parent = (mandalartDocLink, displayTitle.isEmpty ? "(無題)" : displayTitle)
        }
        files.append(
            VaultFile(
                path: "\(grid.id).md",
                content: buildGridDocument(grid, gridCells, links: GridBodyLinks(childByCell: childByCell, parent: parent))
            )
        )
    }

    return MandalartVaultFiles(dirName: mandalartDirName(displayTitle, mandalart.id), files: files)
}

/// vault ファイル群 → DB 行。`_mandalart.md` が無い / 壊れている場合は nil。
/// grid ファイルの parse 失敗は skip+warn (誤削除しない方針、parse できた分だけ返す)。
///
/// `applyBody`: grid 本文 (人間可読ビュー) の編集 (text/color/done/image/memo) を frontmatter に canonical
/// マージするか。vault→DB 取り込み (`reconcileVaultToDb`) は true で本文編集を反映、DB→vault 方向で existing を
/// 読むだけの呼び出し (`flushDbToVault` / `dryRunScan`) は false (mandalart.id だけ要るので body 不要)。
func vaultFilesToRows(_ files: [VaultFile], applyBody: Bool = false) -> MandalartRows? {
    guard let mandalartFile = files.first(where: { $0.path == mandalartDocName }),
          let parsedMandalart = parseMandalartDoc(mandalartFile.content) else { return nil }

    let mandalart = parsedMandalart.mandalart
    var grids: [VaultGrid] = []
    var cells: [VaultCell] = []

    for file in files {
        if file.path == mandalartDocName { continue }
        if !file.path.hasSuffix(".md") { continue }
        guard let parsed = parseGridDocument(file.content, mandalartId: mandalart.id, applyBody: applyBody) else {
            print("[vault] grid ファイルの parse をスキップ: \(file.path)")
            continue
        }
        grids.append(parsed.grid)
        cells.append(contentsOf: parsed.cells)
    }

    return MandalartRows(mandalart: mandalart, folderName: parsedMandalart.folderName, grids: grids, cells: cells)
}
