import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Cell, Grid } from '@/types'
import { parseGridBody } from '../vaultBody'
import { buildGridDocument, type GridBodyLinks } from '../vaultFormat'

/**
 * shared/vault-fixtures/*.json を読み、iOS GoldenFixtureTests.swift と**同じ JSON**で vault ピュア層を
 * 検証する。TS↔Swift の仕様乖離 (例: wiki-link の改行畳み) を両言語で同時に検出するための golden test。
 *
 * fixture には「両プラットフォームで同一であるべき契約」だけを書く。複数行 heading の parse や本文削除
 * (clean) は iOS が行ベース parse で未対応なため**意図的に含めない** (含めると iOS で偽 fail する)。
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/vault-fixtures')
const TS = '2026-06-02T00:00:00.000Z'

type StringField = { set: boolean; value?: string }
type BoolField = { set: boolean; value?: boolean }
type CellExpect = { text?: StringField; done?: BoolField; color?: StringField; hasImage?: BoolField }

type Fixture = {
  kind: 'bodyParse' | 'gridRender'
  name: string
  // bodyParse
  body?: string
  expect?: { memo?: StringField; cells?: Record<string, CellExpect> }
  // gridRender
  grid?: { id: string; centerCellId: string; parentCellId?: string | null; sortOrder?: number; memo?: string | null }
  cells?: Array<{ id: string; position: number; text?: string; color?: string | null; done?: boolean; imagePath?: string | null }>
  links?: { childByCell?: Record<string, string>; parent?: { gridId: string; label: string } }
  contains?: string[]
  notContains?: string[]
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture)
}

const fixtures = loadFixtures()
const byKind = (k: Fixture['kind']) => fixtures.filter((fx) => fx.kind === k)

function toCell(c: NonNullable<Fixture['cells']>[number], gridId: string): Cell {
  return {
    id: c.id,
    grid_id: gridId,
    position: c.position,
    text: c.text ?? '',
    image_path: c.imagePath ?? null,
    color: c.color ?? null,
    done: c.done ?? false,
    created_at: TS,
    updated_at: TS,
  }
}

function toGrid(g: NonNullable<Fixture['grid']>): Grid {
  return {
    id: g.id,
    mandalart_id: 'm-fixture',
    center_cell_id: g.centerCellId,
    parent_cell_id: g.parentCellId ?? null,
    sort_order: g.sortOrder ?? 0,
    memo: g.memo ?? null,
    created_at: TS,
    updated_at: TS,
  }
}

describe('golden fixtures: bodyParse (parseGridBody)', () => {
  it.each(byKind('bodyParse').map((fx) => [fx.name, fx] as const))('%s', (_name, fx) => {
    const parse = parseGridBody(fx.body ?? '')
    const exp = fx.expect ?? {}
    if (exp.memo) {
      expect(parse.memo.set).toBe(exp.memo.set)
      if (exp.memo.set) expect((parse.memo as { value: string }).value).toBe(exp.memo.value)
    }
    for (const [posStr, cellExp] of Object.entries(exp.cells ?? {})) {
      const edit = parse.cellsByPosition.get(Number(posStr))
      expect(edit, `position ${posStr} が parse 結果に存在する`).toBeDefined()
      if (!edit) continue
      const checkStr = (got: typeof edit.text, want?: StringField) => {
        if (!want) return
        expect(got.set).toBe(want.set)
        if (want.set) expect((got as { value: string }).value).toBe(want.value)
      }
      const checkBool = (got: typeof edit.done, want?: BoolField) => {
        if (!want) return
        expect(got.set).toBe(want.set)
        if (want.set) expect((got as { value: boolean }).value).toBe(want.value)
      }
      checkStr(edit.text, cellExp.text)
      checkBool(edit.done, cellExp.done)
      checkStr(edit.color, cellExp.color)
      checkBool(edit.hasImage, cellExp.hasImage)
    }
  })
})

describe('golden fixtures: gridRender (buildGridDocument)', () => {
  it.each(byKind('gridRender').map((fx) => [fx.name, fx] as const))('%s', (_name, fx) => {
    const grid = toGrid(fx.grid!)
    const cells = (fx.cells ?? []).map((c) => toCell(c, grid.id))
    const links: GridBodyLinks | undefined = fx.links
      ? {
          childByCell: fx.links.childByCell ? new Map(Object.entries(fx.links.childByCell)) : undefined,
          parent: fx.links.parent,
        }
      : undefined
    const doc = buildGridDocument(grid, cells, links)
    for (const needle of fx.contains ?? []) expect(doc).toContain(needle)
    for (const needle of fx.notContains ?? []) expect(doc).not.toContain(needle)
  })
})
