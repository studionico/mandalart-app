import Foundation
import SwiftData

/// DB 編集 → debounce → 出力先フォルダへ各マンダラートを書き出す auto-flush ドライバ。
/// desktop の [`useMirrorAutoFlush.ts`](../../../desktop/src/hooks/useMirrorAutoFlush.ts) の iOS 版。
///
/// 検知は **`ModelContext.didSave` 通知** (iOS の onDbWrite 相当)。連続編集は debounce で 1 回に畳み、
/// flush は **ファイルだけ書き DB を書かない**ので didSave を誘発しない (フィードバックループ無し)。
/// flush は mirrorEnabled ON のときだけ実行 (OFF / bookmark 無しは no-op)。取り込みはしない。
@MainActor
final class MirrorAutoFlush {
    private weak var context: ModelContext?
    private var observer: NSObjectProtocol?
    private var debounceTask: Task<Void, Never>?
    private var flushing = false
    private var pending = false
    private let debounceSeconds = 3.0

    /// didSave 購読を開始する。
    func start(context: ModelContext) {
        guard observer == nil else { return }
        self.context = context
        observer = NotificationCenter.default.addObserver(
            forName: ModelContext.didSave, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.notify() }
        }
    }

    func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        debounceTask?.cancel()
        debounceTask = nil
    }

    /// 背面遷移時などの即時 flush (debounce を待たない、取りこぼし防止)。
    func flushNow() {
        debounceTask?.cancel()
        debounceTask = nil
        Task { [weak self] in await self?.run() }
    }

    // MARK: - debounce スケジューラ

    private func notify() {
        if flushing {
            pending = true
            return
        }
        schedule()
    }

    private func schedule() {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            guard let seconds = self?.debounceSeconds else { return }
            try? await Task.sleep(for: .seconds(seconds))
            if Task.isCancelled { return }
            await self?.run()
        }
    }

    private func run() async {
        if flushing {
            pending = true
            return
        }
        flushing = true
        await performFlush()
        flushing = false
        if pending {
            pending = false
            schedule()
        }
    }

    private func performFlush() async {
        guard let context else { return }
        let config = MirrorConfigStore.load()
        guard config.mirrorEnabled,
              let bookmark = config.mirrorBookmark,
              let resolved = SecurityScopedBookmark.resolve(bookmark) else { return }
        do {
            _ = try SecurityScopedBookmark.withAccess(resolved.url) {
                try MirrorSync.mirrorAll(to: resolved.url, in: context)
            }
        } catch {
            print("[mirror] auto-flush failed:", error)
        }
    }
}
