import { describe, it, expect } from 'vitest'
import { slugTitle, mirrorFilename } from '../mirrorFilename'

describe('slugTitle', () => {
  it('通常タイトルはそのまま slug 化する', () => {
    expect(slugTitle('健康')).toBe('健康')
    expect(slugTitle('My Goal')).toBe('My-Goal')
  })

  it('連続空白を 1 つの - に畳む', () => {
    expect(slugTitle('a   b')).toBe('a-b')
  })

  it('FS 危険文字 (/ \\ : * ? " < > |) を除去する', () => {
    expect(slugTitle('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('空・空白のみ・記号のみは untitled にフォールバック', () => {
    expect(slugTitle('')).toBe('untitled')
    expect(slugTitle('   ')).toBe('untitled')
    expect(slugTitle('///')).toBe('untitled')
  })

  it('前後の - を除去する', () => {
    expect(slugTitle('  -hello-  ')).toBe('hello')
  })
})

describe('mirrorFilename', () => {
  it('<slug>-<id>.json 形式になる', () => {
    expect(mirrorFilename('健康', 'abc-123')).toBe('健康-abc-123.json')
  })

  it('空タイトルでも id で一意なファイル名になる', () => {
    expect(mirrorFilename('', 'id1')).toBe('untitled-id1.json')
    expect(mirrorFilename('', 'id2')).toBe('untitled-id2.json')
  })
})
