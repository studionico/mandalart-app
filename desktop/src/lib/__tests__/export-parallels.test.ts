import { describe, it, expect } from 'vitest'
import { snapshotToMarkdown, snapshotToIndentText } from '@/lib/api/transfer'
import type { GridSnapshot } from '@/types'

/**
 * 並列グリッドが Markdown / Indent 出力に含まれることを保証する回帰テスト。
 * exportToJSON (DB 依存) はテストしないが、内部の変換ロジック
 * snapshotToMarkdown / snapshotToIndentText をピュア関数として検証する。
 */

function makeCell(position: number, text: string) {
  return { position, text, image_path: null, color: null }
}

describe('snapshotToMarkdown with parallels', () => {
  it('root 並列グリッドの peripherals が見出しに flatten される', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: null },
      parentPosition: undefined,
      cells: [makeCell(0, 'G1-P0'), makeCell(4, 'CenterX')],
      children: [
        {
          // parallel G2 shares center "CenterX"
          grid: { sort_order: 1, memo: null },
          parentPosition: undefined,
          cells: [makeCell(0, 'G2-P0'), makeCell(4, 'CenterX')],
          children: [],
        },
      ],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('# CenterX')
    expect(md).toContain('## G1-P0')
    expect(md).toContain('## G2-P0')  // 並列グリッドの peripheral も含まれる
  })

  it('root grid の memo が blockquote で出力される', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: 'これはメモです' },
      parentPosition: undefined,
      cells: [makeCell(0, 'P0'), makeCell(4, 'Center')],
      children: [],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('# Center')
    expect(md).toContain('> これはメモです')
  })

  it('memo が複数行でも各行 blockquote になる', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: 'line1\nline2' },
      parentPosition: undefined,
      cells: [makeCell(4, 'Center')],
      children: [],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('> line1')
    expect(md).toContain('> line2')
  })

  it('drilled sub-grid の memo が peripheral 見出し直下に出る', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: null },
      parentPosition: undefined,
      cells: [makeCell(0, 'P0'), makeCell(4, 'Center')],
      children: [
        {
          grid: { sort_order: 0, memo: 'sub memo' },
          parentPosition: 0,
          cells: [makeCell(4, 'P0'), makeCell(1, 'GC1')],
          children: [],
        },
      ],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('## P0')
    expect(md).toContain('> sub memo')
  })
})

describe('snapshotToIndentText with parallels', () => {
  it('並列グリッドの peripherals がインデントで flatten される', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: null },
      parentPosition: undefined,
      cells: [makeCell(0, 'G1-P0'), makeCell(4, 'CenterX')],
      children: [
        {
          grid: { sort_order: 1, memo: null },
          parentPosition: undefined,
          cells: [makeCell(0, 'G2-P0'), makeCell(4, 'CenterX')],
          children: [],
        },
      ],
    }
    const txt = snapshotToIndentText(snap)
    expect(txt).toContain('CenterX')
    expect(txt).toContain('  G1-P0')
    expect(txt).toContain('  G2-P0')  // parallel peripheral
  })
})

/**
 * 現実のシナリオ: root G1 に並列 G2、それぞれ複数の peripherals を持つ。
 * fetchSnapshot が返す形をハンドコーディングで再現し、export output が
 * "G1 peripherals + G2 peripherals" の合計を含むことを保証する。
 */
describe('realistic parallel scenario round-trip', () => {
  it('root 並列 G2 の全 peripherals が root の子見出しに出る', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: 'root memo' },
      parentPosition: undefined,
      cells: [
        makeCell(0, 'G1-P0'),
        makeCell(1, 'G1-P1'),
        makeCell(2, 'G1-P2'),
        makeCell(4, 'Theme'),
        makeCell(5, 'G1-P5'),
      ],
      children: [
        {
          grid: { sort_order: 1, memo: 'g2 memo' },
          parentPosition: undefined,
          cells: [
            makeCell(0, 'G2-P0'),
            makeCell(1, 'G2-P1'),
            makeCell(4, 'Theme'),
          ],
          children: [],
        },
      ],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('# Theme')
    expect(md).toContain('> root memo')
    // G1 peripherals
    expect(md).toContain('## G1-P0')
    expect(md).toContain('## G1-P1')
    expect(md).toContain('## G1-P2')
    expect(md).toContain('## G1-P5')
    // G2 parallel peripherals (critical check — this was reported as failing)
    expect(md).toContain('## G2-P0')
    expect(md).toContain('## G2-P1')
  })

  it('drilled sub-grid 内の並列も孫見出しに展開される', () => {
    const snap: GridSnapshot = {
      grid: { sort_order: 0, memo: null },
      parentPosition: undefined,
      cells: [makeCell(0, 'P0'), makeCell(4, 'Root')],
      children: [
        {
          // drilled sub-grid under P0
          grid: { sort_order: 0, memo: null },
          parentPosition: 0,
          cells: [
            makeCell(4, 'P0'),
            makeCell(1, 'SG-P1'),
            makeCell(2, 'SG-P2'),
          ],
          children: [
            {
              // parallel of the drilled sub-grid
              grid: { sort_order: 1, memo: null },
              parentPosition: undefined,
              cells: [
                makeCell(4, 'P0'),
                makeCell(1, 'SG2-P1'),
              ],
              children: [],
            },
          ],
        },
      ],
    }
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('# Root')
    expect(md).toContain('## P0')
    expect(md).toContain('### SG-P1')
    expect(md).toContain('### SG-P2')
    expect(md).toContain('### SG2-P1')  // nested parallel's peripheral as grandchild
  })
})
