import Foundation

/// ローカル JSON ミラーのファイル名生成 — 純関数。
/// desktop [`src/lib/mirror/mirrorFilename.ts`](../../../desktop/src/lib/mirror/mirrorFilename.ts) と parity。
///
/// `<slug(title)>-<id>.json` 形式。末尾の `-<id>` で一意性が保証され、rename / 削除時の
/// 差分掃除 (`MirrorSync`) の鍵になる。
enum MirrorFilename {
    /// FS で危険な文字 (パス区切り / 予約文字) + 空白 + ハイフン。空白化 → `-` 連結で正規化する。
    private static let unsafe: Set<Character> = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|", " ", "-"]

    /// タイトルをファイル名向けの slug に変換する。
    /// 危険文字を空白化 → 連続空白を 1 つの `-` に畳む → 前後 `-` 除去。空になれば `untitled`。
    static func slug(_ title: String) -> String {
        var spaced = ""
        for ch in title {
            spaced.append(unsafe.contains(ch) ? " " : ch)
        }
        let parts = spaced.split(separator: " ", omittingEmptySubsequences: true)
        let slug = parts.joined(separator: "-")
        return slug.isEmpty ? "untitled" : slug
    }

    /// マンダラート 1 件分のミラーファイル名 `<slug>-<id>.json`。
    static func make(title: String, id: String) -> String {
        "\(slug(title))-\(id).json"
    }
}
