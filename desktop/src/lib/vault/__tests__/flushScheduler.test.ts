import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFlushScheduler } from '@/lib/vault/flushScheduler'

/**
 * auto-flush debounce スケジューラの回帰テスト。
 * fake timers で「畳み込み / debounce 発火 / 実行中通知の追走 / dispose」を検証する。
 */

const DEBOUNCE = 3000

/** 解決を外から制御できる deferred。flush 実行中の状態を作るのに使う。 */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createFlushScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('notify 連打は debounce で 1 回に畳まれる', async () => {
    const flush = vi.fn(async () => {})
    const s = createFlushScheduler({ flush, debounceMs: DEBOUNCE })

    s.notify()
    await vi.advanceTimersByTimeAsync(1000)
    s.notify()
    await vi.advanceTimersByTimeAsync(1000)
    s.notify()
    // 最後の notify から debounce 経過するまでは未発火
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1)
    expect(flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('debounce 経過で flush が走る', async () => {
    const flush = vi.fn(async () => {})
    const s = createFlushScheduler({ flush, debounceMs: DEBOUNCE })

    s.notify()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flush 実行中の notify は完了後に 1 回追走する', async () => {
    const d = deferred()
    let calls = 0
    const flush = vi.fn(async () => {
      calls++
      if (calls === 1) await d.promise // 1 回目は外部解決まで実行中のまま留まる
    })
    const s = createFlushScheduler({ flush, debounceMs: DEBOUNCE })

    s.notify()
    await vi.advanceTimersByTimeAsync(DEBOUNCE) // 1 回目開始 (flushing 中)
    expect(flush).toHaveBeenCalledTimes(1)

    s.notify() // 実行中の通知 → pending
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(flush).toHaveBeenCalledTimes(1) // まだ 1 回目が終わっていないので増えない

    d.resolve() // 1 回目完了
    await vi.advanceTimersByTimeAsync(0) // finally で再スケジュール
    await vi.advanceTimersByTimeAsync(DEBOUNCE) // 追走の debounce 経過
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('dispose 後は発火しない', async () => {
    const flush = vi.fn(async () => {})
    const s = createFlushScheduler({ flush, debounceMs: DEBOUNCE })

    s.notify()
    s.dispose()
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2)
    expect(flush).not.toHaveBeenCalled()
  })
})
