import { describe, it, expect } from 'vitest'
import { idsToDelete } from '../reconcileDeletions'

describe('idsToDelete (pull reconcile 判定)', () => {
  it('synced 済で cloud に居ない行は削除候補に入る', () => {
    const local = [
      { id: 'a', synced: true },
      { id: 'b', synced: true },
    ]
    const result = idsToDelete(local, new Set(['a']), false)
    expect(result).toEqual(new Set(['b']))
  })

  it('synced=false (local-only 未 push) は cloud に居なくても絶対に消さない', () => {
    const local = [
      { id: 'a', synced: false },
      { id: 'b', synced: true },
    ]
    // cloud は空 → b は削除候補、a は local-only なので除外
    const result = idsToDelete(local, new Set(), false)
    expect(result).toEqual(new Set(['b']))
  })

  it('cloud に存在する synced 行は残す', () => {
    const local = [
      { id: 'a', synced: true },
      { id: 'b', synced: true },
    ]
    const result = idsToDelete(local, new Set(['a', 'b']), false)
    expect(result).toEqual(new Set())
  })

  it('truncated=true なら何も消さない (fetch 不完全による誤削除を防ぐ)', () => {
    const local = [
      { id: 'a', synced: true },
      { id: 'b', synced: true },
    ]
    // cloud id 集合が不完全でも truncated なら空集合
    const result = idsToDelete(local, new Set(['a']), true)
    expect(result).toEqual(new Set())
  })

  it('空 local → 空集合', () => {
    expect(idsToDelete([], new Set(['a']), false)).toEqual(new Set())
  })

  it('空 cloud + 全行 synced → 全行削除候補', () => {
    const local = [
      { id: 'a', synced: true },
      { id: 'b', synced: true },
    ]
    expect(idsToDelete(local, new Set(), false)).toEqual(new Set(['a', 'b']))
  })
})
