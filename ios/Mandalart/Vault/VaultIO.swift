import Foundation

/// vault モード (Phase 2) の I/O アダプタ層 — `FileManager` の薄いラッパ (ロジックは持たない)。
/// desktop [`src/lib/vault/io.ts`](../../../desktop/src/lib/vault/io.ts) の Swift 移植。
///
/// desktop の「AppData 相対」vs「絶対パス」の二系統は iOS では **URL に一本化**する (呼び出し側が
/// 正しい URL を渡す)。watcher (desktop の `watchVault`) は iOS で任意フォルダ監視ができないため
/// 移植せず、後続 Stage で「アプリ復帰時に全スキャン」で代替する。
///
/// 注: 読み書きする URL は security-scoped (iCloud Drive のフォルダ等) の場合があるので、呼び出し側は
/// `VaultConfig.withSecurityScopedAccess(_:_:)` のスコープ内でこれらを使うこと。
enum VaultIO {

    /// vault 内の 1 マンダラートフォルダを読み、VaultFile[] (path はファイル名) を返す。
    static func scanMandalartDir(_ dir: URL) throws -> [VaultFile] {
        let entries = try FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]
        )
        var files: [VaultFile] = []
        for url in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard url.pathExtension == "md" else { continue }
            let isFile = (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
            guard isFile else { continue }
            let content = try String(contentsOf: url, encoding: .utf8)
            files.append(VaultFile(path: url.lastPathComponent, content: content))
        }
        return files
    }

    /// vault ルート直下の各サブフォルダ (= 1 マンダラート) を走査する。
    /// `_mandalart.md` を持つフォルダだけを対象にし、`.` 始まり (.obsidian 等) は無視する。
    static func scanVault(_ root: URL) throws -> [MandalartVaultFiles] {
        let entries = try FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: []
        )
        var result: [MandalartVaultFiles] = []
        for url in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = url.lastPathComponent
            if name.hasPrefix(".") { continue }
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            guard isDir else { continue }
            let files = try scanMandalartDir(url)
            if files.contains(where: { $0.path == mandalartDocName }) {
                result.append(MandalartVaultFiles(dirName: name, files: files))
            }
        }
        return result
    }

    /// フォルダが無ければ作る (中間フォルダも含めて)。
    static func ensureDir(_ url: URL) throws {
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    /// 1 テキストファイルを書く (親フォルダは事前に ensureDir すること)。
    static func writeVaultFile(_ url: URL, content: String) throws {
        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    /// 1 ファイルを削除する (flush の差分削除で使用)。存在しなければ no-op。
    static func removeVaultFile(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    /// フォルダを再帰削除する (flush で DB から消えたマンダラートの dir を消すのに使用)。
    static func removeDir(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    /// パス (URL) の存在確認。
    static func pathExists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    /// URL から binary を読む (画像 attachments)。欠損/失敗時は nil。
    static func readBytes(_ url: URL) -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try? Data(contentsOf: url)
    }

    /// URL へ binary を書く (親は事前に ensureDir すること)。
    static func writeBytes(_ url: URL, _ data: Data) throws {
        try data.write(to: url)
    }
}
