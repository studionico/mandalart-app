import Foundation

/// 本文ラウンドトリップのパース層 (ピュア、Foundation のみ)。
/// vault の `.md` 本文 (人間可読ビュー、`VaultFormat.renderGridBody` が生成) を読み取り、frontmatter から
/// 組んだセルに text/color/done/image と grid.memo を上書きする。frontmatter は id/created_at/position/構造の
/// バックボーン (母集合)、本文がこれらフィールドの正、という canonical マージ。
///
/// 本文編集が部分的に壊れても **フィールド単位でフォールバック** する (`.absent` = frontmatter 値を使う)
/// ことでサイレント全損を防ぐ。

/// 中心セルを自前で持たない (X=C drilled) グリッドの本文 H1 placeholder。`^pN` を持たないが
/// **parse 失敗ではなく正規の出力**なので、本文「クリーン」判定 (削除可否) で例外扱いする。
/// VaultFormat.renderGridBody がこの文字列を出力する (単一情報源)。
let CENTER_PLACEHOLDER_LINE = "# (中心)"

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
    /// 本文が「クリーン」か = 全ての見出し (`#`/`##`) が有効に parse できた (`^pN` 付き or 中心 placeholder)。
    /// false = `^pN` を持たない見出し (グリッチ/手編集ミス) があった → mergeBody は安全のため削除を行わない。
    /// true のときだけ「本文に無い position は削除」を許可する (= ユーザーが見出し行を消した = 意図的削除)。
    var clean: Bool
}

/// `gridId` + position から決定的な新規セル id を作る (本文でセルを足したとき用)。
func synthCellId(_ gridId: String, _ position: Int) -> String {
    "\(gridId)-p\(position)"
}

