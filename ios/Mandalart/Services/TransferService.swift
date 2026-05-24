import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Export format / file document

/// Export 対応フォーマット (PNG / PDF は別 phase)。
enum ExportFormat: String, CaseIterable, Identifiable {
    case json
    case markdown
    case indentText

    var id: Self { self }

    var label: String {
        switch self {
        case .json: return "JSON"
        case .markdown: return "Markdown"
        case .indentText: return "インデントテキスト"
        }
    }

    var fileExtension: String {
        switch self {
        case .json: return "json"
        case .markdown: return "md"
        case .indentText: return "txt"
        }
    }

    var contentType: UTType {
        switch self {
        case .json: return .json
        case .markdown: return UTType(filenameExtension: "md") ?? .plainText
        case .indentText: return .plainText
        }
    }
}

/// Files.app への書き出しに使う `FileDocument`。テキスト系 3 フォーマットを汎用的に扱う。
/// `.fileExporter(document:)` に渡す。
struct MandalartExportDocument: FileDocument {
    static var readableContentTypes: [UTType] {
        [.json, .plainText, UTType(filenameExtension: "md") ?? .plainText]
    }

    var data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let d = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = d
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// Sanitize filename: 禁止文字 (`\\/:*?"<>|`) を `_` に置換して 40 文字でクリップ。
private func sanitizeFilename(_ raw: String) -> String {
    let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
    let cleaned = raw.unicodeScalars.map { invalid.contains($0) ? "_" : Character($0) }
    let str = String(cleaned).replacingOccurrences(of: "\n", with: " ")
    let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
    return String(trimmed.prefix(40))
}

private func exportTimestamp() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyyMMdd-HHmmss"
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: Date())
}

extension TransferService {
    /// マンダラート 1 件の Export ペイロード (= FileDocument + 推奨ファイル名 + UTType) を構築。
    /// 呼び出し側は `.fileExporter(...)` の引数にそのまま渡せる。
    static func buildExportPayload(
        for mandalart: Mandalart,
        format: ExportFormat,
        in context: ModelContext
    ) throws -> (document: MandalartExportDocument, filename: String, contentType: UTType) {
        let data: Data
        switch format {
        case .json:
            data = try TransferService.exportMandalartToJSONData(mandalart, in: context)
        case .markdown:
            let s = try TransferService.exportMandalartToMarkdown(mandalart, in: context)
            data = s.data(using: .utf8) ?? Data()
        case .indentText:
            let s = try TransferService.exportMandalartToIndentText(mandalart, in: context)
            data = s.data(using: .utf8) ?? Data()
        }
        let baseName = sanitizeFilename(mandalart.title.isEmpty ? "mandalart" : mandalart.title)
        let nameRoot = baseName.isEmpty ? "mandalart" : baseName
        let filename = "\(nameRoot)-\(exportTimestamp()).\(format.fileExtension)"
        return (MandalartExportDocument(data: data), filename, format.contentType)
    }

