import { describe, it, expect } from 'vitest'
import { parseTextToSnapshot } from '../import-parser'
import { CENTER_POSITION } from '@/constants/grid'

/**
 * インポート仕様:
 *  - ルートノード → ルートグリッドの中心セル (position=4)
 *  - 子ノード 最大 8 個 → 周辺セル ([7, 6, 3, 0, 1, 2, 5, 8] の順)
 *  - 孫がある周辺セル → そのセルの子グリッドとして再帰展開
 *  - 9 個目以降の子 → 並列グリッドに溢れる
 *  - 箇条書き記号 (・ • - * + 1. 等) は自動除去
 *  - 入力が `#` 始まりなら Markdown、そうでなければインデント
 */

describe('parseTextToSnapshot', () => {
  it('空文字列は空の snapshot を返す', () => {
    const snap = parseTextToSnapshot('')
    expect(snap.cells).toEqual([])
    expect(snap.children).toEqual([])
  })

  it('1 行だけなら中心セルだけ持つ snapshot になる', () => {
    const snap = parseTextToSnapshot('テーマ')
    expect(snap.cells).toHaveLength(1)
    expect(snap.cells[0]).toMatchObject({
      position: CENTER_POSITION,
      text: 'テーマ',
    })
    expect(snap.children).toEqual([])
  })

  it('インデントテキストが周辺セル配置順 [7,6,3,0,1,2,5,8] に並ぶ', () => {
    const text = [
      'ルート',
      '  子1',
      '  子2',
      '  子3',
    ].join('\n')
    const snap = parseTextToSnapshot(text)
    const peripheralOrder = [7, 6, 3, 0, 1, 2, 5, 8]
    // 中心 + 周辺 3 つ = 4 セル
    expect(snap.cells).toHaveLength(4)
    expect(snap.cells[0].text).toBe('ルート')
    expect(snap.cells[1]).toMatchObject({ position: peripheralOrder[0], text: '子1' })
    expect(snap.cells[2]).toMatchObject({ position: peripheralOrder[1], text: '子2' })
    expect(snap.cells[3]).toMatchObject({ position: peripheralOrder[2], text: '子3' })
  })

  it('孫がある周辺セルは子グリッドとして再帰展開される', () => {
    const text = [
      'ルート',
      '  子A',
      '    孫1',
      '    孫2',
    ].join('\n')
    const snap = parseTextToSnapshot(text)
    expect(snap.children).toHaveLength(1)
    const childGrid = snap.children[0]
    // 孫が生えているのは「ルートの最初の子」= position 7 の周辺セル
    expect(childGrid.parentPosition).toBe(7)
    expect(childGrid.cells[0]).toMatchObject({ position: CENTER_POSITION, text: '子A' })
  })

  it('9 個目以降の子は並列グリッドに溢れる', () => {
    // ルート + 10 子 → 周辺 8 + 溢れ 2 (parallel grid に入る)
    const lines = ['ルート']
    for (let i = 1; i <= 10; i++) lines.push(`  子${i}`)
    const snap = parseTextToSnapshot(lines.join('\n'))
    // ルートグリッドのセル: 中心 + 周辺 8 = 9
    expect(snap.cells).toHaveLength(9)
    // 並列グリッド: parentPosition === undefined で識別
    const parallel = snap.children.filter((c) => c.parentPosition === undefined)
    expect(parallel.length).toBeGreaterThanOrEqual(1)
    expect(parallel[0].cells[0]).toMatchObject({ position: CENTER_POSITION, text: 'ルート' })
  })

  it('Markdown 見出しレベルで階層を判定する', () => {
    const text = ['# ルート', '## 子A', '## 子B'].join('\n')
    const snap = parseTextToSnapshot(text)
    expect(snap.cells[0]).toMatchObject({ position: CENTER_POSITION, text: 'ルート' })
    expect(snap.cells.filter((c) => c.position !== CENTER_POSITION)).toHaveLength(2)
  })

  it('箇条書き記号 (- / * / ・ / 1.) は除去される', () => {
    const text = ['ルート', '  - 子1', '  * 子2', '  ・ 子3', '  1. 子4'].join('\n')
    const snap = parseTextToSnapshot(text)
    const texts = snap.cells.map((c) => c.text)
    expect(texts).toContain('子1')
    expect(texts).toContain('子2')
    expect(texts).toContain('子3')
    expect(texts).toContain('子4')
    expect(texts.some((t) => t.startsWith('-') || t.startsWith('*') || t.startsWith('・'))).toBe(false)
  })
})
