import { describe, it, expect } from 'vitest'
import {
  buildFrontmatter,
  extractFrontmatterSnapshot,
  MD_LOSSLESS_FORMAT,
} from '@/lib/markdown-frontmatter'
import { snapshotToMarkdown } from '@/lib/api/transfer'
import type { GridSnapshot } from '@/types'

/**
 * md-lossless-v1 (Markdown ロスレス化 / Phase 1) の round-trip 回帰テスト。
 * frontmatter に保持した GridSnapshot が memo / color / image_path / done /
 * 空セルを挟んだ位置 / 6 階層超のネストを欠落なく往復することを保証する。
 */

// 中心 + 一部 peripheral のみ埋めた (position が飛ぶ) grid。
function cell(
  position: number,
  text: string,
  extra: Partial<GridSnapshot['cells'][number]> = {},
): GridSnapshot['cells'][number] {
  return { position, text, image_path: null, color: null, done: false, ...extra }
}

// 7 階層 (root + 6 drill) の深いネストを生成する。
function deepChain(depth: number): GridSnapshot {
  const node: GridSnapshot = {
    grid: { sort_order: 0, memo: depth === 0 ? 'leaf-memo' : null },
    cells: [cell(4, `L${depth}`)],
    children: [],
  }
  if (depth > 0) {
    const child = deepChain(depth - 1)
    child.parentPosition = 7
    node.cells.push(cell(7, `L${depth}-child`))
    node.children = [child]
  }
  return node
}

const SAMPLE: GridSnapshot = {
  grid: { sort_order: 2, memo: 'グリッドのメモ\n複数行 "引用符" : コロン # シャープ' },
  cells: [
    cell(4, '健康', { color: 'red-100', done: true }),
    // position 0,1,2,3 を飛ばして 7 と 2 のみ → 位置保存の検証
    cell(7, '運動', { image_path: 'images/abc-123.jpg' }),
    cell(2, '食事', { color: 'green-100', done: true }),
  ],
  children: [
    {
      grid: { sort_order: 0, memo: '子グリッドのメモ' },
      parentPosition: 7,
      cells: [cell(4, '運動'), cell(0, '筋トレ', { done: true })],
      children: [],
    },
  ],
}

describe('markdown-frontmatter round-trip', () => {
  it('frontmatter を含むファイルから snapshot を完全復元する', () => {
    const file = `${buildFrontmatter(SAMPLE)}\n\n${snapshotToMarkdown(SAMPLE)}`
    const restored = extractFrontmatterSnapshot(file)
    expect(restored).toEqual(SAMPLE)
  })

  it('frontmatter 単体 (本文なし) でも復元できる', () => {
    const restored = extractFrontmatterSnapshot(buildFrontmatter(SAMPLE))
    expect(restored).toEqual(SAMPLE)
  })

  it('空セルを挟んで position が飛んでも保存される', () => {
    const restored = extractFrontmatterSnapshot(buildFrontmatter(SAMPLE))
    expect(restored?.cells.map((c) => c.position)).toEqual([4, 7, 2])
  })

  it('color / image_path / done / memo を保持する', () => {
    const restored = extractFrontmatterSnapshot(buildFrontmatter(SAMPLE))!
    const center = restored.cells.find((c) => c.position === 4)!
    expect(center.color).toBe('red-100')
    expect(center.done).toBe(true)
    expect(restored.cells.find((c) => c.position === 7)!.image_path).toBe('images/abc-123.jpg')
    expect(restored.grid.memo).toContain('複数行')
  })

  it('6 階層超の深いネストが欠落しない', () => {
    const deep = deepChain(6) // root + 6 = 7 階層
    const restored = extractFrontmatterSnapshot(buildFrontmatter(deep))
    expect(restored).toEqual(deep)
    // 末端まで辿れること
    let node = restored!
    let levels = 1
    while (node.children.length > 0) {
      node = node.children[0]
      levels++
    }
    expect(levels).toBe(7)
    expect(node.grid.memo).toBe('leaf-memo')
  })

  it('format 識別子を出力する', () => {
    expect(buildFrontmatter(SAMPLE)).toContain(`mandalart_format: ${MD_LOSSLESS_FORMAT}`)
  })

  it('frontmatter の無い Markdown / インデントテキストは null (fallback 経路へ)', () => {
    expect(extractFrontmatterSnapshot('# 目標\n## 健康')).toBeNull()
    expect(extractFrontmatterSnapshot('目標\n  健康\n    食事')).toBeNull()
    expect(extractFrontmatterSnapshot('{"grid":{},"cells":[],"children":[]}')).toBeNull()
  })

  it('CRLF 改行でも復元できる', () => {
    const file = buildFrontmatter(SAMPLE).replace(/\n/g, '\r\n')
    expect(extractFrontmatterSnapshot(file)).toEqual(SAMPLE)
  })
})
