import Foundation
import UIKit
import Supabase

/// セル画像のローカルストレージ (Application Support / images/) + Supabase Storage 同期。
///
/// **設計方針**: `Cell.imagePath` には **AppSupport 配下の相対パス**
/// (例: `images/<cellId>-<timestamp>.jpg`) を保存し、スキーマは変更しない。
/// 画像本体は保存時に Supabase Storage バケット `cell-images` (非公開) にもアップロードする。
/// Storage オブジェクトキーは `<userId>/<filename>` で実行時に導出する (RLS policy が
/// 先頭フォルダ = auth.uid を要求するため)。**userId は小文字化する**: Postgres の
/// `auth.uid()::text` は小文字 UUID だが `UUID.uuidString` は大文字を返すため (pitfall #23)。
/// 別デバイスでは imagePath はあってもローカル実ファイルが無いので、`downloadFromCloud` で
/// Storage から取得してローカルにキャッシュしてから表示する。
/// Storage は Realtime Messages quota とは無関係 (緊急停止中の同期問題を悪化させない)。
///
/// **圧縮**: 最大辺 `maxDimension` (= 1200pt) にリサイズし JPEG quality 0.7 で書き込む。
/// 大きな写真も数百 KB 以下に収まる。
@MainActor
enum ImageStorage {
    private static let imagesSubdir = "images"
    private static let maxDimension: CGFloat = 1200
    private static let jpegQuality: CGFloat = 0.7
    private static let bucket = "cell-images"

    /// メモリ cache (drill アニメ中の頻繁な remount でディスク I/O を抑える)。
    /// Phase 6 の orbit fade-in で CellView が grid 切替ごとに remount されるので、
    /// 同じ relPath を 1 frame 目から同期で返せるようにする (= #18 まばたき対策の iOS 版)。
    private static let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 200  // 数百枚程度なら全部 memory 上に置いても問題ない (= 1 枚 ~数百 KB)
        return c
    }()

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
        if let img = UIImage(data: processed) {
            cache.setObject(img, forKey: relPath as NSString)
        }
        // Storage にも非同期でアップロード (別デバイス表示用、best-effort)。
        Task { await uploadToCloud(relPath: relPath) }
        return relPath
    }

    /// 相対パス (`images/...`) から `UIImage` を読み込む。ファイル不存在は nil。
    /// メモリ cache hit なら同期で即返す (= drill アニメ中の remount でも 1 frame 目から表示可能)。
    static func loadImage(at relPath: String?) -> UIImage? {
        guard let relPath, !relPath.isEmpty else { return nil }
        if let cached = cache.object(forKey: relPath as NSString) {
            return cached
        }
        guard let appSupport = appSupportDir else { return nil }
        let absURL = appSupport.appendingPathComponent(relPath)
        guard let data = try? Data(contentsOf: absURL),
              let img = UIImage(data: data) else { return nil }
        cache.setObject(img, forKey: relPath as NSString)
        return img
    }

    /// 相対パスのファイルを削除する (= cell から画像を外したとき)。
    static func deleteImage(at relPath: String?) {
        guard let relPath, !relPath.isEmpty,
              let appSupport = appSupportDir else { return }
        cache.removeObject(forKey: relPath as NSString)
        let absURL = appSupport.appendingPathComponent(relPath)
        try? FileManager.default.removeItem(at: absURL)
    }

    // MARK: - Cloud sync (Supabase Storage)

    /// 現在サインイン中ユーザーの id (小文字 UUID)。未サインインなら nil。
    private static func currentUserId() async -> String? {
        guard let session = try? await SupabaseService.shared.client.auth.session else { return nil }
        return session.user.id.uuidString.lowercased()
    }

    /// image_path (相対) → Storage オブジェクトキー (`<userId>/<filename>`)。
    private static func storageKey(userId: String, relPath: String) -> String {
        let base = (relPath as NSString).lastPathComponent
        return "\(userId)/\(base)"
    }

    /// ローカル保存済みの画像を Storage にアップロードする (best-effort)。
    static func uploadToCloud(relPath: String) async {
        guard let userId = await currentUserId(),
              let appSupport = appSupportDir else { return }
        let absURL = appSupport.appendingPathComponent(relPath)
        guard let data = try? Data(contentsOf: absURL) else { return }
        let key = storageKey(userId: userId, relPath: relPath)
        do {
            try await SupabaseService.shared.client.storage
                .from(bucket)
                .upload(key, data: data, options: FileOptions(contentType: "image/jpeg", upsert: true))
        } catch {
            print("ImageStorage.uploadToCloud failed: \(key) \(error)")
        }
    }

    /// Storage から画像を取得し、ローカルにキャッシュして UIImage を返す。失敗時 nil。
    /// (別デバイスで追加されローカルに実ファイルが無い画像の表示用)
    static func downloadFromCloud(relPath: String) async -> UIImage? {
        guard let userId = await currentUserId(),
              let appSupport = appSupportDir else { return nil }
        let key = storageKey(userId: userId, relPath: relPath)
        do {
            let data = try await SupabaseService.shared.client.storage
                .from(bucket)
                .download(path: key)
            // ローカルにキャッシュ (次回以降は loadImage で同期取得できる)
            try? ensureImagesDir()
            let absURL = appSupport.appendingPathComponent(relPath)
            try? data.write(to: absURL)
            guard let img = UIImage(data: data) else { return nil }
            cache.setObject(img, forKey: relPath as NSString)
            return img
        } catch {
            print("ImageStorage.downloadFromCloud failed: \(key) \(error)")
            return nil
        }
    }

    /// ローカルにあるが Storage 未アップロードの画像を回収する (オフライン追加分の保険)。
    /// `<userId>/` の既存キー一覧を 1 回取得し、差分だけ upload する。
    /// `localImagePaths`: cells.imagePath の一覧 (SyncEngine から渡す)。
    static func backfillUpload(localImagePaths: [String]) async {
        guard let userId = await currentUserId(),
              let appSupport = appSupportDir else { return }
        let existing: Set<String>
        do {
            let files = try await SupabaseService.shared.client.storage.from(bucket).list(path: userId)
            existing = Set(files.map { $0.name })
        } catch {
            print("ImageStorage.backfillUpload list failed: \(error)")
            return
        }
        for relPath in localImagePaths where !relPath.isEmpty {
            let base = (relPath as NSString).lastPathComponent
            if existing.contains(base) { continue }
            let absURL = appSupport.appendingPathComponent(relPath)
            guard FileManager.default.fileExists(atPath: absURL.path) else { continue }
            await uploadToCloud(relPath: relPath)
        }
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
