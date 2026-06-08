import Foundation

/// ローカル JSON ミラーの永続設定。
/// desktop [`src/lib/mirror/mirrorConfig.ts`](../../../desktop/src/lib/mirror/mirrorConfig.ts) の Swift 版。
///
/// iOS はサンドボックスのため出力先フォルダの再アクセスに **security-scoped bookmark が必須**。
/// よって真のハンドルは `mirrorBookmark: Data` で、`mirrorPath` は表示用ミラー。永続化は
/// `UserDefaults` (端末ローカル、フォルダ位置は cross-device 同期しない)。
///
/// 旧 vault の UserDefaults キー (`vault.bookmark` / `vault.path`) からは初回読込時に一度だけ
/// bookmark/path を引き継ぐ (`vault.mode` は捨てる。ミラーはクラウド同期を止めない)。
struct MirrorConfig: Equatable {
    /// true = DB 編集を選択フォルダへ自動ミラーする。
    var mirrorEnabled: Bool
    /// 出力先フォルダの security-scoped bookmark。未設定なら nil。
    var mirrorBookmark: Data?
    /// 表示用の出力先パス (真のアクセスは bookmark 経由)。未設定なら nil。
    var mirrorPath: String?

    static let empty = MirrorConfig(mirrorEnabled: false, mirrorBookmark: nil, mirrorPath: nil)
}

/// MirrorConfig の UserDefaults 永続化 (テストは `UserDefaults(suiteName:)` を注入)。
enum MirrorConfigStore {
    enum Keys {
        static let enabled = "mirror.enabled"
        static let bookmark = "mirror.bookmark"
        static let path = "mirror.path"
    }

    /// 旧 vault キー (一度だけ移行する用)。
    private enum LegacyKeys {
        static let mode = "vault.mode"
        static let bookmark = "vault.bookmark"
        static let path = "vault.path"
    }

    static func load(from defaults: UserDefaults = .standard) -> MirrorConfig {
        // 新キーが未設定で旧キーが在れば一度だけ移行する (bookmark/path のみ、mode は捨てる)。
        if defaults.object(forKey: Keys.bookmark) == nil,
           defaults.object(forKey: Keys.path) == nil,
           let legacyBookmark = defaults.data(forKey: LegacyKeys.bookmark) {
            let migrated = MirrorConfig(
                mirrorEnabled: false,
                mirrorBookmark: legacyBookmark,
                mirrorPath: defaults.string(forKey: LegacyKeys.path)
            )
            save(migrated, to: defaults)
            // 旧キーは役目を終えたので削除する (vault モードの残骸を残さない)。
            defaults.removeObject(forKey: LegacyKeys.mode)
            defaults.removeObject(forKey: LegacyKeys.bookmark)
            defaults.removeObject(forKey: LegacyKeys.path)
            return migrated
        }
        return MirrorConfig(
            mirrorEnabled: defaults.bool(forKey: Keys.enabled),
            mirrorBookmark: defaults.data(forKey: Keys.bookmark),
            mirrorPath: defaults.string(forKey: Keys.path)
        )
    }

    static func save(_ config: MirrorConfig, to defaults: UserDefaults = .standard) {
        defaults.set(config.mirrorEnabled, forKey: Keys.enabled)
        if let bookmark = config.mirrorBookmark {
            defaults.set(bookmark, forKey: Keys.bookmark)
        } else {
            defaults.removeObject(forKey: Keys.bookmark)
        }
        if let path = config.mirrorPath {
            defaults.set(path, forKey: Keys.path)
        } else {
            defaults.removeObject(forKey: Keys.path)
        }
    }
}
