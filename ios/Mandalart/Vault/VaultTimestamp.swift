import Foundation

/// vault ファイルに焼くタイムスタンプ (ISO8601 文字列) と SwiftData の `Date` の相互変換。
///
/// 形式は [`SyncEngine`](../Services/SyncEngine.swift) の `dateFormatter` と**同一**
/// (`[.withInternetDateTime, .withFractionalSeconds]` = `2026-06-02T00:00:00.000Z`)。これにより
/// vault ファイルのタイムスタンプが cloud / desktop の created_at/updated_at と一致し、クロスプラット
/// フォームで vault を共有しても round-trip する。ピュア (Foundation のみ) なのでユニットテスト可能。
enum VaultTimestamp {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Date → ISO8601 文字列 (fractional seconds + `Z`)。
    static func format(_ date: Date) -> String {
        formatter.string(from: date)
    }

    /// ISO8601 文字列 → Date。解釈不能なら nil。
    static func parse(_ string: String) -> Date? {
        formatter.date(from: string)
    }
}
