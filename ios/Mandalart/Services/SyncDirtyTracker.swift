import Foundation
import SwiftData

/// ローカル編集 (mutation) を検知して **sliding debounce** で `SyncEngine.pushPending` を駆動する。
///
/// **背景** (落とし穴 #24): かつて 15 秒 auto-push polling が dirty rows を 15 秒ごとに upsert し、
/// cloud の BEFORE UPDATE トリガで `updated_at = NOW()` が書き換わるたびに realtime broadcast を
/// 量産して Realtime Messages quota を約 5 倍超過した。polling は永久廃止し、本トラッカーが
/// 「最後の編集から `dirtyPushDebounceSec` 秒アイドルしてから 1 回だけ push」する mutation 駆動方式に
/// 置換する。
///
/// **検知方法**: `ModelContext.didSave` を NotificationCenter で 1 箇所観測する。iOS の編集経路は
/// `context.save()` が Views/Services 横断で散在しており中央 touch ヘルパが無いため、全 save を
/// 1 経路で捕捉できる didSave を使う。どの行が dirty かは `SyncEngine.needsPush`
/// (`syncedAt < updatedAt`) が判定するので、本トラッカーは「いつ push を撃つか」のタイミングだけ
/// 担当する (boolean + 最終 dirty 時刻のみ保持)。
///
/// **ライフサイクル**: `start(context:)` をサインイン直後に呼び、`stop()` をサインアウト時に呼ぶ。
/// scene `.background` 進入時は `flushNow()` で残 dirty を即 push する。
///
/// **echo / loop 安全性**: pull (realtime / 手動同期) が書いた行は `syncedAt == updatedAt` なので
/// pending にならず、誘発される push は空振りする。空 push は `SyncEngine.pushPending` 側で
/// `context.hasChanges` ガードにより save しない = didSave を出さないので、再 arm の連鎖は
/// 高々 1 回 (実 push の syncedAt 書き戻し save 由来) で収束する。
@MainActor
final class SyncDirtyTracker {
    static let shared = SyncDirtyTracker()

    private weak var context: ModelContext?
    private var observer: NSObjectProtocol?
    private var debounceTask: Task<Void, Never>?
    private var lastDirtyAt: Date?
    private var isActive = false

    private init() {}

    /// mainContext の save 観測を開始する。再呼び出し時は先に stop してから貼り直す。
    func start(context: ModelContext) {
        stop()
        self.context = context
        isActive = true
        observer = NotificationCenter.default.addObserver(
            forName: ModelContext.didSave,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.markDirty() }
        }
    }

    /// 観測を停止する。未 flush の dirty は破棄 (次回サインインの fullSync で回収される)。
    func stop() {
        isActive = false
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
        observer = nil
        debounceTask?.cancel()
        debounceTask = nil
        lastDirtyAt = nil
    }

    /// 編集を検知。最終 dirty 時刻を更新し、debounce ループが未起動なら起動する。
    /// 起動済みなら lastDirtyAt の更新だけで sliding (後ろ倒し) される。
    func markDirty() {
        guard isActive else { return }
        lastDirtyAt = Date()
        guard debounceTask == nil else { return }
        debounceTask = Task { [weak self] in
            await self?.runDebounceLoop()
        }
    }

    /// scene `.background` 等で残 dirty を即 push したいときに呼ぶ。debounce 待ちを打ち切る。
    func flushNow() {
        guard isActive else { return }
        debounceTask?.cancel()
        debounceTask = nil
        lastDirtyAt = nil
        Task { [weak self] in await self?.push() }
    }

    /// 「最後の dirty から `dirtyPushDebounceSec` 秒経過」まで待ってから push する sliding debounce。
    private func runDebounceLoop() async {
        let debounce = TimeInterval(TimingConstants.dirtyPushDebounceSec)
        while !Task.isCancelled {
            guard let last = lastDirtyAt else { return }
            let elapsed = Date().timeIntervalSince(last)
            if elapsed >= debounce { break }
            try? await Task.sleep(for: .seconds(debounce - elapsed))
        }
        guard !Task.isCancelled else { return }
        debounceTask = nil
        lastDirtyAt = nil
        await push()
    }

    private func push() async {
        guard let context else { return }
        do {
            _ = try await SyncEngine.shared.pushPending(from: context)
        } catch {
            print("[dirty-tracker] pushPending failed:", error)
        }
    }
}