    /// セルを起点に GridSnapshot を構築する (= cell 単位の Export 用)。
    ///
    /// 動作分岐:
    /// - **中心セル (position=4)**: cell.gridId のグリッドをそのまま `exportToJSON` に流す
    ///   (= root / 独立並列 grid 全体を export)
    /// - **周辺セル + drilled child grid あり**: 最初の drilled grid を export
    ///   (= `exportToJSON` の merge 機構で cell が center として GridSnapshot に含まれる)
    /// - **周辺セル + drilled なし**: cell content を center とする synthetic GridSnapshot
    ///   (= cells 配列に position=4 のみ、children=[])
    static func exportCellAsSnapshot(
        cell: Cell,
        in context: ModelContext
    ) throws -> GridSnapshot {
        if cell.position == GridConstants.centerPosition {
            return try exportToJSON(gridId: cell.gridId, in: context)
        }
        let cellId = cell.id
        let drilledFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.parentCellId == cellId && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.sortOrder)]
        )
        if let drilled = try context.fetch(drilledFetch).first {
            return try exportToJSON(gridId: drilled.id, in: context)
        }
        // leaf peripheral: synthetic snapshot
        return GridSnapshot(
            grid: GridSnapshot.GridPayload(sortOrder: 0, memo: nil),
            cells: [GridSnapshot.CellInGrid(
                position: GridConstants.centerPosition,
                text: cell.text,
                imagePath: cell.imagePath,
                color: cell.color
            )],
            parentPosition: nil,
            children: []
        )
    }

    /// セル単位の Export ペイロードを構築。filename は `<cell.text>-<timestamp>.<ext>`。
    static func buildCellExportPayload(
        cell: Cell,
        format: ExportFormat,
        in context: ModelContext
    ) throws -> (document: MandalartExportDocument, filename: String, contentType: UTType) {
        let snapshot = try exportCellAsSnapshot(cell: cell, in: context)
        let data: Data
        switch format {
        case .json:
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            data = try encoder.encode(snapshot)
        case .markdown:
            data = snapshotToMarkdown(snapshot).data(using: .utf8) ?? Data()
        case .indentText:
            data = snapshotToIndentText(snapshot).data(using: .utf8) ?? Data()
        }
        let baseName = sanitizeFilename(cell.text.isEmpty ? "cell" : cell.text)
        let nameRoot = baseName.isEmpty ? "cell" : baseName
        let filename = "\(nameRoot)-\(exportTimestamp()).\(format.fileExtension)"
        return (MandalartExportDocument(data: data), filename, format.contentType)
    }

    /// 既存のセルに `GridSnapshot` をインポートする (= desktop の `importIntoCell` 相当)。
    ///
    /// 1. target cell の content (text / imagePath / color) を snapshot.cells[centerPosition] で上書き
    ///    (空の root だけが指定された場合は更新しない)
    /// 2. snapshot を新しい drilled grid として cell の配下に挿入
    ///    (X=C primary drilled、`ownsCenter=false` で cell 行は新規作成しない)
    ///
    /// **ロック中の呼び出しは UI 層で禁止すること** (この関数自体は guard を入れない)。
    static func importIntoCell(
        snapshot: GridSnapshot,
        cellId: String,
        in context: ModelContext
    ) throws {
        let cellFetch = FetchDescriptor<Cell>(
            predicate: #Predicate<Cell> { $0.id == cellId && $0.deletedAt == nil }
        )
        guard let cell = try context.fetch(cellFetch).first else {
            throw TransferError.gridNotFound(cellId)
        }
        let gridId = cell.gridId
        let gridFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == gridId && $0.deletedAt == nil }
        )
        guard let grid = try context.fetch(gridFetch).first else {
            throw TransferError.gridNotFound(gridId)
        }
        // 中心セルへのインポートは不可 (中心セルはそのグリッド自身のテーマなので drilled 子グリッドを
        // 生やせない)。UI 側で中心セルの import 項目は非表示にしているが、API 直叩き等の経路に備えた防御。
        // grid.centerCellId == cellId は root / 独立並列の自グリッド中心セルを的確に捕捉する
        // (X=C primary drilled の周辺セルは親 grid では周辺なので誤ブロックしない)。
        if grid.centerCellId == cellId {
            throw TransferError.centerCellNotAllowed
        }
        let mandalartId = grid.mandalartId
        let now = Date()

        // 1) インポート先セルの content を snapshot.cells[position=4] で上書き (= 値ありの場合のみ)
        if let root = snapshot.cells.first(where: { $0.position == GridConstants.centerPosition }) {
            let hasContent = !root.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || root.imagePath != nil
                || root.color != nil
            if hasContent {
                cell.text = root.text
                cell.imagePath = root.imagePath
                cell.color = root.color
                cell.updatedAt = now
            }
        }

        // 2) 新しい drilled grid として cellId を center にして挿入
        try importIntoGrid(
            snapshot: snapshot,
            mandalartId: mandalartId,
            centerCellId: cellId,
            parentCellId: cellId,
            sortOrder: 0,
            ownsCenter: false,
            in: context
        )
        try context.save()
    }
}


