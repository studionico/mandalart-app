import Foundation

/// セル画像の vault attachments 化 (vaultMode を cloud 非依存にする)。
/// desktop [`src/lib/vault/imageVault.ts`](../../../desktop/src/lib/vault/imageVault.ts) の Swift 移植。
///
/// 画像バイトはアプリ内では `<AppSupport>/images/<basename>` にあり、`cell.imagePath` は
/// `images/<basename>` (DB の正)。本モジュールは flush 時に vault ルート直下 `attachments/<basename>`
/// へコピーし、restore 時に vault→AppSupport へ書き戻す。**imagePath の意味は変えない**ので、アプリの
/// 画像表示経路 ([`ImageStorage.swift`](../Services/ImageStorage.swift): AppSupport/images を読む) は無改変。
///
/// テスト容易性のため `appSupportDir` / `vaultRoot` を**引数で受ける** (テストは temp ディレクトリを渡す)。
/// `ImageStorage` (Supabase + UIKit 依存) には**触れず**、画像はデコードせずバイトコピーするだけ。
enum VaultImageStore {

    static let attachmentsDirName = "attachments"

    /// production 呼び出し側 (後続 Stage) が渡す実 AppSupport ディレクトリ。
    /// `ImageStorage.imagePath` (= `images/...`) はこの URL からの相対。
    static func appSupportDirectory() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    }

    /// imagePath を持つセルだけ抽出。
    private static func withImage(_ cells: [VaultCell]) -> [(cell: VaultCell, imagePath: String)] {
        cells.compactMap { c in
            guard let p = c.imagePath, !p.isEmpty else { return nil }
            return (c, p)
        }
    }

    /// AppSupport/images → vault `attachments/` へ画像をコピー (コピー先が無いものだけ、best-effort)。
    /// ファイル名は `<cellId>-<ts>.jpg` で内容不変なので「無ければ書く」で済む。コピー数を返す。
    @discardableResult
    static func flushImagesToVault(vaultRoot: URL, appSupportDir: URL, cells: [VaultCell]) -> Int {
        let targets = withImage(cells)
        if targets.isEmpty { return 0 }
        let dir = vaultRoot.appendingPathComponent(attachmentsDirName, isDirectory: true)
        var ensured = false
        var copied = 0
        for (_, imagePath) in targets {
            let dest = dir.appendingPathComponent(attachmentName(imagePath))
            if VaultIO.pathExists(dest) { continue }
            // ローカルに無ければ skip (cloud 由来未 download 等)。
            guard let bytes = VaultIO.readBytes(appSupportDir.appendingPathComponent(imagePath)) else { continue }
            if !ensured {
                try? VaultIO.ensureDir(dir)
                ensured = true
            }
            if (try? VaultIO.writeBytes(dest, bytes)) != nil { copied += 1 }
        }
        return copied
    }

    /// vault `attachments/` → AppSupport/images へ画像を復元 (ローカルに無いものだけ、best-effort)。
    /// 別マシンに vault フォルダだけ持ってきた場合に画像を戻す。復元数を返す。
    @discardableResult
    static func restoreImagesFromVault(vaultRoot: URL, appSupportDir: URL, cells: [VaultCell]) -> Int {
        let targets = withImage(cells)
        if targets.isEmpty { return 0 }
        let dir = vaultRoot.appendingPathComponent(attachmentsDirName, isDirectory: true)
        var restored = 0
        for (_, imagePath) in targets {
            let localURL = appSupportDir.appendingPathComponent(imagePath)
            if VaultIO.pathExists(localURL) { continue } // 既にローカルにある
            guard let bytes = VaultIO.readBytes(dir.appendingPathComponent(attachmentName(imagePath))) else { continue }
            try? VaultIO.ensureDir(localURL.deletingLastPathComponent())
            if (try? VaultIO.writeBytes(localURL, bytes)) != nil { restored += 1 }
        }
        return restored
    }
}
