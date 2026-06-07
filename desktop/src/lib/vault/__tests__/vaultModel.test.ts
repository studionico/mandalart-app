import { describe, it, expect } from 'vitest'
import type { Mandalart, Grid, Cell } from '@/types'
import {
  mandalartToVaultFiles,
  vaultFilesToRows,
  mandalartDirName,
  slugifyTitle,
  MANDALART_DOC_NAME,
} from '@/lib/vault/vaultModel'
import {
  gridKind,
  parseGridDocument,
  parseMandalartDoc,
  buildMandalartDoc,
  buildGridDocument,
  docContentEquivalent,
  attachmentName,
} from '@/lib/vault/vaultFormat'
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

    // mandalart: folder_id は vault に無い (folder_name が正)、last_grid_id は端末ローカル UI 状態で
    // vault に焼かない (import で null) ので、それらを正規化して比較する。
    expect(restored!.folderName).toBe('Inbox')
    expect(restored!.mandalart).toEqual({ ...rows.mandalart, folder_id: null, last_grid_id: null })

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

  it('lazy grid: cells も memo も無い空グリッドは vault に焼かない (navigation churn 防止)', () => {
    const rows = sampleRows()
    rows.grids.push(
      grid('g-empty', { center_cell_id: 'c-root-p0', parent_cell_id: 'c-root-p0', sort_order: 0 }),
    )
    const paths = mandalartToVaultFiles(rows).files.map((f) => f.path)
    expect(paths).not.toContain('g-empty.md')
  })

  it('memo だけ持つグリッドは vault に焼く (memo は content)', () => {
    const rows = sampleRows()
    rows.grids.push(
      grid('g-memo', { center_cell_id: 'c-root-p0', parent_cell_id: 'c-root-p0', sort_order: 0, memo: 'メモだけ' }),
    )
    const paths = mandalartToVaultFiles(rows).files.map((f) => f.path)
    expect(paths).toContain('g-memo.md')
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

describe('docContentEquivalent (churn 回避: updated_at 無視)', () => {
  function mkM(extra: Partial<Mandalart> = {}): Mandalart {
    return {
      id: 'm', user_id: '', title: 'A', root_cell_id: 'c', show_checkbox: false,
      pinned: false, locked: false, sort_order: null, last_grid_id: null, folder_id: null,
      created_at: TS, updated_at: TS, ...extra,
    }
  }

  it('mandalart doc: updated_at だけ違うなら等価 (= flush で書き換えない)', () => {
    const a = buildMandalartDoc(mkM({ updated_at: '2026-01-01T00:00:00.000Z' }), 'Inbox')
    const b = buildMandalartDoc(mkM({ updated_at: '2026-12-31T00:00:00.000Z' }), 'Inbox')
    expect(docContentEquivalent(a, b)).toBe(true)
  })
  it('mandalart doc: title が違えば非等価', () => {
    const a = buildMandalartDoc(mkM({ title: 'A' }), 'Inbox')
    const b = buildMandalartDoc(mkM({ title: 'B' }), 'Inbox')
    expect(docContentEquivalent(a, b)).toBe(false)
  })
  it('mandalart doc: folder_name が違えば非等価', () => {
    const a = buildMandalartDoc(mkM(), 'Inbox')
    const b = buildMandalartDoc(mkM(), 'Work')
    expect(docContentEquivalent(a, b)).toBe(false)
  })

  it('grid doc: grid/cell の updated_at だけ違うなら等価 (= ナビゲーション churn を止める)', () => {
    const cellsA = [cell('c1', 'g', 4, { text: 'X', updated_at: '2026-01-01T00:00:00.000Z' })]
    const cellsB = [cell('c1', 'g', 4, { text: 'X', updated_at: '2026-12-31T00:00:00.000Z' })]
    const a = buildGridDocument(grid('g', { center_cell_id: 'c1', updated_at: '2026-01-01T00:00:00.000Z' }), cellsA)
    const b = buildGridDocument(grid('g', { center_cell_id: 'c1', updated_at: '2026-12-31T00:00:00.000Z' }), cellsB)
    expect(docContentEquivalent(a, b)).toBe(true)
  })
  it('grid doc: memo / cell text が違えば非等価', () => {
    const cells = [cell('c1', 'g', 4, { text: 'X' })]
    const a = buildGridDocument(grid('g', { center_cell_id: 'c1' }), cells)
    const memoChanged = buildGridDocument(grid('g', { center_cell_id: 'c1', memo: 'changed' }), cells)
    const textChanged = buildGridDocument(grid('g', { center_cell_id: 'c1' }), [cell('c1', 'g', 4, { text: 'Y' })])
    expect(docContentEquivalent(a, memoChanged)).toBe(false)
    expect(docContentEquivalent(a, textChanged)).toBe(false)
  })

  it('本文 (リンク有無) が違えば非等価 = 既存 vault へ移行が伝播する', () => {
    const cells = [cell('c1', 'g', 4, { text: 'X' }), cell('c2', 'g', 2, { text: 'Y' })]
    const g = grid('g', { center_cell_id: 'c1' })
    const noLink = buildGridDocument(g, cells)
    const withLink = buildGridDocument(g, cells, { childByCell: new Map([['c2', 'g-child']]) })
    // frontmatter (grid + cells) は同一、本文だけリンク有無で違う → 非等価で再書き出しされる
    expect(docContentEquivalent(noLink, withLink)).toBe(false)
  })
})

describe('Obsidian 双方向リンク (本文 wiki-link)', () => {
  function fileContent(rows: MandalartRows, path: string): string {
    return mandalartToVaultFiles(rows).files.find((f) => f.path === path)!.content
  }

  it('親→子: 子グリッドを持つ周辺セル見出しが子へのリンク、子なしは素のテキスト', () => {
    const root = fileContent(sampleRows(), 'g-root.md')
    // c-root-p2「運動」は g-drill を drill しているのでリンク、c-root-p0「食事」は子なしで素のテキスト
    // (本文ラウンドトリップ正準形: `## [done] <text/link> #c/color ^pN`)
    expect(root).toContain('## [ ] [[g-drill|運動]] ^p2')
    expect(root).toContain('## [ ] 食事 ^p0')
    expect(root).not.toMatch(/\[\[[^\]]*食事/)
  })

  it('子→親: 子グリッドの先頭に親グリッドへの戻りリンク', () => {
    const drill = fileContent(sampleRows(), 'g-drill.md')
    // g-drill の親セル c-root-p2 は g-root 所属 → 親グリッド g-root、ラベルは g-root 中心「健康」
    expect(drill).toContain('親: [[g-root|健康]]')
  })

  it('子→親: 親の中心セルテキストに改行があっても親リンクは単一行で閉じる', () => {
    const rows = sampleRows()
    // g-drill の親リンクラベルになる g-root 中心セルを複数行にする
    rows.cells = rows.cells.map((c) =>
      c.id === 'c-root-center' ? { ...c, text: '健康\n2026 年' } : c,
    )
    const drill = fileContent(rows, 'g-drill.md')
    expect(drill).toContain('親: [[g-root|健康 2026 年]]') // 改行は空白に畳まれる
    expect(drill).not.toMatch(/\[\[g-root\|[^\]]*\n/) // `[[ ]]` 内に改行が無い
  })

  it('ルート/独立並列グリッドは _mandalart.md へ戻るリンク', () => {
    // g-root (parent_cell_id=null) も g-par (独立並列、parent_cell_id=null) も _mandalart へ戻る
    expect(fileContent(sampleRows(), 'g-root.md')).toContain('親: [[_mandalart|健康 / 2026]]')
    expect(fileContent(sampleRows(), 'g-par.md')).toContain('親: [[_mandalart|健康 / 2026]]')
  })

  it('_mandalart.md ⇄ ルートグリッドの双方向リンク', () => {
    // 順方向: _mandalart → root、戻り: root → _mandalart
    expect(fileContent(sampleRows(), '_mandalart.md')).toContain('[[g-root|健康 / 2026]]')
    expect(fileContent(sampleRows(), 'g-root.md')).toContain('[[_mandalart|健康 / 2026]]')
  })

  it('本文にリンクを足しても round-trip (frontmatter→DB) は不変', () => {
    const rows = sampleRows()
    const restored = vaultFilesToRows(mandalartToVaultFiles(rows).files)!
    expect(sortById(restored.grids)).toEqual(sortById(rows.grids))
    expect(sortById(restored.cells)).toEqual(sortById(rows.cells))
  })

  it('画像付きセルは本文に Obsidian embed ![[basename]] を出す', () => {
    // c-root-p2 は image_path = 'images/c-root-p2-1.jpg' を持つ → basename を embed
    const root = fileContent(sampleRows(), 'g-root.md')
    expect(root).toContain('![[c-root-p2-1.jpg]]')
    // 画像を持たない 食事 (c-root-p0) には embed が付かない
    expect(root).not.toContain('![[c-root-p0')
  })

  it('attachmentName は basename を取り Obsidian 不正文字 (コロン等) を畳む', () => {
    expect(attachmentName('images/normal-1.jpg')).toBe('normal-1.jpg')
    // pending synthetic cell 由来のコロンは `-` に (Obsidian の ![[ ]] を壊さない)
    expect(attachmentName('images/pending:af2:7-1780.jpg')).toBe('pending-af2-7-1780.jpg')
  })

  it('画像だけ (テキスト空) の周辺セルも見出し (^pN) + embed が出る (本文から編集可能にするため)', () => {
    const rows = sampleRows()
    rows.cells.push(cell('c-root-p5', 'g-root', 5, { text: '', image_path: 'images/only-img.jpg' }))
    const root = mandalartToVaultFiles(rows).files.find((f) => f.path === 'g-root.md')!.content
    // 正準形ではテキスト空でも ^pN 付き見出しを出す (パースで position を引けるように) + embed。
    expect(root).toContain('## [ ] ^p5')
    expect(root).toContain('![[only-img.jpg]]')
  })

  it('コロン入り image_path の embed はサニタイズされた名前で出る', () => {
    const rows = sampleRows()
    rows.cells.push(cell('c-root-p1', 'g-root', 1, { text: '画像', image_path: 'images/pending:x:7-1.jpg' }))
    const root = mandalartToVaultFiles(rows).files.find((f) => f.path === 'g-root.md')!.content
    expect(root).toContain('![[pending-x-7-1.jpg]]')
    expect(root).not.toContain(':7-1.jpg]]') // コロンが残らない
  })
})

describe('フォルダ名 (untitled 回避)', () => {
  it('mandalart.title が空ならルート中心セルの text をフォルダ名に使う', () => {
    const TS2 = '2026-06-04T00:00:00.000Z'
    const rows: MandalartRows = {
      mandalart: {
        id: 'mm-9', user_id: '', title: '   ', root_cell_id: 'rc', show_checkbox: false,
        last_grid_id: null, sort_order: null, pinned: false, folder_id: null, locked: false,
        created_at: TS2, updated_at: TS2,
      },
      folderName: 'Inbox',
      grids: [grid('g-r', { center_cell_id: 'rc', parent_cell_id: null })],
      cells: [cell('rc', 'g-r', 4, { text: '実タイトル' })],
    }
    expect(mandalartToVaultFiles(rows).dirName).toBe('実タイトル-mm-9')
  })
})