/// wiki-link エイリアス用に改行を畳む。Obsidian の `[[id|alias]]` は alias に改行を含められない
/// (改行があると `]]` が次行に回りリンクが壊れる) ため、改行 + 前後空白の連を半角スペース 1 個に
/// 畳んで両端を trim する。リンク生成 (VaultFormat.wikiLink) と本文ラウンドトリップの no-op 判定
/// (applyEdit) で**同一関数を共用**することで、畳んだエイリアスを再取り込みしても改行を保持できる。
func collapseLinkLabel(_ s: String) -> String {
    let collapsed = s.replacingOccurrences(
        of: "\\s*\\n\\s*", with: " ", options: .regularExpression)
    return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// 色タグの値 (`#c/` の後) → `Cell.color` 文字列。`hex-<digits>` は `#<digits>` に戻す。
func decodeColorTag(_ tag: String) -> String {
    if tag.hasPrefix("hex-") {
        return "#" + tag.dropFirst(4)
    }
    return tag
}

/// 本文を parse して position → 編集値、および memo を返す。
///
/// 見出しは **複数行ブロック** で扱う: `# `/`## ` 行から次の見出し / memo (`>`) までを 1 ブロックに
/// 集約し、`^pN` (末尾の最後の出現)・`[done]`・`#c/color`・embed をブロック全体から抽出する。これにより
/// **改行を含むセル本文** (`## 発揮\n\n窮地に… ^p1` のように `^pN` が `##` と別行に来るケース) も
/// 取りこぼさない。`^pN` を持たないブロック (例 `# (中心)` placeholder) は round-trip 対象外。
func parseGridBody(_ body: String) -> BodyParse {
    let lines = body.components(separatedBy: "\n")
    var cells: [Int: BodyCellEdit] = [:]
    var memoLines: [String] = []
    var sawMemo = false
    var clean = true

    var i = 0
    while i < lines.count {
        let line = lines[i]
        if isHeadingLine(line) {
            // 見出しブロックを次の見出し / memo まで集める (空行・本文継続・embed を含む)。
            var block = [line]
            var j = i + 1
            while j < lines.count {
                if isHeadingLine(lines[j]) || lines[j].hasPrefix(">") { break }
                block.append(lines[j])
                j += 1
            }
            i = j
            if let parsed = parseHeadingBlock(block) {
                cells[parsed.0] = parsed.1
            } else if block[0] != CENTER_PLACEHOLDER_LINE {
                clean = false // ^pN 無し見出し (中心 placeholder 以外) = グリッチ
            }
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
        memo: sawMemo ? .set(memoLines.joined(separator: "\n")) : .absent,
        clean: clean
    )
}

/// `# ` / `## ` で始まる見出し行か。
private func isHeadingLine(_ line: String) -> Bool {
    line.hasPrefix("## ") || line.hasPrefix("# ")
}

/// frontmatter のセル群に本文の編集を適用する。
/// - 既存 position はマッチして text/color/done/image を上書き (`.absent` は維持)。
/// - 本文にあり frontmatter に無い position は `synthCellId` で新規セル化。
/// - frontmatter にあり本文に無い position:
///   - **本文がクリーン (parse.clean) なら削除** (= ユーザーが見出し行を消した = 意図的削除)。
///     ただし**中心セル (CENTER_POSITION) は削除しない** (構造の要)。子グリッドを持つ親セルの誤削除=孤児化は
///     VaultDbApply 側の参照ガードが別途防ぐ。
///   - **クリーンでないなら維持** (誤削除回避。`^pN` を壊した等のグリッチで黙ってセルを消さない)。
func mergeBody(frontCells: [VaultCell], parse: BodyParse, gridId: String, timestamp: String) -> [VaultCell] {
    var result: [VaultCell] = []
    var usedPositions = Set<Int>()
    for var cell in frontCells {
        if let edit = parse.cellsByPosition[cell.position] {
            applyEdit(edit, to: &cell)
        } else if parse.clean && cell.position != GridConstants.centerPosition {
            // クリーンな本文に見出しが無い = 意図的削除 → result から除外 (DB 側で VaultDbApply が削除)。
            continue
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
    if case .set(let text) = edit.text {
        // 子リンクのエイリアスは改行を空白に畳むため、本文値が frontmatter text の畳み形と
        // 一致するなら実編集ではない → 改行を保持 (リンク単一行化と改行保持の両立)。
        if cell.text.contains("\n"), text == collapseLinkLabel(cell.text) {
            // keep cell.text (frontmatter の改行を維持)
        } else {
            cell.text = text
        }
    }
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

/// 見出しブロック `<#/##> [done] <text or [[id|label]]> #c/<color> ^p<N>` (+ 改行を含む本文 + embed 行)
/// を分解する。先頭行から `#`/`##` マーカーを剥がし、embed 行を除いた残りから position (末尾の最後の
/// `^pN`)・done・color を抽出し、残りを text とする。`^pN` を持たないブロック (例 `# (中心)`) は nil。
private func parseHeadingBlock(_ block: [String]) -> (Int, BodyCellEdit)? {
    let first = block[0]
    var head: String
    if first.hasPrefix("## ") {
        head = String(first.dropFirst(3))
    } else if first.hasPrefix("# ") {
        head = String(first.dropFirst(2))
    } else {
        return nil
    }

    // embed (`![[ ]]`) 行を分離 (= 画像あり判定。text には含めない)。
    var hasImage = false
    var contentLines: [String] = []
    for l in [head] + block.dropFirst() {
        if isEmbedLine(l) {
            hasImage = true
        } else {
            contentLines.append(l)
        }
    }
    var s = contentLines.joined(separator: "\n")

    // position: ブロック全体の末尾側 `^pN` (.backwards で最後の出現)。改行入り本文では別行末に来る。
    guard let posRange = s.range(of: "\\^p[0-9]+", options: [.regularExpression, .backwards]),
          let position = Int(s[posRange].dropFirst(2)) else {
        return nil
    }
    s.removeSubrange(posRange)

    var edit = BodyCellEdit(hasImage: .set(hasImage))

    // done: 先頭側の `[x]`/`[ ]`
    if let doneRange = s.range(of: "\\[[ xX]\\]", options: .regularExpression) {
        let marker = s[doneRange]
        edit.done = .set(marker.contains("x") || marker.contains("X"))
        s.removeSubrange(doneRange)
    }

    // color: `#c/<tag>` (改行を跨がない)
    if let colorRange = s.range(of: "#c/[^ \\t\\n]+", options: .regularExpression) {
        let tag = String(s[colorRange].dropFirst(3))
        edit.color = .set(decodeColorTag(tag))
        s.removeSubrange(colorRange)
    }

    // text: 残りを trim (改行は保持)。`[[id|label]]` 単体なら label を取る。
    let remaining = s.trimmingCharacters(in: .whitespacesAndNewlines)
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
