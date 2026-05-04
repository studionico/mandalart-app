import Foundation

/// オフライン / サインイン前に permanent delete されたマンダラートの id を保持する tombstone。
///
/// **背景**: ローカルから物理削除しただけでは cloud に行が残るため、次回 pull で zombie 復活する
/// (落とし穴 #6)。permanent delete の時点で cloud 削除が失敗 (= 未サインイン or ネット断 or RLS 等)
/// したら id を tombstone に積み、**次回 pullAll の冒頭で drain** して cloud cascade delete を
/// リトライする。drain 成功で tombstone から除去。
///
/// UserDefaults に `Set<String>` を `[String]` 配列として永続化。
enum CloudDeleteTombstone {
    private static let key = "mandalart.cloudDeleteTombstones.mandalarts"

    /// 追加 (重複は Set で吸収)
    static func add(_ mandalartId: String) {
        var ids = current()
        ids.insert(mandalartId)
        save(ids)
    }

    /// 除去 (drain 成功時)
    static func remove(_ mandalartId: String) {
        var ids = current()
        ids.remove(mandalartId)
        save(ids)
    }

    /// 現在の tombstone 一覧
    static func current() -> Set<String> {
        let arr = UserDefaults.standard.array(forKey: key) as? [String] ?? []
        return Set(arr)
    }

    private static func save(_ ids: Set<String>) {
        UserDefaults.standard.set(Array(ids), forKey: key)
    }
}
