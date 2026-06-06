import Foundation

/// vault ファイル共通の frontmatter コーデック (ピュア、I/O なし)。
/// desktop [`src/lib/vault/frontmatter.ts`](../../../desktop/src/lib/vault/frontmatter.ts) の Swift 移植。
///
/// 各値を YAML block-scalar (`key: |-`) に **compact JSON 1 行**で格納する。JSON 内の任意文字
/// (`"` `:` `#` `'` 改行=`\n` エスケープ) をエスケープ不要で書けるため、YAML ライブラリに依存しない。
/// `format` だけは tooling から見えるよう inline プレーン文字列で持つ。

private let fence = "---"

// MARK: - JSON encode / decode helper

/// Encodable を **決定的** (`.sortedKeys`) な compact JSON 文字列に直列化する。
/// snake_case 変換 + slash 非エスケープ (desktop の `JSON.stringify` に揃える)。
func encodeVaultJSON<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8) else { return "null" }
    return json
}

/// block-scalar から取り出した生 JSON 文字列を型へデコードする。失敗時は nil (= キー欠損扱い)。
func decodeVaultJSON<T: Decodable>(_ type: T.Type, from json: String) -> T? {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(type, from: Data(json.utf8))
}

// MARK: - buildDoc / parseDoc

/// frontmatter + 本文ドキュメントを組み立てる。
/// - Parameters:
///   - format: `format:` に書く識別子 (改行を含まない前提)
///   - fields: block-scalar JSON で書く key→生 JSON 文字列 (順序保持のため配列)。各 json は
///     `encodeVaultJSON(...)` で作る
///   - body: frontmatter 直後の本文 (人間可読ビュー、parse 側は読まない)
func buildDoc(format: String, fields: [(key: String, json: String)], body: String) -> String {
    var lines: [String] = [fence, "format: \(format)"]
    for (key, json) in fields {
        lines.append("\(key): |-")
        lines.append("  \(json)")
    }
    lines.append(fence)
    lines.append("")
    lines.append(body)
    return lines.joined(separator: "\n")
}

/// `parseDoc` の結果。`fields` は key → block-scalar の生 JSON 文字列 (型へのデコードは caller)。
struct ParsedDoc {
    var format: String?
    var fields: [String: String]
    var body: String
}

/// buildDoc の逆。先頭 frontmatter を持たない / 壊れている場合は format=nil・fields=[:] を返す
/// (呼び出し側で skip+warn する)。CRLF も許容。
func parseDoc(_ text: String) -> ParsedDoc {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
    let lines = normalized.components(separatedBy: "\n")
    guard lines.first?.trimmingCharacters(in: .whitespaces) == fence else {
        return ParsedDoc(format: nil, fields: [:], body: normalized)
    }

    var close = -1
    for i in 1..<lines.count where lines[i].trimmingCharacters(in: .whitespaces) == fence {
        close = i
        break
    }
    if close == -1 {
        return ParsedDoc(format: nil, fields: [:], body: normalized)
    }

    let fm = Array(lines[1..<close])
    var body = lines[(close + 1)...].joined(separator: "\n")
    body = stripLeadingNewlines(body)

    var format: String?
    var fields: [String: String] = [:]

    var i = 0
    while i < fm.count {
        let line = fm[i]
        if let value = matchInlineFormat(line) {
            format = value.isEmpty ? nil : value
            i += 1
            continue
        }
        if let key = matchBlockKey(line) {
            var jsonLines: [String] = []
            var j = i + 1
            while j < fm.count {
                let l = fm[j]
                if hasIndentedContent(l) {
                    jsonLines.append(dedent(l))
                } else if l.trimmingCharacters(in: .whitespaces).isEmpty {
                    j += 1
                    continue
                } else {
                    break
                }
                j += 1
            }
            i = j
            let json = jsonLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !json.isEmpty {
                fields[key] = json
            }
            continue
        }
        i += 1
    }

    return ParsedDoc(format: format, fields: fields, body: body)
}

// MARK: - 行パース helper (正規表現非依存)

/// `format: <value>` 行から value を取り出す。format 行でなければ nil。
private func matchInlineFormat(_ line: String) -> String? {
    let prefix = "format:"
    guard line.hasPrefix(prefix) else { return nil }
    return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
}

/// `<word>: |-` / `<word>: |` 形式の block-scalar 開始行なら key を返す。
private func matchBlockKey(_ line: String) -> String? {
    guard let colon = line.firstIndex(of: ":") else { return nil }
    let key = String(line[line.startIndex..<colon])
    guard isWordToken(key) else { return nil }
    let rest = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
    return (rest == "|-" || rest == "|") ? key : nil
}

/// `\w+` (英数字 + アンダースコア、非空) 判定。
private func isWordToken(_ s: String) -> Bool {
    guard !s.isEmpty else { return false }
    return s.allSatisfy { $0 == "_" || $0.isLetter || $0.isNumber }
}

/// 先頭が空白 + その後に非空白がある行か (= block-scalar の内容行)。desktop の `^\s+\S`。
private func hasIndentedContent(_ line: String) -> Bool {
    guard let first = line.first, first == " " || first == "\t" else { return false }
    return !line.trimmingCharacters(in: .whitespaces).isEmpty
}

/// 先頭の空白を除去 (desktop の `replace(/^\s+/, '')`)。
private func dedent(_ line: String) -> String {
    var s = Substring(line)
    while let first = s.first, first == " " || first == "\t" {
        s = s.dropFirst()
    }
    return String(s)
}

/// 先頭の改行を除去 (desktop の `replace(/^\n+/, '')`)。
private func stripLeadingNewlines(_ s: String) -> String {
    var sub = Substring(s)
    while sub.first == "\n" {
        sub = sub.dropFirst()
    }
    return String(sub)
}
