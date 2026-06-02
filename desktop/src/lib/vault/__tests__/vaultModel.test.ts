import { describe, it, expect } from 'vitest'
import type { Mandalart, Grid, Cell } from '@/types'
import {
  mandalartToVaultFiles,
  vaultFilesToRows,
  mandalartDirName,
  slugifyTitle,
  MANDALART_DOC_NAME,
} from '@/lib/vault/vaultModel'
import { gridKind, parseGridDocument, parseMandalartDoc } from '@/lib/vault/vaultFormat'
import type { MandalartRows } from '@/lib/vault/types'

/**
 * vault フォルダモード (Phase 2) ピュア層の round-trip 回帰テスト。
 * DB 行 ⇄ vault ファイル群 が id を含めて欠落なく往復することを保証する。
 */

const TS = '2026-06-02T00:00:00.000Z'

function cell(id: string, gridId: string, position: number, extra: Partial<Cell> = {}): Cell {
  return {
    id,
    grid_id: gridId,
    position,
    text: '',
    image_path: null,
    color: null,
    done: false,
    created_at: TS,
    updated_at: TS,
    ...extra,
  }
}

function grid(id: string, extra: Partial<Grid> & Pick<Grid, 'center_cell_id'>): Grid {
  return {
    id,
    mandalart_id: 'm-1',
    parent_cell_id: null,
    sort_order: 0,
    memo: null,
    created_at: TS,
    updated_at: TS,
    ...extra,
  }
}

// root + drilled(X=C) + 並列 + lazy(空セル省略) を含む realistic な 1 マンダラート。
function sampleRows(): MandalartRows {
  const mandalart: Mandalart = {
    id: 'm-1',
    user_id: '',
    title: '健康 / 2026',
    root_cell_id: 'c-root-center',
    show_checkbox: true,
    last_grid_id: 'g-drill',
    sort_order: 3,
    pinned: true,
    folder_id: 'folder-xyz',
    locked: false,
    created_at: TS,
    updated_at: '2026-06-02T01:00:00.000Z',
  }
  const grids: Grid[] = [
    grid('g-root', { center_cell_id: 'c-root-center', parent_cell_id: null, sort_order: 0, memo: 'ルートのメモ\n複数行 "引用" : #' }),
    grid('g-drill', { center_cell_id: 'c-root-p2', parent_cell_id: 'c-root-p2', sort_order: 0 }),
    grid('g-par', { center_cell_id: 'c-par-center', parent_cell_id: null, sort_order: 1 }),
  ]
  const cells: Cell[] = [
    // root grid: 中心 + 周辺 2 つ (他はlazyで省略)
    cell('c-root-center', 'g-root', 4, { text: '健康', color: 'red-100', done: true }),
    cell('c-root-p2', 'g-root', 2, { text: '運動', image_path: 'images/c-root-p2-1.jpg' }),
    cell('c-root-p0', 'g-root', 0, { text: '食事' }),
    // drilled grid (X=C): 自グリッドに中心行は持たない、周辺のみ
    cell('c-drill-p1', 'g-drill', 1, { text: '筋トレ', done: true }),
    // 並列 grid: 独立中心 + 周辺
    cell('c-par-center', 'g-par', 4, { text: '健康(並列)' }),
    cell('c-par-p3', 'g-par', 3, { text: '睡眠', color: 'blue-100' }),
  ]
  return { mandalart, folderName: 'Inbox', grids, cells }
}

function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

describe('vaultModel round-trip', () => {
  it('DB 行 → vault ファイル → DB 行 が id 含め完全往復する', () => {
    const rows = sampleRows()
    const vault = mandalartToVaultFiles(rows)
    const restored = vaultFilesToRows(vault.files)
    expect(restored).not.toBeNull()

    // mandalart: folder_id は vault に無い (folder_name が正) ので null に正規化して比較
    expect(restored!.folderName).toBe('Inbox')
    expect(restored!.mandalart).toEqual({ ...rows.mandalart, folder_id: null })

    // grids / cells は id ソートで比較 (mandalart_id stamp / grid_id stamp も検証)
    expect(sortById(restored!.grids)).toEqual(sortById(rows.grids))
    expect(sortById(restored!.cells)).toEqual(sortById(rows.cells))
  })

  it('ファイル構成は _mandalart.md + grid 数ぶんの <gridId>.md', () => {
    const vault = mandalartToVaultFiles(sampleRows())
    const paths = vault.files.map((f) => f.path).sort()
    expect(paths).toEqual([MANDALART_DOC_NAME, 'g-drill.md', 'g-par.md', 'g-root.md'])
    expect(vault.dirName).toBe('健康-2026-m-1') // slug + id6 (id='m-1' → 先頭6文字)
  })

  it('lazy cell: 空セルはファイルに含めない (= 復元後も増えない)', () => {
    const rows = sampleRows()
    const restored = vaultFilesToRows(mandalartToVaultFiles(rows).files)!
    expect(restored.cells).toHaveLength(rows.cells.length)
  })

  it('_mandalart.md が無ければ null', () => {
    const vault = mandalartToVaultFiles(sampleRows())
    const withoutMeta = vault.files.filter((f) => f.path !== MANDALART_DOC_NAME)
    expect(vaultFilesToRows(withoutMeta)).toBeNull()
  })

  it('壊れた grid ファイルは skip して残りを返す (誤削除しない)', () => {
    const vault = mandalartToVaultFiles(sampleRows())
    const corrupted = vault.files.map((f) =>
      f.path === 'g-par.md' ? { ...f, content: 'これは壊れた内容' } : f,
    )
    const restored = vaultFilesToRows(corrupted)!
    expect(restored.grids.map((g) => g.id).sort()).toEqual(['g-drill', 'g-root'])
  })
})

describe('gridKind / slug', () => {
  it('parent_cell_id=null は root', () => {
    expect(gridKind({ parent_cell_id: null, center_cell_id: 'x' })).toBe('root')
  })
  it('center == parent は drilled (X=C)', () => {
    expect(gridKind({ parent_cell_id: 'y', center_cell_id: 'y' })).toBe('drilled')
  })
  it('center != parent は parallel', () => {
    expect(gridKind({ parent_cell_id: 'y', center_cell_id: 'z' })).toBe('parallel')
  })
  it('slug は不正文字を畳み、空なら untitled', () => {
    expect(slugifyTitle('  a/b:c  ')).toBe('a-b-c')
    expect(slugifyTitle('   ')).toBe('untitled')
    expect(mandalartDirName('', 'abcdef123')).toBe('untitled-abcdef')
  })
})

describe('parse の防御', () => {
  it('format 不一致の grid ファイルは null', () => {
    expect(parseGridDocument('# ただの markdown', 'm-1')).toBeNull()
  })
  it('format 不一致の mandalart ファイルは null', () => {
    expect(parseMandalartDoc('---\nformat: other\n---\n')).toBeNull()
  })
})