/// マンダラート全体の Export / Import を担う Service。
///
/// desktop の [`transfer.ts`](../../../desktop/src/lib/api/transfer.ts) +
/// [`import-parser.ts`](../../../desktop/src/lib/import-parser.ts) を Swift に移植したもの。
/// JSON フォーマットは **desktop と完全一致** しており、両プラットフォーム間で round-trip 可能。
///
/// 提供する 3 フォーマット:
/// - **JSON**: `GridSnapshot` 構造をそのまま encode (= 完全な階層保持、memo 含む)
/// - **Markdown**: 見出しレベル (`#` 階層) + memo は blockquote (= round-trip 可)
/// - **IndentText**: 2 スペースインデント (= memo は省略)
///
/// **PNG / PDF は別 phase**。
@MainActor
enum TransferService {

    // MARK: - Export

    /// 指定 grid を起点に、配下の grid 階層を BFS で traverse して `GridSnapshot` を構築する。
    /// 通常は root grid を渡して mandalart 全体をエクスポートする。
    ///
    /// X=C primary drilled grid (= 自グリッドに position=4 cell 行が無い) の場合は
    /// 親 peripheral cell を `position=4` として merge する (= snapshot の整合性のため)。
    static func exportToJSON(
        gridId: String,
        in context: ModelContext
    ) throws -> GridSnapshot {
        var visited = Set<String>()

        func fetchSnapshot(
            gId: String,
            sortOrder: Int,
            parentPosition: Int?
        ) throws -> GridSnapshot {
            visited.insert(gId)

            let gridFetch = FetchDescriptor<Grid>(
                predicate: #Predicate<Grid> { $0.id == gId && $0.deletedAt == nil }
            )
            guard let grid = try context.fetch(gridFetch).first else {
                throw TransferError.gridNotFound(gId)
            }

            // 自 grid 所属の cells を取得 (= position 順)。X=C primary drilled は center が無いので
            // 親 peripheral cell を別途読み込んで position=centerPosition として merge する。
            let cellFetch = FetchDescriptor<Cell>(
                predicate: #Predicate<Cell> { $0.gridId == gId && $0.deletedAt == nil },
                sortBy: [SortDescriptor(\.position)]
            )
            var allCells = try context.fetch(cellFetch)
            let centerCellId = grid.centerCellId
            let hasCenter = allCells.contains(where: { $0.id == centerCellId })
            if !hasCenter {
                let centerFetch = FetchDescriptor<Cell>(
                    predicate: #Predicate<Cell> { $0.id == centerCellId && $0.deletedAt == nil }
                )
                if let center = try context.fetch(centerFetch).first {
                    // position は merge 先 grid 用に CENTER で扱う (= source の position とは別)
                    // SwiftData @Model は値を変更すると DB に反映してしまうので、snapshot 用 dict で扱う
                    allCells.append(center)
                }
            }

            // snapshot 用 cells を構築 (= position の上書きを SwiftData インスタンス側でなく snapshot 側で行う)
            var snapCells: [GridSnapshot.CellInGrid] = allCells.map { c in
                let pos = (c.id == centerCellId && !hasCenter) ? GridConstants.centerPosition : c.position
                return GridSnapshot.CellInGrid(
                    position: pos,
                    text: c.text,
                    imagePath: c.imagePath,
                    color: c.color
                )
            }
            snapCells.sort { $0.position < $1.position }

            var children: [GridSnapshot] = []

            // 1) drilled descendants: 各 peripheral cell について parentCellId == cell.id の grid を列挙
            for c in allCells where c.position != GridConstants.centerPosition {
                let cId = c.id
                let drilledFetch = FetchDescriptor<Grid>(
                    predicate: #Predicate<Grid> { $0.parentCellId == cId && $0.deletedAt == nil },
                    sortBy: [SortDescriptor(\.sortOrder)]
                )
                let drilled = try context.fetch(drilledFetch)
                for d in drilled where !visited.contains(d.id) {
                    children.append(try fetchSnapshot(gId: d.id, sortOrder: d.sortOrder, parentPosition: c.position))
                }
            }

            // 2) parallels: 同じ parentCellId を共有する siblings (自身を除く)
            let parallels: [Grid]
            if let parentCellId = grid.parentCellId {
                let pFetch = FetchDescriptor<Grid>(
                    predicate: #Predicate<Grid> {
                        $0.parentCellId == parentCellId && $0.id != gId && $0.deletedAt == nil
                    },
                    sortBy: [SortDescriptor(\.sortOrder)]
                )
                parallels = try context.fetch(pFetch)
            } else {
                let mandalartId = grid.mandalartId
                let pFetch = FetchDescriptor<Grid>(
                    predicate: #Predicate<Grid> {
                        $0.mandalartId == mandalartId && $0.parentCellId == nil
                            && $0.id != gId && $0.deletedAt == nil
                    },
                    sortBy: [SortDescriptor(\.sortOrder)]
                )
                parallels = try context.fetch(pFetch)
            }
            for p in parallels where !visited.contains(p.id) {
                children.append(try fetchSnapshot(gId: p.id, sortOrder: p.sortOrder, parentPosition: nil))
            }

