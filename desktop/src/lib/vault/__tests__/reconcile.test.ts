import { describe, it, expect } from 'vitest'
import { hashContent, diffById, diffFiles, shouldSkipEcho } from '@/lib/vault/reconcile'
import { buildDoc, parseDoc } from '@/lib/vault/frontmatter'

describe('hashContent', () => {
  it('決定的で、内容が変われば変わる (64 桁 hex)', async () => {
    const a = await hashContent('hello')
    const b = await hashContent('hello')
    const c = await hashContent('hello!')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('diffById', () => {
  it('新規 / 変更 / 削除 を計画する', () => {
    const existing = [
      { id: 'a', hash: '1' },
      { id: 'b', hash: '2' },
      { id: 'd', hash: '4' },
    ]
    const incoming = [
      { id: 'a', hash: '1' }, // 不変
      { id: 'b', hash: '9' }, // 変更
      { id: 'c', hash: '3' }, // 新規
    ]
    const plan = diffById(existing, incoming)
    expect(plan.upsertIds.sort()).toEqual(['b', 'c'])
    expect(plan.deleteIds).toEqual(['d'])
  })

  it('空集合同士は no-op', () => {
    expect(diffById([], [])).toEqual({ upsertIds: [], deleteIds: [] })
  })
})

describe('diffFiles', () => {
  it('内容が変わった/新規のファイルだけ write、消えたパスは delete', () => {
    const existing = [
      { path: 'a.md', content: 'A' },
      { path: 'b.md', content: 'B' },
      { path: 'gone.md', content: 'G' },
    ]
    const desired = [
      { path: 'a.md', content: 'A' }, // 不変 → write しない
      { path: 'b.md', content: 'B2' }, // 変更
      { path: 'c.md', content: 'C' }, // 新規
    ]
    const plan = diffFiles(existing, desired)
    expect(plan.write.map((f) => f.path).sort()).toEqual(['b.md', 'c.md'])
    expect(plan.deletePaths).toEqual(['gone.md'])
  })
})

describe('shouldSkipEcho', () => {
  it('recentWrites に hash があれば自分の反響として無視', () => {
    const recent = new Set(['h1', 'h2'])
    expect(shouldSkipEcho('h1', recent)).toBe(true)
    expect(shouldSkipEcho('h3', recent)).toBe(false)
  })
})

describe('frontmatter codec (buildDoc / parseDoc)', () => {
  it('block-scalar JSON 値と本文が往復する', () => {
    const fields = {
      grid: { id: 'g1', memo: '複数行\n"引用" : # など', parent_cell_id: null },
      cells: [{ id: 'c1', position: 4, done: true }],
    }
    const body = '# 健康\n## 運動'
    const doc = buildDoc('md-mandalart-v1', fields, body)
    const parsed = parseDoc(doc)
    expect(parsed.format).toBe('md-mandalart-v1')
    expect(parsed.fields.grid).toEqual(fields.grid)
    expect(parsed.fields.cells).toEqual(fields.cells)
    expect(parsed.body).toBe(body)
  })

  it('CRLF でも往復する', () => {
    const doc = buildDoc('f', { x: { a: 1 } }, 'body').replace(/\n/g, '\r\n')
    const parsed = parseDoc(doc)
    expect(parsed.fields.x).toEqual({ a: 1 })
  })

  it('frontmatter が無ければ format=null', () => {
    expect(parseDoc('# ただの markdown').format).toBeNull()
    expect(parseDoc('# ただの markdown').fields).toEqual({})
  })
})
