import Foundation

/// UUID 生成は **必ずこの helper 経由で行う**。
///
/// Swift の `UUID().uuidString` は大文字 (`09469F25-EA72-...`) を返すが、
/// desktop 版 (`crypto.randomUUID()`) は小文字 (`09469f25-ea72-...`) を返す。
/// cloud / SwiftData / SQLite はすべて TEXT 型で大小文字を区別するため、
/// iOS 側で生成した UUID を desktop が `===` 比較すると誤判定する経路がある
/// (例: `cell.id === gridData.center_cell_id` が drill-down 経路に落ちる)。
///
/// これを防ぐため、iOS 側でも **小文字統一** で UUID を生成する。
/// 詳細は [`docs/pitfalls.md`](../../docs/pitfalls.md) #6 参照。
enum IDGenerator {
    static func uuid() -> String {
        UUID().uuidString.lowercased()
    }
}
