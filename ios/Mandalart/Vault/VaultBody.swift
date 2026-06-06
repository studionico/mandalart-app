import Foundation

/// 本文ラウンドトリップのパース層 (ピュア、Foundation のみ)。
/// vault の `.md` 本文 (人間可読ビュー、`VaultFormat.renderGridBody` が生成) を読み取り、frontmatter から
/// 組んだセルに text/color/done/image と grid.memo を上書きする。frontmatter は id/created_at/position/構造の
/// バックボーン (母集合)、本文がこれらフィールドの正、という canonical マージ。
///
/// 本文編集が部分的に壊れても **フィールド単位でフォールバック** する (`.absent` = frontmatter 値を使う)
/// ことでサイレント全損を防ぐ。

/// 本文に該当マーカーが「あった/なかった」を区別する三値。`.absent` は frontmatter 値へフォールバック。
enum BodyField<T: Equatable>: Equatable {
    case set(T)
    case absent
}

/// 本文の 1 見出しから読み取ったセルの編集値。
struct BodyCellEdit: Equatable {
    var text: BodyField<String> = .absent
    var done: BodyField<Bool> = .absent
    var color: BodyField<String> = .absent
    /// 見出しの次行に `![[ ]]` embed があるか。.set(true)=画像維持 / .set(false)=画像クリア。
    var hasImage: BodyField<Bool> = .absent
}

/// 本文全体の parse 結果。
struct BodyParse: Equatable {
    var cellsByPosition: [Int: BodyCellEdit]
    var memo: BodyField<String>
}

/// `gridId` + position から決定的な新規セル id を作る (本文でセルを足したとき用)。
func synthCellId(_ gridId: String, _ position: Int) -> String {
    "\(gridId)-p\(position)"
}

/// 色タグの値 (`#c/` の後) → `Cell.color` 文字列。`hex-<digits>` は `#<digits>` に戻す。
func decodeColorTag(_ tag: String) -> String {
    if tag.hasPrefix("hex-") {
        return "#" + tag.dropFirst(4)
    }
    return tag
}

/// 本文を parse して position → 編集値、および memo を返す。
func parseGridBody(_ body: String) -> BodyParse {
    let lines = body.components(separatedBy: "\n")
    var cells: [Int: BodyCellEdit] = [:]
    var memoLines: [String] = []
    var sawMemo = false

    var i = 0
    while i < lines.count {
        let line = lines[i]
        if let parsed = parseHeadingLine(line) {
            var edit = parsed.1
            // 次行が embed なら画像あり、無ければ画像なし (クリア指示)。
            if i + 1 < lines.count, isEmbedLine(lines[i + 1]) {
                edit.hasImage = .set(true)
            } else {
                edit.hasImage = .set(false)
            }
            cells[parsed.0] = edit
            i += 1
            continue
        }
        if line.hasPrefix(">") {
            sawMemo = true
            var rest = Substring(line.dropFirst()) // ">" を除去
            if rest.first == " " { rest = rest.dropFirst() }
            memoLines.append(String(rest))
        }
        i += 1
    }

    return BodyParse(
        cellsByPosition: cells,
        memo: sawMemo ? .set(memoLines.joined(separator: "\n")) : .absent
    )
}

/// frontmatter のセル群に本文の編集を適用する。
/// - 既存 position はマッチして text/color/done/image を上書き (`.absent` は維持)。
/// - 本文にあり frontmatter に無い position は `synthCellId` で新規セル化。
/// - frontmatter にあり本文に無い position は **維持** (誤削除回避)。
func mergeBody(frontCells: [VaultCell], parse: BodyParse, gridId: String, timestamp: String) -> [VaultCell] {
    var result: [VaultCell] = []
    var usedPositions = Set<Int>()
    for var cell in frontCells {
        if let edit = parse.cellsByPosition[cell.position] {
            applyEdit(edit, to: &cell)
        }
        result.append(cell)
        usedPositions.insert(cell.position)
    }
    // 本文で追加された新 position
    for position in parse.cellsByPosition.keys.sorted() where !usedPositions.contains(position) {
        var cell = VaultCell(
            id: synthCellId(gridId, position), gridId: gridId, position: position, text: "",
            imagePath: nil, color: nil, done: false, createdAt: timestamp, updatedAt: timestamp
        )
        applyEdit(parse.cellsByPosition[position]!, to: &cell)
        result.append(cell)
    }
    return result
}

private func applyEdit(_ edit: BodyCellEdit, to cell: inout VaultCell) {
    if case .set(let text) = edit.text { cell.text = text }
    if case .set(let done) = edit.done { cell.done = done }
    if case .set(let color) = edit.color { cell.color = color }
    if case .set(let hasImage) = edit.hasImage, !hasImage {
        cell.imagePath = nil // 本文から embed が消えた = 画像クリア (embed 維持なら frontmatter の image_path を保持)
    }
}

// MARK: - 行パース

/// `![[ ... ]]` の embed 行か。
private func isEmbedLine(_ line: String) -> Bool {
    let t = line.trimmingCharacters(in: .whitespaces)
    return t.hasPrefix("![[") && t.hasSuffix("]]")
}

/// 見出し行 `<#/##> [done] <text or [[id|label]]> #c/<color> ^p<N>` を分解する。
/// `^pN` を持たない見出し (例 `# (中心)`) は round-trip 対象外で nil。
private func parseHeadingLine(_ line: String) -> (Int, BodyCellEdit)? {
    var s: String
    if line.hasPrefix("## ") {
        s = String(line.dropFirst(3))
    } else if line.hasPrefix("# ") {
        s = String(line.dropFirst(2))
    } else {
        return nil
    }

    // position: 末尾側の `^pN` (.backwards で最後の出現)
    guard let posRange = s.range(of: "\\^p[0-9]+", options: [.regularExpression, .backwards]),
          let position = Int(s[posRange].dropFirst(2)) else {
        return nil
    }
    s.removeSubrange(posRange)

    var edit = BodyCellEdit()

    // done: 先頭側の `[x]`/`[ ]`
    if let doneRange = s.range(of: "\\[[ xX]\\]", options: .regularExpression) {
        let marker = s[doneRange]
        edit.done = .set(marker.contains("x") || marker.contains("X"))
        s.removeSubrange(doneRange)
    }

    // color: `#c/<tag>`
    if let colorRange = s.range(of: "#c/[^ \\t]+", options: .regularExpression) {
        let tag = String(s[colorRange].dropFirst(3))
        edit.color = .set(decodeColorTag(tag))
        s.removeSubrange(colorRange)
    }

    // text: 残りを trim。`[[id|label]]` は label を取る。
    let remaining = s.trimmingCharacters(in: .whitespaces)
    edit.text = .set(wikiLinkLabel(remaining) ?? remaining)

    return (position, edit)
}

/// `[[id|label]]` から label を取り出す。wiki-link でなければ nil。
private func wikiLinkLabel(_ text: String) -> String? {
    guard text.hasPrefix("[["), text.hasSuffix("]]") else { return nil }
    let inner = text.dropFirst(2).dropLast(2)
    if let bar = inner.firstIndex(of: "|") {
        return String(inner[inner.index(after: bar)...])
    }
    return String(inner)
}
