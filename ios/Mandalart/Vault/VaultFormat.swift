import Foundation

/// vault の grid ファイル (`<gridId>.md`) と mandalart ファイル (`_mandalart.md`) の
/// build / parse (ピュア、I/O なし)。frontmatter に DB 行を焼き、本文は人間可読ビュー。
/// desktop [`src/lib/vault/vaultFormat.ts`](../../../desktop/src/lib/vault/vaultFormat.ts) の Swift 移植。

/// grid 行から種別ラベルを導出 (frontmatter に明示記録して 3 種推論を排除)。
func gridKind(parentCellId: String?, centerCellId: String) -> GridKind {
    if parentCellId == nil { return .root }
    if centerCellId == parentCellId { return .drilled }
    return .parallel
}

/// 本文ビューに焼く Obsidian リンク情報 (任意)。本文は表示専用で parse は読まないので、リンクの
/// 有無はデータ往復に影響しない。
/// - `childByCell`: セル id → そのセルが drill した子グリッド id (親→子リンク)。
/// - `parent`: 自グリッドの親グリッドへの戻りリンク (子→親リンク、ルートは無し)。
struct GridBodyLinks {
    var childByCell: [String: String]?
    var parent: (gridId: String, label: String)?

    init(childByCell: [String: String]? = nil, parent: (gridId: String, label: String)? = nil) {
        self.childByCell = childByCell
        self.parent = parent
    }
}

// MARK: - grid ドキュメント

/// grid + その cells を `<gridId>.md` の内容に直列化する。`links` で本文に親子 wiki-link を出す。
func buildGridDocument(_ grid: VaultGrid, _ cells: [VaultCell], links: GridBodyLinks? = nil) -> String {
    let sg = SerializedGrid(
        id: grid.id,
        centerCellId: grid.centerCellId,
        parentCellId: grid.parentCellId,
        sortOrder: grid.sortOrder,
        memo: grid.memo,
        kind: gridKind(parentCellId: grid.parentCellId, centerCellId: grid.centerCellId),
        createdAt: grid.createdAt,
        updatedAt: grid.updatedAt
    )
    let sorted = cells.sorted { $0.position < $1.position }
    let sc: [SerializedCell] = sorted.map {
        SerializedCell(
            id: $0.id, position: $0.position, text: $0.text, imagePath: $0.imagePath,
            color: $0.color, done: $0.done, createdAt: $0.createdAt, updatedAt: $0.updatedAt
        )
    }
    return buildDoc(
        format: vaultFormat,
        fields: [("grid", encodeVaultJSON(sg)), ("cells", encodeVaultJSON(sc))],
        body: renderGridBody(sorted, memo: grid.memo, links: links)
    )
}

/// `<gridId>.md` を VaultGrid + VaultCell[] に復元する。format 不一致 / grid 欠損は nil (skip+warn)。
/// mandalart_id は file からは判らないので caller (vaultModel) が渡す。grid_id は file の grid.id。
///
/// `applyBody == true` のとき、frontmatter から組んだセルに **本文 (人間可読ビュー) の編集**
/// (text/color/done/image) と grid.memo を `VaultBody` で上書きする (本文ラウンドトリップ)。
/// 本番経路 (`vaultFilesToRows`) は applyBody=false のまま (= frontmatter のみ信頼)。Stage ③ で本番を true 化予定。
func parseGridDocument(_ content: String, mandalartId: String, applyBody: Bool = false) -> (grid: VaultGrid, cells: [VaultCell])? {
    let parsed = parseDoc(content)
    guard parsed.format == vaultFormat else { return nil }
    guard let gridJSON = parsed.fields["grid"],
          let sg = decodeVaultJSON(SerializedGrid.self, from: gridJSON) else { return nil }
    let sc: [SerializedCell] =
        parsed.fields["cells"].flatMap { decodeVaultJSON([SerializedCell].self, from: $0) } ?? []

    let grid = VaultGrid(
        id: sg.id,
        mandalartId: mandalartId,
        centerCellId: sg.centerCellId,
        parentCellId: sg.parentCellId,
        sortOrder: sg.sortOrder,
        memo: sg.memo,
        createdAt: sg.createdAt,
        updatedAt: sg.updatedAt
    )
    var cells: [VaultCell] = sc.map {
        VaultCell(
            id: $0.id, gridId: sg.id, position: $0.position, text: $0.text, imagePath: $0.imagePath,
            color: $0.color, done: $0.done, createdAt: $0.createdAt, updatedAt: $0.updatedAt
        )
    }

    var resultGrid = grid
    if applyBody {
        let bodyParse = parseGridBody(parsed.body)
        cells = mergeBody(frontCells: cells, parse: bodyParse, gridId: grid.id, timestamp: grid.updatedAt)
        if case .set(let memo) = bodyParse.memo {
            resultGrid.memo = memo
        }
    }
    return (resultGrid, cells)
}

