/**
 * vault auto-flush 用の debounce スケジューラ (Phase 2 productize P2)。
 *
 * `notify()` を DB 書込みのたびに呼ぶと、静穏 (debounceMs 無入力) になってから `flush()` を
 * 1 回だけ起動する。連続編集は 1 回に畳まれ、flush 実行中に来た `notify()` は完了後に必ず
 * 1 回追走する (取りこぼさない)。
 *
 * `flush` は注入なので plugin-fs / DB に非依存 = fake timers でユニットテスト可能。
 * 実配線は [useVaultAutoFlush](../../hooks/useVaultAutoFlush.ts) が `flush` に
 * 「loadVaultConfig → vaultPath あれば flushDbToVault」を渡す。
 */

export type FlushScheduler = {
  /** DB 書込みを通知し、debounce タイマを (再) セットする。 */
  notify: () => void
  /** タイマ解除して以後発火させない (フック cleanup 用)。 */
  dispose: () => void
}

export function createFlushScheduler(opts: {
  flush: () => Promise<void>
  debounceMs: number
}): FlushScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false
  let pending = false
  let disposed = false

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), opts.debounceMs)
  }

  async function run() {
    timer = null
    if (disposed) return
    if (flushing) {
      // 実行中に debounce が満了した = さらに書込みがあった。完了後に追走させる。
      pending = true
      return
    }
    flushing = true
    try {
      await opts.flush()
    } catch (e) {
      console.error('[vault] auto-flush failed:', e)
    } finally {
      flushing = false
      if (pending && !disposed) {
        pending = false
        schedule()
      }
    }
  }

  return {
    notify() {
      if (disposed) return
      if (flushing) {
        // flush 実行中の通知は完了後に 1 回必ず追走させる (途中の編集を落とさない)。
        pending = true
        return
      }
      schedule()
    },
    dispose() {
      disposed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = false
    },
  }
}
