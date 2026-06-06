import Foundation
import SwiftData

/// DB 編集 → debounce → vault へ差分 flush する auto-flush ドライバ。
/// desktop の [`flushScheduler.ts`](../../../desktop/src/lib/vault/flushScheduler.ts) +
/// [`useVaultAutoFlush.ts`](../../../desktop/src/hooks/useVaultAutoFlush.ts) の iOS 版。
///
/// 検知は **`ModelContext.didSave` 通知** (iOS の onDbWrite 相当)。アプリは編集後 `modelContext.save()` を
/// 明示呼びしており save 成功で didSave が post される。連続編集は debounce で 1 回に畳み、flush は
/// **ファイルだけ書き DB を書かない**ので didSave を誘発しない (フィードバックループ無し)。
/// flush は vaultMode ON のときだけ実行 (OFF / bookmark 無しは no-op)。
@MainActor
final class VaultAutoFlush {
    private weak var context: ModelContext?
    /// echo-skip 台帳 (Stage ④)。MandalartApp から reconcile と共有する同一インスタンスを受け取る。
    private var ledger: VaultWriteLedger?
    private var observer: NSObjectProtocol?
    private var debounceTask: Task<Void, Never>?
    private var flushing = false
    private var pending = false
    private let debounceSeconds = 3.0

    /// didSave 購読を開始する。**起動 rebuild 完了後に呼ぶこと** (reconcile の save を誤って拾わない)。
    /// `ledger` は reconcile が seed する台帳と同一インスタンスを渡す (clobber 安全化)。
    func start(context: ModelContext, ledger: VaultWriteLedger? = nil) {
        guard observer == nil else { return }
        self.context = context
        self.ledger = ledger
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

    // MARK: - debounce スケジューラ (flushScheduler.ts 相当)

    private func notify() {
        if flushing {
            // flush 実行中の通知は完了後に 1 回追走させる (途中の編集を落とさない)。
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
        let config = VaultConfigStore.load()
        guard config.vaultMode,
              let bookmark = config.vaultBookmark,
              let resolved = VaultBookmark.resolve(bookmark) else { return }
        let rows = VaultRowsBridge.loadAllMandalartRows(in: context)
        let appSupport = VaultImageStore.appSupportDirectory() ?? FileManager.default.temporaryDirectory
        do {
            _ = try VaultBookmark.withAccess(resolved.url) {
                try VaultSync.flushDbToVault(rows: rows, to: resolved.url, appSupportDir: appSupport, ledger: ledger)
            }
        } catch {
            print("[vault] auto-flush failed:", error)
        }
    }
}