// MARK: - mandalart ドキュメント

/// mandalart 行 + 所属フォルダ名を `_mandalart.md` の内容に直列化する。
/// `rootGridId` を渡すと本文 H1 をルートグリッドへの wiki-link にする (順方向リンク)。
func buildMandalartDoc(_ mandalart: VaultMandalart, folderName: String, rootGridId: String? = nil) -> String {
    let sm = SerializedMandalart(
        id: mandalart.id,
        title: mandalart.title,
        rootCellId: mandalart.rootCellId,
        showCheckbox: mandalart.showCheckbox,
        sortOrder: mandalart.sortOrder,
        pinned: mandalart.pinned,
        locked: mandalart.locked,
        createdAt: mandalart.createdAt,
        updatedAt: mandalart.updatedAt
    )
    let title = mandalart.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "(無題)" : mandalart.title.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = rootGridId.map { "# \(wikiLink($0, title))" } ?? "# \(title)"
    return buildDoc(
        format: vaultFormat,
        fields: [("mandalart", encodeVaultJSON(sm)), ("folder_name", encodeVaultJSON(folderName))],
        body: body
    )
}

/// `_mandalart.md` を VaultMandalart + folderName に復元する。format 不一致 / mandalart 欠損は nil。
/// folder_id は vault には無い (folder_name が正) ので nil。user_id は local 専用なので ""。
func parseMandalartDoc(_ content: String) -> (mandalart: VaultMandalart, folderName: String)? {
    let parsed = parseDoc(content)
    guard parsed.format == vaultFormat else { return nil }
    guard let mandalartJSON = parsed.fields["mandalart"],
          let sm = decodeVaultJSON(SerializedMandalart.self, from: mandalartJSON) else { return nil }
    let folderName = parsed.fields["folder_name"].flatMap { decodeVaultJSON(String.self, from: $0) } ?? ""

    let mandalart = VaultMandalart(
        id: sm.id,
        userId: "",
        title: sm.title,
        rootCellId: sm.rootCellId,
        showCheckbox: sm.showCheckbox,
        lastGridId: nil, // 端末ローカル UI 状態。vault には保存しない (import で nil 復元)
        sortOrder: sm.sortOrder,
        pinned: sm.pinned,
        folderId: nil,
        locked: sm.locked,
        createdAt: sm.createdAt,
        updatedAt: sm.updatedAt
    )
    return (mandalart, folderName)
}

// MARK: - docContentEquivalent (churn 回避)

/// 2 つの vault ドキュメント (grid / mandalart どちら向きでも) が **`updated_at` を除いて** 内容
/// 等価かを判定する純関数。`updated_at` (grid / 各 cell / mandalart) はナビゲーション等で content
/// 未編集でも bump されるため、これを無視することで flush の churn を防ぐ。本文 (人間可読ビュー) も
/// 比較するが、本文は updated_at を含まず frontmatter から決定的に生成されるので churn 抑止は維持される。
func docContentEquivalent(_ a: String, _ b: String) -> Bool {
    let pa = parseDoc(a)
    let pb = parseDoc(b)
    if pa.body != pb.body { return false }
    return normalizedFieldsData(pa.fields) == normalizedFieldsData(pb.fields)
}

/// fields の各 JSON 値を `updated_at` 再帰除去 → `.sortedKeys` で正規化した 1 つの Data にする。
private func normalizedFieldsData(_ fields: [String: String]) -> Data? {
    var dict: [String: Any] = [:]
    for (key, json) in fields {
        let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])) ?? NSNull()
        dict[key] = stripUpdatedAt(obj)
    }
    return try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys])
}

/// object/array を再帰的に辿り `updated_at` キーを除去する (純粋、比較用)。
private func stripUpdatedAt(_ value: Any) -> Any {
    if let array = value as? [Any] {
        return array.map(stripUpdatedAt)
    }
    if let dict = value as? [String: Any] {
        var out: [String: Any] = [:]
        for (key, val) in dict where key != "updated_at" {
            out[key] = stripUpdatedAt(val)
        }
        return out
    }
    return value
}

// MARK: - 本文 (人間可読ビュー) レンダリング

