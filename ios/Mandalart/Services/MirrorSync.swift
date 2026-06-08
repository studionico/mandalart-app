import Foundation
import SwiftData

/// ローカル JSON ミラー (一方向 DB→ファイル) の中核。
/// desktop [`src/lib/mirror/mirrorSync.ts`](../../../desktop/src/lib/mirror/mirrorSync.ts) と parity。
///
/// 各 live マンダラートを `<slug>-<id>.json` として出力先フォルダへ書き出し、自分が書いた過去の
/// ファイルで現行ファイル名に無いもの (rename / 削除/ゴミ箱) を掃除する。冪等。
/// **DB は一切書き換えない**ので auto-flush のフィードバックループは発生しない。取り込みもしない。
@MainActor
enum MirrorSync {
    static let formatVersion = 1

    /// ミラーファイル 1 件の内容。snapshot に加えマンダラートメタを包み自己記述的にする。
    struct Envelope: Codable {
        var version: Int
        var id: String
        var title: String
        var locked: Bool
        var pinned: Bool
        var folderId: String?
        var exportedAt: String
        var snapshot: GridSnapshot
    }

    /// 既存ファイルの id 判定用 (version + id だけ読む)。
    private struct EnvelopeHeader: Decodable {
        var version: Int
        var id: String
    }

    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// 全 live マンダラートを folder へミラーし、不要になった自分の過去ファイルを削除する。
    /// @returns 書込み件数 / 削除件数。
    @discardableResult
    static func mirrorAll(to folder: URL, in context: ModelContext) throws -> (written: Int, deleted: Int) {
        let fm = FileManager.default
        if !fm.fileExists(atPath: folder.path) {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let mandalarts = (try? context.fetch(FetchDescriptor<Mandalart>())) ?? []
        var expected = Set<String>()
        var written = 0

        for mandalart in mandalarts where mandalart.deletedAt == nil {
            guard let rootGridId = rootGridId(for: mandalart.id, in: context) else { continue }
            let snapshot = try TransferService.exportToJSON(gridId: rootGridId, in: context)
            let envelope = Envelope(
                version: formatVersion,
                id: mandalart.id,
                title: mandalart.title,
                locked: mandalart.locked,
                pinned: mandalart.pinned,
                folderId: mandalart.folderId,
                exportedAt: iso8601.string(from: Date()),
                snapshot: snapshot
            )
            let name = MirrorFilename.make(title: mandalart.title, id: mandalart.id)
            expected.insert(name)
            let data = try encoder.encode(envelope)
            try data.write(to: folder.appendingPathComponent(name), options: .atomic)
            written += 1
        }

        // 差分削除: 自分が書いた envelope ファイルのうち現行ファイル名集合に無いものを消す
        // (= id がもう live でない or タイトル変更で別名になった)。外部ファイルは触らない。
        var deleted = 0
        let entries = (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for entry in entries where entry.pathExtension == "json" {
            if expected.contains(entry.lastPathComponent) { continue }
            guard isOwnEnvelope(entry) else { continue } // 外部 / 壊れたファイルは残す (安全側)
            try? fm.removeItem(at: entry)
            deleted += 1
        }

        return (written, deleted)
    }

    /// マンダラートの primary root grid id (parentCellId == nil の root)。
    private static func rootGridId(for mandalartId: String, in context: ModelContext) -> String? {
        let fetch = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> {
                $0.mandalartId == mandalartId && $0.parentCellId == nil && $0.deletedAt == nil
            },
            sortBy: [SortDescriptor(\.sortOrder)]
        )
        return (try? context.fetch(fetch))?.first?.id
    }

    /// ファイルが mirror が書いた envelope か (version + id が読めるか)。
    private static func isOwnEnvelope(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url),
              let header = try? JSONDecoder().decode(EnvelopeHeader.self, from: data)
        else { return false }
        return !header.id.isEmpty
    }
}
