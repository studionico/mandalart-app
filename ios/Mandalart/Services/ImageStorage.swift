import Foundation
import UIKit

/// セル画像のローカルストレージ (Application Support / images/)。
///
/// **設計方針**: desktop の [`storage.ts`](../../../desktop/src/lib/api/storage.ts) と同じく
/// **ローカル保存のみ**。Supabase Storage 経由の cross-device 画像同期は実装しない (容量 / 帯域 /
/// Storage policy 設定の都合)。`Cell.imagePath` には **AppSupport 配下の相対パス**
/// (例: `images/<cellId>-<timestamp>.jpg`) を保存。他デバイスでは imagePath があっても
/// 実ファイルが存在しないため画像表示できない (= 既知の制約)。
///
/// **圧縮**: 最大辺 `maxDimension` (= 1200pt) にリサイズし JPEG quality 0.7 で書き込む。
/// 大きな写真も数百 KB 以下に収まる。
@MainActor
enum ImageStorage {
    private static let imagesSubdir = "images"
    private static let maxDimension: CGFloat = 1200
    private static let jpegQuality: CGFloat = 0.7

    /// AppSupport ディレクトリを返す (= `~/Library/Application Support/`)。Sandbox 内。
    private static var appSupportDir: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    }

    private static var imagesDir: URL? {
        appSupportDir?.appendingPathComponent(imagesSubdir)
    }

    /// images/ ディレクトリを必要なら作成する。
    static func ensureImagesDir() throws {
        guard let dir = imagesDir else { throw ImageStorageError.directoryUnavailable }
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    /// PhotosPicker などから取得した画像 Data を保存する。
    /// JPEG エンコード + リサイズ済の bytes を Application Support に書き、相対パスを返す。
    static func saveImage(data: Data, cellId: String) throws -> String {
        try ensureImagesDir()
        let processed = compress(data: data)
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let filename = "\(cellId)-\(timestamp).jpg"
        let relPath = "\(imagesSubdir)/\(filename)"
        guard let dir = imagesDir else { throw ImageStorageError.directoryUnavailable }
        let absURL = dir.appendingPathComponent(filename)
        try processed.write(to: absURL)
        return relPath
    }

    /// 相対パス (`images/...`) から `UIImage` を読み込む。ファイル不存在は nil。
    static func loadImage(at relPath: String?) -> UIImage? {
        guard let relPath, !relPath.isEmpty,
              let appSupport = appSupportDir else { return nil }
        let absURL = appSupport.appendingPathComponent(relPath)
        guard let data = try? Data(contentsOf: absURL) else { return nil }
        return UIImage(data: data)
    }

    /// 相対パスのファイルを削除する (= cell から画像を外したとき)。
    static func deleteImage(at relPath: String?) {
        guard let relPath, !relPath.isEmpty,
              let appSupport = appSupportDir else { return }
        let absURL = appSupport.appendingPathComponent(relPath)
        try? FileManager.default.removeItem(at: absURL)
    }

    // MARK: - Compression

    /// 最大辺 `maxDimension` 以下にリサイズ + JPEG quality 0.7 で再エンコード。
    /// 失敗時は原データを返す。
    private static func compress(data: Data) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let resized = image.resized(maxDimension: maxDimension) ?? image
        return resized.jpegData(compressionQuality: jpegQuality) ?? data
    }

    enum ImageStorageError: Error {
        case directoryUnavailable
    }
}

private extension UIImage {
    func resized(maxDimension: CGFloat) -> UIImage? {
        let longSide = max(size.width, size.height)
        guard longSide > 0 else { return self }
        let scale = min(1, maxDimension / longSide)
        if scale >= 1 { return self }
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
