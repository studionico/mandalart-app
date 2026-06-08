import Foundation

/// security-scoped bookmark の生成 / 解決 / アクセススコープ管理。
///
/// iOS はサンドボックスのため、ユーザーが選んだ iCloud Drive 等のフォルダへ再起動後も
/// アクセスするには bookmark が必須。ローカル JSON ミラーの出力先フォルダ保持に使う。
enum SecurityScopedBookmark {
    /// ユーザー選択フォルダ URL から bookmark Data を作る。
    /// 注: `.withSecurityScope` は **macOS 専用** なので iOS では使わない (素の bookmarkData)。
    static func make(for url: URL) throws -> Data {
        try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    /// bookmark Data を URL に解決する。解決不能なら nil。`isStale` は呼び出し側で再生成判断に使う。
    static func resolve(_ data: Data) -> (url: URL, isStale: Bool)? {
        var isStale = false
        guard let url = try? URL(
            resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &isStale
        ) else { return nil }
        return (url, isStale)
    }

    /// security-scoped URL へのアクセスを開始 → body 実行 → 確実に停止する。
    /// temp ディレクトリ等スコープ不要の URL では startAccessing が false を返すが body は実行される。
    static func withAccess<T>(_ url: URL, _ body: () throws -> T) rethrows -> T {
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        return try body()
    }
}
