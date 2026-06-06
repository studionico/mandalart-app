import Foundation

/// vault モードの永続設定。
/// desktop [`src/lib/vault/config.ts`](../../../desktop/src/lib/vault/config.ts) の Swift 移植。
///
/// desktop は vault ルートを `vaultPath: string` で持つが、iOS はサンドボックスのため再起動後の
/// iCloud Drive 再アクセスに **security-scoped bookmark が必須**。よって真のハンドルは
/// `vaultBookmark: Data` で、`vaultPath` は表示用ミラー。永続化は `UserDefaults` (端末ローカル、
/// vault フォルダ位置は cross-device 同期しない。`ThemePreference` / `MandalartFontPreference` と同様)。
struct VaultConfig: Equatable {
    /// true = vault を正として起動時に DB を再構築する (後続 Stage で本配線)。
    var vaultMode: Bool
    /// vault ルートフォルダの security-scoped bookmark。未設定なら nil。
    var vaultBookmark: Data?
    /// 表示用の vault パス (真のアクセスは bookmark 経由)。未設定なら nil。
    var vaultPath: String?

    static let empty = VaultConfig(vaultMode: false, vaultBookmark: nil, vaultPath: nil)
}

/// 起動時に vault→DB 再構築を行うべきか。vaultMode ON かつ bookmark 設定済みのときだけ true。
/// vaultMode true ＆ bookmark nil の不整合は「再構築しない」に倒す防御。
func shouldRebuildOnStartup(_ config: VaultConfig) -> Bool {
    config.vaultMode && config.vaultBookmark != nil
}

/// VaultConfig の UserDefaults 永続化 (テストは `UserDefaults(suiteName:)` を注入)。
enum VaultConfigStore {
    enum Keys {
        static let mode = "vault.mode"
        static let bookmark = "vault.bookmark"
        static let path = "vault.path"
    }

    static func load(from defaults: UserDefaults = .standard) -> VaultConfig {
        VaultConfig(
            vaultMode: defaults.bool(forKey: Keys.mode),
            vaultBookmark: defaults.data(forKey: Keys.bookmark),
            vaultPath: defaults.string(forKey: Keys.path)
        )
    }

    static func save(_ config: VaultConfig, to defaults: UserDefaults = .standard) {
        defaults.set(config.vaultMode, forKey: Keys.mode)
        if let bookmark = config.vaultBookmark {
            defaults.set(bookmark, forKey: Keys.bookmark)
        } else {
            defaults.removeObject(forKey: Keys.bookmark)
        }
        if let path = config.vaultPath {
            defaults.set(path, forKey: Keys.path)
        } else {
            defaults.removeObject(forKey: Keys.path)
        }
    }
}

/// security-scoped bookmark の生成 / 解決 / アクセススコープ管理。
enum VaultBookmark {
    /// iCloud Drive 等のユーザー選択フォルダ URL から bookmark Data を作る。
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