            return GridSnapshot(
                grid: GridSnapshot.GridPayload(sortOrder: sortOrder, memo: grid.memo),
                cells: snapCells,
                parentPosition: parentPosition,
                children: children
            )
        }

        let rootFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.id == gridId && $0.deletedAt == nil }
        )
        let rootSortOrder = (try context.fetch(rootFetch).first)?.sortOrder ?? 0
        return try fetchSnapshot(gId: gridId, sortOrder: rootSortOrder, parentPosition: nil)
    }

    /// マンダラート 1 件を JSON Data に変換する (= ファイル書き出し用)。
    /// 内部で root grid を見つけて `exportToJSON(gridId:)` を呼び出す。
    static func exportMandalartToJSONData(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) throws -> Data {
        let mandalartId = mandalart.id
        let rootFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.mandalartId == mandalartId && $0.parentCellId == nil && $0.deletedAt == nil
            }
        )
        guard let root = try context.fetch(rootFetch).first else {
            throw TransferError.rootGridNotFound(mandalart.id)
        }
        let snapshot = try exportToJSON(gridId: root.id, in: context)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(snapshot)
    }

    /// マンダラートを Markdown String に変換する。memo は blockquote 出力。
    static func exportMandalartToMarkdown(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) throws -> String {
        let snapshot = try snapshotForMandalart(mandalart, in: context)
        return snapshotToMarkdown(snapshot)
    }

    /// マンダラートを 2-space インデントテキストに変換する (memo は省略)。
    static func exportMandalartToIndentText(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) throws -> String {
        let snapshot = try snapshotForMandalart(mandalart, in: context)
        return snapshotToIndentText(snapshot)
    }

    private static func snapshotForMandalart(
        _ mandalart: Mandalart,
        in context: ModelContext
    ) throws -> GridSnapshot {
        let mandalartId = mandalart.id
        let rootFetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.mandalartId == mandalartId && $0.parentCellId == nil && $0.deletedAt == nil
            }
        )
        guard let root = try context.fetch(rootFetch).first else {
            throw TransferError.rootGridNotFound(mandalart.id)
        }
        return try exportToJSON(gridId: root.id, in: context)
    }

    // MARK: - Pure functions: snapshot → string

    /// `GridSnapshot` → Markdown 文字列。Level 1..6 は `#` 見出し、7 以降は箇条書き (`- `)。
    /// memo は見出し直下に blockquote (`> ...`)。
    static func snapshotToMarkdown(_ snapshot: GridSnapshot) -> String {
        let root = snapshotToExportNode(snapshot)
        var lines: [String] = []
        func walk(_ node: ExportNode, level: Int) {
            if level <= 6 {
                lines.append("\(String(repeating: "#", count: level)) \(node.text)")
            } else {
                let indent = String(repeating: "  ", count: level - 7)
                lines.append("\(indent)- \(node.text)")
            }
            if let memo = node.memo, !memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                for memoLine in memo.split(separator: "\n", omittingEmptySubsequences: false) {
                    lines.append("> \(memoLine)")
                }
            }
            for child in node.children {
                if level < 6 { lines.append("") }
                walk(child, level: level + 1)
            }
        }
        walk(root, level: 1)
        return lines.joined(separator: "\n")
    }

    /// `GridSnapshot` → 2-space インデントテキスト (memo は省略)。
    static func snapshotToIndentText(_ snapshot: GridSnapshot) -> String {
        let root = snapshotToExportNode(snapshot)
        var lines: [String] = []
        func walk(_ node: ExportNode, depth: Int) {
            let indent = String(repeating: "  ", count: depth)
            lines.append("\(indent)\(node.text)")
            for child in node.children {
                walk(child, depth: depth + 1)
            }
        }
        walk(root, depth: 0)
        return lines.joined(separator: "\n")
    }

    // MARK: - Internal: snapshot → ExportNode

    private struct ExportNode {
        var text: String
        var memo: String?
        var children: [ExportNode]
    }

    private static func snapshotToExportNode(_ snap: GridSnapshot) -> ExportNode {
        var byPosition: [Int: GridSnapshot.CellInGrid] = [:]
        for c in snap.cells { byPosition[c.position] = c }
        let centerText = byPosition[GridConstants.centerPosition]?.text ?? ""

        var subsByPos: [Int: [GridSnapshot]] = [:]
        var parallels: [GridSnapshot] = []
        for child in snap.children {
            if let pp = child.parentPosition {
                subsByPos[pp, default: []].append(child)
            } else {
                parallels.append(child)
            }
        }

        var children: [ExportNode] = []
        // 周辺セルを peripheralPositionsByTab 順に展開 (= 空セルは省略、round-trip で順序保持)
        for pos in GridConstants.peripheralPositionsByTab {
            let cell = byPosition[pos]
            let text = cell?.text ?? ""
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            let subs = subsByPos[pos] ?? []
            let grandchildren = subs.flatMap { snapshotToExportNode($0).children }
            let subMemo = subs.first?.grid.memo
            children.append(ExportNode(text: text, memo: subMemo, children: grandchildren))
        }

        // 並列グリッド: 同階層 peripherals に平坦化して append (= import の overflow → parallel の逆変換)
        for parallel in parallels {
            children.append(contentsOf: snapshotToExportNode(parallel).children)
        }

        return ExportNode(
            text: centerText,
            memo: snap.grid.memo,
            children: children
        )
    }

    // MARK: - Import (parse)

    /// テキストを `GridSnapshot` に変換する。先頭が `#` なら Markdown、それ以外は IndentText 扱い。
    /// 返り値が cells/children 共に空なら呼出側でエラー扱いにする。
    static func parseTextToSnapshot(_ text: String) -> GridSnapshot {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let nodes: [ParsedNode]
        if trimmed.hasPrefix("#") {
            nodes = parseMarkdown(trimmed)
        } else {
            nodes = parseIndentText(trimmed)
        }
        guard let root = nodes.first else {
            return GridSnapshot(
                grid: GridSnapshot.GridPayload(sortOrder: 0, memo: nil),
                cells: [],
                parentPosition: nil,
                children: []
            )
        }
        return nodeToGrid(node: root, sortOrder: 0, parentPosition: nil)
    }

    // MARK: - Internal: parse helpers

    private struct ParsedNode {
        var text: String
        var children: [ParsedNode]
    }

    /// 行頭の箇条書き記号 (・ • ◦ ▪ ▫ ○ ● ◆ ◇ ■ □ ★ ☆ / `- ` / `* ` / `+ ` / `1. ` / `1) `) を除去。
    private static func stripBulletMarker(_ text: String) -> String {
        let pattern = #"^([・•◦▪▫○●◆◇■□★☆]|[-*+](?=\s)|\d+[.)](?=\s))\s*"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: "")
    }

    private static func parseIndentText(_ text: String) -> [ParsedNode] {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0) }
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var root: [ParsedNode] = []
        // ParsedNode は struct (値型) なのでスタックには path をインデックスで持つ
        // 階層は (depth: indent, path: [ルートからのインデックス列]) で表現する
        var stack: [(indent: Int, path: [Int])] = []

        for line in lines {
            let indent = line.prefix(while: { $0 == " " || $0 == "\t" }).count
            let content = stripBulletMarker(String(line.drop(while: { $0 == " " || $0 == "\t" })))
            let trimmed = content.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            let node = ParsedNode(text: trimmed, children: [])

            while let top = stack.last, top.indent >= indent {
                stack.removeLast()
            }

            if let parent = stack.last {
                appendChild(into: &root, atPath: parent.path, child: node)
                let newPath = parent.path + [
                    childCount(in: root, atPath: parent.path) - 1
                ]
                stack.append((indent: indent, path: newPath))
            } else {
                root.append(node)
                stack.append((indent: indent, path: [root.count - 1]))
            }
        }
        return root
    }

    private static func parseMarkdown(_ text: String) -> [ParsedNode] {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0) }
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var root: [ParsedNode] = []
        var stack: [(level: Int, path: [Int])] = []

        let pattern = #"^(#{1,6})\s+(.+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

        for line in lines {
            let nsLine = line as NSString
            let range = NSRange(location: 0, length: nsLine.length)
            guard let match = regex.firstMatch(in: line, range: range), match.numberOfRanges >= 3 else { continue }
            let level = nsLine.substring(with: match.range(at: 1)).count
            let raw = nsLine.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
            let content = stripBulletMarker(raw).trimmingCharacters(in: .whitespaces)
            if content.isEmpty { continue }
            let node = ParsedNode(text: content, children: [])

            while let top = stack.last, top.level >= level {
                stack.removeLast()
            }

            if let parent = stack.last {
                appendChild(into: &root, atPath: parent.path, child: node)
                let newPath = parent.path + [
                    childCount(in: root, atPath: parent.path) - 1
                ]
                stack.append((level: level, path: newPath))
            } else {
                root.append(node)
                stack.append((level: level, path: [root.count - 1]))
            }
        }
        return root
    }

    /// `root` 配列の `path` で示される位置のノードに `child` を追加。
    private static func appendChild(into root: inout [ParsedNode], atPath path: [Int], child: ParsedNode) {
        if path.isEmpty {
            root.append(child)
            return
        }
        var indexes = path
        let firstIdx = indexes.removeFirst()
        appendChildHelper(node: &root[firstIdx], remainingPath: indexes, child: child)
    }

    private static func appendChildHelper(node: inout ParsedNode, remainingPath: [Int], child: ParsedNode) {
        if remainingPath.isEmpty {
            node.children.append(child)
            return
        }
        var indexes = remainingPath
        let nextIdx = indexes.removeFirst()
        appendChildHelper(node: &node.children[nextIdx], remainingPath: indexes, child: child)
    }

    private static func childCount(in root: [ParsedNode], atPath path: [Int]) -> Int {
        if path.isEmpty { return root.count }
        var node = root[path[0]]
        for idx in path.dropFirst() {
            node = node.children[idx]
        }
        return node.children.count
    }

    /// `ParsedNode` を 1 つの GridSnapshot に変換する。
    /// 中心セル: node.text、周辺: 最初の 8 子 (= peripheralPositionsByTab 順)、孫がいる周辺は subgrid。
    /// 9 個目以降の子は 8 個ごとに並列グリッドとして children に append。
    private static func nodeToGrid(
        node: ParsedNode,
        sortOrder: Int,
        parentPosition: Int?
    ) -> GridSnapshot {
        let firstEight = Array(node.children.prefix(8))
        var cells: [GridSnapshot.CellInGrid] = [
            GridSnapshot.CellInGrid(
                position: GridConstants.centerPosition,
                text: node.text,
                imagePath: nil,
                color: nil
            )
        ]
        for (i, child) in firstEight.enumerated() {
            cells.append(GridSnapshot.CellInGrid(
                position: GridConstants.peripheralPositionsByTab[i],
                text: child.text,
                imagePath: nil,
                color: nil
            ))
        }

        var children: [GridSnapshot] = []
        for (i, child) in firstEight.enumerated() where !child.children.isEmpty {
            children.append(nodeToGrid(
                node: child,
                sortOrder: 0,
                parentPosition: GridConstants.peripheralPositionsByTab[i]
            ))
        }

        // 9 個目以降を 8 個ずつ並列グリッドに分割
        let overflow = Array(node.children.dropFirst(8))
        var parallelSort = sortOrder + 1
        var i = 0
        while i < overflow.count {
            let chunk = Array(overflow[i..<min(i + 8, overflow.count)])
            let pseudo = ParsedNode(text: node.text, children: chunk)
            children.append(nodeToGrid(node: pseudo, sortOrder: parallelSort, parentPosition: nil))
            parallelSort += 1
            i += 8
        }

        return GridSnapshot(
            grid: GridSnapshot.GridPayload(sortOrder: sortOrder, memo: nil),
            cells: cells,
            parentPosition: parentPosition,
            children: children
        )
    }

    // MARK: - Import (insert into SwiftData)

    /// `GridSnapshot` を新規マンダラートとしてローカル DB に挿入する。
    /// `targetFolderId` が nil なら Inbox folder にフォールバック。
    /// 戻り値は新規作成された Mandalart。
    @discardableResult
    static func importFromJSON(
        snapshot: GridSnapshot,
        targetFolderId: String? = nil,
        in context: ModelContext
    ) throws -> Mandalart {
        let mandalartId = IDGenerator.uuid()
        let now = Date()
        let centerText = snapshot.cells.first(where: { $0.position == GridConstants.centerPosition })?.text ?? ""
        let resolvedFolderId = try targetFolderId ?? FolderRepository.ensureInboxFolder(in: context).id

        // root center cell の id を先に決めて mandalart を作る
        let rootCenterCellId = IDGenerator.uuid()
        let mandalart = Mandalart(
            id: mandalartId,
            title: centerText,
            rootCellId: rootCenterCellId,
            lastGridId: nil,
            folderId: resolvedFolderId,
            createdAt: now,
            updatedAt: now
        )
        context.insert(mandalart)

        try importIntoGrid(
            snapshot: snapshot,
            mandalartId: mandalartId,
            centerCellId: rootCenterCellId,
            parentCellId: nil,
            sortOrder: 0,
            ownsCenter: true,
            in: context
        )
        try context.save()
        return mandalart
    }

    /// `snapshot` を local DB に挿入する。
    /// - `ownsCenter == true`: 自グリッドで center cell を INSERT (root / 独立並列)
    /// - `ownsCenter == false`: X=C primary drilled (center は親 peripheral で既に存在、INSERT しない)
    private static func importIntoGrid(
        snapshot: GridSnapshot,
        mandalartId: String,
        centerCellId: String,
        parentCellId: String?,
        sortOrder: Int,
        ownsCenter: Bool,
        in context: ModelContext
    ) throws {
        let now = Date()
        let gridId = IDGenerator.uuid()
        let grid = Grid(
            id: gridId,
            mandalartId: mandalartId,
            centerCellId: centerCellId,
            parentCellId: parentCellId,
            sortOrder: sortOrder,
            memo: snapshot.grid.memo,
            createdAt: now,
            updatedAt: now
        )
        context.insert(grid)

        var insertedCellIdByPosition: [Int: String] = [:]
        var snapByPos: [Int: GridSnapshot.CellInGrid] = [:]
        for c in snapshot.cells { snapByPos[c.position] = c }

        for pos in 0..<GridConstants.gridCellCount {
            let c = snapByPos[pos]
            if pos == GridConstants.centerPosition {
                if ownsCenter {
                    // 自グリッドで center cell を INSERT (= root / 独立並列の center)
                    let centerCell = Cell(
                        id: centerCellId,
                        gridId: gridId,
                        position: pos,
                        text: c?.text ?? "",
                        color: c?.color,
                        imagePath: c?.imagePath,
                        createdAt: now,
                        updatedAt: now
                    )
                    context.insert(centerCell)
                    insertedCellIdByPosition[pos] = centerCellId
                }
                continue
            }
            // lazy cell creation: 空 peripheral は INSERT しない。
            // ただし drilled child grid から center として参照される場合 (= snapshot.children に
            // parentPosition=pos が含まれる) は参照整合性のため空でも INSERT する必要がある。
            let text = c?.text ?? ""
            let imagePath = c?.imagePath
            let color = c?.color
            let isPopulated = !text.isEmpty || imagePath != nil || color != nil
            let referencedByChild = snapshot.children.contains(where: { $0.parentPosition == pos })
            if !isPopulated && !referencedByChild { continue }
            let cell = Cell(
                id: IDGenerator.uuid(),
                gridId: gridId,
                position: pos,
                text: text,
                color: color,
                imagePath: imagePath,
                createdAt: now,
                updatedAt: now
            )
            context.insert(cell)
            insertedCellIdByPosition[pos] = cell.id
        }

        for child in snapshot.children {
            let parentPos = child.parentPosition
            if parentPos == nil || parentPos == GridConstants.centerPosition {
                // 並列グリッド: 独立した center cell を持つ。snapshot の position=4 内容を新 center に INSERT。
                // parentCellId は current grid から継承 (root parallel なら nil、drilled parallel なら親 peripheral)。
                let newCenterCellId = IDGenerator.uuid()
                try importIntoGrid(
                    snapshot: child,
                    mandalartId: mandalartId,
                    centerCellId: newCenterCellId,
                    parentCellId: parentCellId,
                    sortOrder: child.grid.sortOrder,
                    ownsCenter: true,
                    in: context
                )
                continue
            }
            guard let parentCellIdForDrill = insertedCellIdByPosition[parentPos!] else { continue }
            // primary drilled: X=C 維持 (= 新 cell は作らず親 peripheral を center として共有)
            try importIntoGrid(
                snapshot: child,
                mandalartId: mandalartId,
                centerCellId: parentCellIdForDrill,
                parentCellId: parentCellIdForDrill,
                sortOrder: child.grid.sortOrder,
                ownsCenter: false,
                in: context
            )
        }
    }

    // MARK: - Errors

    enum TransferError: Error, LocalizedError {
        case gridNotFound(String)
        case rootGridNotFound(String)
        case parseEmpty
        case decodeFailed(String)
        case centerCellNotAllowed

        var errorDescription: String? {
            switch self {
            case .gridNotFound(let id): return "Grid が見つかりません: \(id)"
            case .rootGridNotFound(let id): return "Mandalart \(id) の root grid が見つかりません"
            case .parseEmpty: return "パース結果が空です"
            case .decodeFailed(let msg): return "JSON のデコードに失敗: \(msg)"
            case .centerCellNotAllowed: return "中心セルにはインポートできません"
            }
        }
    }
}
