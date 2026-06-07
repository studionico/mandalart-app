import { describe, it, expect } from 'vitest'
import type { Grid, Cell } from '@/types'
import { parseGridBody, mergeBody, synthCellId, decodeColorTag } from '../vaultBody'
import { buildGridDocument, parseGridDocument } from '../vaultFormat'

/**
 * 本文ラウンドトリップ (vaultBody) のピュアテスト。iOS MandalartTests/VaultBodyTests.swift の移植。
 * 正準形 `<#/##> [done] <text or [[id|alias]]> #c/<color> ^pN` を render→parse で往復し、
 * フィールド単位フォールバック (三値 BodyField) と誤削除回避を検証する。
 */

const TS = '2026-06-07T00:00:00.000Z'

function cell(position: number, over: Partial<Cell> = {}): Cell {
  return {
    id: `g1-c${position}`,
    grid_id: 'g1',
    position,
    text: '',
    image_path: null,
    color: null,
    done: false,
    created_at: TS,
    updated_at: TS,
    ...over,
  }
}

function rootGrid(): Grid {
  return {
    id: 'g1',
    mandalart_id: 'm1',
    center_cell_id: 'g1-c4',
    parent_cell_id: null,
    sort_order: 0,
    memo: null,
    created_at: TS,
    updated_at: TS,
  }
}

function byPos(cells: Cell[]): Map<number, Cell> {
  return new Map(cells.map((c) => [c.position, c]))
}

describe('parseGridBody', () => {
  it('見出しから text / done / color を抽出する', () => {
    const parse = parseGridBody('## [x] 運動 #c/red-100 ^p2')
    const edit = parse.cellsByPosition.get(2)!
    expect(edit.text).toEqual({ set: true, value: '運動' })
    expect(edit.done).toEqual({ set: true, value: true })
    expect(edit.color).toEqual({ set: true, value: 'red-100' })
  })

  it('hex color タグを `#hex` に復号する', () => {
    const edit = parseGridBody('## [ ] 色 #c/hex-1a2b3c ^p0').cellsByPosition.get(0)!
    expect(edit.color).toEqual({ set: true, value: '#1a2b3c' })
    expect(edit.done).toEqual({ set: true, value: false })
  })

  it('wiki-link は label を text として取る', () => {
    const edit = parseGridBody('## [ ] [[child-grid|子の名前]] ^p5').cellsByPosition.get(5)!
    expect(edit.text).toEqual({ set: true, value: '子の名前' })
  })

  it('blockquote 行を memo に集約する', () => {
    const parse = parseGridBody('# [ ] 中心 ^p4\n> 1 行目\n> 2 行目')
    expect(parse.memo).toEqual({ set: true, value: '1 行目\n2 行目' })
  })

  it('memo が無ければ memo は absent', () => {
    expect(parseGridBody('# [ ] 中心 ^p4').memo).toEqual({ set: false })
  })

  it('^pN を持たない見出しは無視する', () => {
    const parse = parseGridBody('# (中心)\n## ただの見出し')
    expect(parse.cellsByPosition.size).toBe(0)
  })

  it('改行入り見出しブロックから position と複数行 text を取り出す (^pN が ## と別行)', () => {
    const edit = parseGridBody('## [ ] 発揮\n\n窮地に立てば潜在能力が発揮される ^p1').cellsByPosition.get(1)!
    expect(edit.text).toEqual({ set: true, value: '発揮\n\n窮地に立てば潜在能力が発揮される' })
    expect(edit.done).toEqual({ set: true, value: false })
  })

  it('clean フラグ: 全見出しが ^pN 付き or 中心 placeholder なら true、^pN 無し見出しで false', () => {
    expect(parseGridBody('# [ ] 中心 ^p4\n## [ ] a ^p0').clean).toBe(true)
    expect(parseGridBody('# (中心)\n## [ ] a ^p0').clean).toBe(true) // 中心 placeholder は例外
    expect(parseGridBody('## [ ] a ^p0\n## アンカー無し').clean).toBe(false)
  })

  it('次行が embed なら hasImage=true、無ければ false', () => {
    const withImg = parseGridBody('## [ ] 画像 ^p1\n![[pic.jpg]]').cellsByPosition.get(1)!
    expect(withImg.hasImage).toEqual({ set: true, value: true })
    const noImg = parseGridBody('## [ ] 文字だけ ^p1').cellsByPosition.get(1)!
    expect(noImg.hasImage).toEqual({ set: true, value: false })
  })
})

