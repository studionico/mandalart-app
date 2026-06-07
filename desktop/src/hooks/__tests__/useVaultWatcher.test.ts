import { describe, it, expect } from 'vitest'
import { changedMandalartDirs } from '../useVaultWatcher'

/**
 * watch イベントパスから「変更されたマンダラートフォルダ名」を抽出する判定。
 * FSEvents の親 dir イベントや Obsidian の .obsidian/* を除外し、vaultRoot 直下フォルダの
 * .md 変更だけを拾うことを検証する (スコープ reconcile の対象決定)。
 */
describe('changedMandalartDirs', () => {
  const root = '/Users/me/Documents/vault'

  it('<root>/<dir>/<file>.md からフォルダ名を抽出', () => {
    expect(changedMandalartDirs(root, [`${root}/folder-a1b2/2cfe.md`])).toEqual(['folder-a1b2'])
    expect(changedMandalartDirs(root, [`${root}/folder-a1b2/_mandalart.md`])).toEqual(['folder-a1b2'])
  })

  it('.obsidian/* + 親 dir だけのイベントは空 (無駄取り込みを起こさない)', () => {
    expect(
      changedMandalartDirs(root, [`${root}/.obsidian/workspace.json`, `${root}/.obsidian`, root]),
    ).toEqual([])
  })

  it('dir パスのみ (vault ルート / マンダラート dir) は空', () => {
    expect(changedMandalartDirs(root, [root, `${root}/folder-a1b2`])).toEqual([])
  })

  it('dot ディレクトリ配下の .md は除外', () => {
    expect(changedMandalartDirs(root, [`${root}/.trash/old.md`])).toEqual([])
  })

  it('vault ルート直下の .md (フォルダ無し) は対象外', () => {
    expect(changedMandalartDirs(root, [`${root}/loose.md`])).toEqual([])
  })

  it('同一フォルダの複数 .md は重複排除', () => {
    expect(
      changedMandalartDirs(root, [`${root}/folder-x/a.md`, `${root}/folder-x/b.md`]),
    ).toEqual(['folder-x'])
  })

  it('複数フォルダの変更は全件返す', () => {
    const got = changedMandalartDirs(root, [`${root}/folder-x/a.md`, `${root}/folder-y/c.md`])
    expect(got.sort()).toEqual(['folder-x', 'folder-y'])
  })

  it('vaultRoot 外のパス・非 .md は無視、末尾スラッシュ root も許容', () => {
    expect(changedMandalartDirs(`${root}/`, [`${root}/folder-x/a.md`])).toEqual(['folder-x'])
    expect(changedMandalartDirs(root, ['/other/place/x.md', `${root}/folder-x/a.txt`])).toEqual([])
  })

  it('空配列は空', () => {
    expect(changedMandalartDirs(root, [])).toEqual([])
  })
})
