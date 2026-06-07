import { describe, it, expect } from 'vitest'
import { createWriteLedger } from '../vaultWriteLedger'

/**
 * clobber 安全化 / echo-skip の台帳ロジック。flush ガード (DB→vault) と watcher echo-skip
 * (vault→DB) の両判定が同じ台帳で成立することを検証する。
 */

describe('createWriteLedger', () => {
  it('未記録の key は外部変更とみなさない (初回 export を妨げない)', () => {
    const l = createWriteLedger()
    expect(l.has('/v/a.md')).toBe(false)
    expect(l.isExternallyModified('/v/a.md', 'h1')).toBe(false)
  })

  it('記録した hash と一致 = 外部変更なし (= 自分の書込みの echo)', () => {
    const l = createWriteLedger()
    l.record('/v/a.md', 'h1')
    expect(l.has('/v/a.md')).toBe(true)
    expect(l.isExternallyModified('/v/a.md', 'h1')).toBe(false)
  })

  it('記録済みだが hash 不一致 = 外部変更あり (flush は上書きしない / watcher は取り込む)', () => {
    const l = createWriteLedger()
    l.record('/v/a.md', 'h1')
    expect(l.isExternallyModified('/v/a.md', 'h2')).toBe(true)
  })

  it('record で最新 hash に更新される (正準化書き戻し後に再び echo 一致)', () => {
    const l = createWriteLedger()
    l.record('/v/a.md', 'h1')
    l.record('/v/a.md', 'h2') // reconcile/flush が新状態を記録
    expect(l.isExternallyModified('/v/a.md', 'h2')).toBe(false)
    expect(l.isExternallyModified('/v/a.md', 'h1')).toBe(true)
  })

  it('key はパス単位で独立 (同名ファイルの衝突防止に絶対パスを使う前提)', () => {
    const l = createWriteLedger()
    l.record('/v/A/_mandalart.md', 'ha')
    l.record('/v/B/_mandalart.md', 'hb')
    expect(l.isExternallyModified('/v/A/_mandalart.md', 'hb')).toBe(true)
    expect(l.isExternallyModified('/v/B/_mandalart.md', 'hb')).toBe(false)
  })

  it('clear で全消去される', () => {
    const l = createWriteLedger()
    l.record('/v/a.md', 'h1')
    l.clear()
    expect(l.has('/v/a.md')).toBe(false)
  })
})