describe('mergeBody', () => {
  it('既存 position は edit を上書きし、absent field は frontmatter 値を維持する', () => {
    const front = [cell(2, { text: '旧', color: 'blue-100', done: true })]
    // text だけ編集した本文 (done/color は anchor 付き見出しに出る = set されるので、ここでは
    // text のみ編集して他は同値で再現)
    const parse = parseGridBody('## [x] 新 #c/blue-100 ^p2')
    const merged = byPos(mergeBody(front, parse, 'g1', TS))
    expect(merged.get(2)!.text).toBe('新')
    expect(merged.get(2)!.color).toBe('blue-100')
    expect(merged.get(2)!.done).toBe(true)
  })

  it('本文にあり frontmatter に無い position は synth セルとして新規追加する', () => {
    const parse = parseGridBody('## [ ] 追加 ^p7')
    const merged = byPos(mergeBody([], parse, 'g1', TS))
    const c = merged.get(7)!
    expect(c.id).toBe(synthCellId('g1', 7))
    expect(c.text).toBe('追加')
    expect(c.created_at).toBe(TS)
  })

  it('クリーンな本文で見出しが消えた position は削除する (意図的削除)', () => {
    const front = [cell(0, { text: '残す' }), cell(2, { text: '消す' })]
    const parse = parseGridBody('## [ ] 残す ^p0') // p2 の見出しを削除した状態 (クリーン)
    expect(parse.clean).toBe(true)
    const merged = byPos(mergeBody(front, parse, 'g1', TS))
    expect(merged.has(0)).toBe(true)
    expect(merged.has(2)).toBe(false) // 削除される
  })

  it('本文がクリーンでない (壊れた見出し) ときは missing position を維持する (誤削除回避)', () => {
    const front = [cell(0, { text: '残す' }), cell(2, { text: '維持' })]
    const parse = parseGridBody('## [ ] 残す ^p0\n## アンカー無し見出し') // ^pN 無し見出し = グリッチ
    expect(parse.clean).toBe(false)
    const merged = byPos(mergeBody(front, parse, 'g1', TS))
    expect(merged.has(2)).toBe(true) // 壊れているので維持
  })

  it('中心セル (position 4) はクリーンでも本文に無ければ維持 (削除しない)', () => {
    const front = [cell(4, { text: '中心' }), cell(0, { text: '残す' })]
    const parse = parseGridBody('## [ ] 残す ^p0') // 中心 H1 が無い
    expect(parse.clean).toBe(true)
    const merged = byPos(mergeBody(front, parse, 'g1', TS))
    expect(merged.has(4)).toBe(true) // 中心は削除されない
  })

  it('embed が消えたら image_path をクリア、embed があれば frontmatter の image_path 維持', () => {
    const front = [cell(1, { text: '画像', image_path: 'images/x.jpg' })]
    const cleared = byPos(mergeBody(front, parseGridBody('## [ ] 画像 ^p1'), 'g1', TS))
    expect(cleared.get(1)!.image_path).toBeNull()

    const kept = byPos(mergeBody(front, parseGridBody('## [ ] 画像 ^p1\n![[x.jpg]]'), 'g1', TS))
    expect(kept.get(1)!.image_path).toBe('images/x.jpg')
  })
})

describe('decodeColorTag', () => {
  it('preset はそのまま、hex- は # に戻す', () => {
    expect(decodeColorTag('red-100')).toBe('red-100')
    expect(decodeColorTag('hex-1a2b3c')).toBe('#1a2b3c')
  })
})

describe('render → parse(applyBody) 往復', () => {
  it('text / done / color / 画像クリア が本文経由で復元する', () => {
    const grid = rootGrid()
    const cells = [
      cell(4, { id: 'g1-c4', text: '中心' }),
      cell(2, { id: 'g1-c2', text: '運動', color: 'red-100', done: true }),
      cell(0, { id: 'g1-c0', text: 'hex色', color: '#1a2b3c' }),
    ]
    const doc = buildGridDocument(grid, cells)

    const parsed = parseGridDocument(doc, 'm1', true)!
    const m = byPos(parsed.cells)
    expect(m.get(2)!.text).toBe('運動')
    expect(m.get(2)!.color).toBe('red-100')
    expect(m.get(2)!.done).toBe(true)
    expect(m.get(0)!.color).toBe('#1a2b3c')
  })

  it('改行を含むセル本文も render→parse(applyBody) で往復する', () => {
    const grid = rootGrid()
    const multiline = '発揮\n\n窮地に立てば潜在能力が発揮される'
    const cells = [cell(4, { id: 'g1-c4', text: '中心' }), cell(1, { id: 'g1-c1', text: multiline })]
    const doc = buildGridDocument(grid, cells)
    const parsed = parseGridDocument(doc, 'm1', true)!
    expect(byPos(parsed.cells).get(1)!.text).toBe(multiline)
  })

  it('applyBody=false (既定) は frontmatter のみで本文を読まない', () => {
    const grid = rootGrid()
    const cells = [cell(4, { text: '中心' }), cell(2, { text: '元テキスト' })]
    // 本文の見出しだけ別テキストに改竄しても applyBody=false なら frontmatter (元テキスト) が残る。
    // (frontmatter の "元テキスト" には ` ^p2` が続かないので body 見出しだけを一意に置換する)
    const doc = buildGridDocument(grid, cells).replace('元テキスト ^p2', '本文改竄 ^p2')
    const parsed = parseGridDocument(doc, 'm1')!
    expect(byPos(parsed.cells).get(2)!.text).toBe('元テキスト')
  })
})