/// Obsidian wiki-link (エイリアス記法)。リンク先はファイル名 (= `<gridId>.md` の basename)。
private func wikiLink(_ gridId: String, _ label: String) -> String {
    "[[\(gridId)|\(label)]]"
}

/// image_path から vault attachments 用の Obsidian/FS 安全なファイル名を作る。
/// basename を取り、Obsidian の `![[ ]]` を壊す文字 (特に `:` = pending synthetic cell id 由来) を `-` に畳む。
func attachmentName(_ imagePath: String) -> String {
    let base = imagePath.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? imagePath
    return base.replacingOccurrences(
        of: "[:*?\"<>|#^\\[\\]\\\\]+",
        with: "-",
        options: .regularExpression
    )
}

/// 色 → 本文タグ `#c/<color>`。preset key はそのまま、hex (先頭 `#`) は `hex-<digits>` に畳む。
/// 色なし (nil/空) は nil。VaultBody の parse と対の reversible 表現。
func colorTag(_ color: String?) -> String? {
    guard let color, !color.isEmpty else { return nil }
    if color.hasPrefix("#") {
        return "#c/hex-\(color.dropFirst())"
    }
    return "#c/\(color)"
}

/// セル見出し (本文ラウンドトリップ正準形): `<prefix> [done] <text or [[childId|text]]> #c/<color> ^p<N>`。
/// done は `[x]`/`[ ]`、color は `#c/...`、position は Obsidian block-ref `^pN`。VaultBody が逆に parse する。
private func renderCellHeading(_ prefix: String, _ cell: VaultCell, childByCell: [String: String]?) -> String {
    let done = cell.done ? "[x]" : "[ ]"
    let label = cell.text.trimmingCharacters(in: .whitespacesAndNewlines)
    var parts: [String] = [prefix, done]
    if let childId = childByCell?[cell.id] {
        parts.append(wikiLink(childId, label))
    } else if !label.isEmpty {
        parts.append(label)
    }
    if let tag = colorTag(cell.color) { parts.append(tag) }
    parts.append("^p\(cell.position)")
    return parts.joined(separator: " ")
}

/// セルの見出し + (画像があれば) Obsidian embed 行。非空セル (text / 子リンク / 画像のいずれか)
/// は必ず `^pN` 付き見出しを出す (= 本文から全フィールドを編集可能にするため)。
private func renderCellLines(
    _ prefix: String,
    _ cell: VaultCell,
    childByCell: [String: String]?,
    forceHeading: Bool = false
) -> [String] {
    let hasChild = childByCell?[cell.id] != nil
    let hasText = !cell.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let hasImage = !(cell.imagePath ?? "").isEmpty
    var lines: [String] = []
    if forceHeading || hasText || hasChild || hasImage {
        lines.append(renderCellHeading(prefix, cell, childByCell: childByCell))
    }
    if hasImage, let imagePath = cell.imagePath {
        lines.append("![[\(attachmentName(imagePath))]]")
    }
    return lines
}

/// grid の人間可読ビュー (本文)。中心を H1、非空の周辺を H2、memo を blockquote。parse は読まない。
private func renderGridBody(_ cellsSortedByPosition: [VaultCell], memo: String?, links: GridBodyLinks?) -> String {
    var lines: [String] = []
    // 子→親: 先頭に親グリッドへの戻りリンク (ルートは parent 無しなので出ない)。
    if let parent = links?.parent {
        lines.append("親: \(wikiLink(parent.gridId, parent.label))")
        lines.append("")
    }
    let center = cellsSortedByPosition.first { $0.position == GridConstants.centerPosition }
    if let center {
        lines.append(contentsOf: renderCellLines("#", center, childByCell: links?.childByCell, forceHeading: true))
    } else {
        lines.append("# (中心)")
    }
    if let memo, !memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        for memoLine in memo.components(separatedBy: "\n") {
            lines.append("> \(memoLine)")
        }
    }
    for cell in cellsSortedByPosition {
        if cell.position == GridConstants.centerPosition { continue }
        let hasText = !cell.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasImage = !(cell.imagePath ?? "").isEmpty
        let hasChild = links?.childByCell?[cell.id] != nil
        // テキスト・画像・子グリッドのいずれも無い空セルだけスキップ (画像だけのセルは残す)。
        if !hasText && !hasImage && !hasChild { continue }
        lines.append("")
        lines.append(contentsOf: renderCellLines("##", cell, childByCell: links?.childByCell))
    }
    return lines.joined(separator: "\n")
}
