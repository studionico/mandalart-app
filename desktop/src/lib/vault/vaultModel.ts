import {
  buildGridDocument,
  parseGridDocument,
  buildMandalartDoc,
  parseMandalartDoc,
} from './vaultFormat'
import { CENTER_POSITION } from '@/constants/grid'
import type { Grid, Cell } from '@/types'
import type { MandalartRows, MandalartVaultFiles, VaultFile } from './types'

/**
 * グリッドの中心テキスト (戻りリンクのラベル用)。自グリッド position=4 のセル text があればそれ、
 * 無ければ (X=C drilled) 親 peripheral セルの text (中心セル 3 パターンの merge ルール)。
 */
function gridCenterText(grid: Grid, cellsOfGrid: Cell[], cellById: Map<string, Cell>): string {
  const own = cellsOfGrid.find((c) => c.position === CENTER_POSITION)
  if (own?.text.trim()) return own.text.trim()
  if (grid.parent_cell_id) {
    const pc = cellById.get(grid.parent_cell_id)
    if (pc?.text.trim()) return pc.text.trim()
  }
  return ''
}

/**
 * 1 マンダラート分の DB 行 ⇄ vault ファイル群 の純変換 (I/O なし、INSERT しない)。
 *
 * vault レイアウト (マンダラートフォルダ内):
 *   _mandalart.md     ... マンダラート単位メタ + 所属フォルダ名
 *   <gridId>.md       ... grid 1 つ + その cells (lazy: 空 peripheral は含めない)
 *
 * 真の id は各ファイルの frontmatter にあり、フォルダ名 / ファイル名は表示用。
 */

export const MANDALART_DOC_NAME = '_mandalart.md'
/** `_mandalart.md` への wiki-link 先 (basename、拡張子なし)。ルートグリッドの戻りリンク用。 */
const MANDALART_DOC_LINK = MANDALART_DOC_NAME.replace(/\.md$/, '')

/** パス/ファイル名に使えない文字を `-` に畳み、空なら untitled。 */
export function slugifyTitle(title: string): string {
  const unsafe = /[/\\:*?"<>|]+/g
  const cleaned = title
    .trim()
    .replace(unsafe, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'untitled'
}

/** マンダラートフォルダ名 = `<title-slug>-<id6>` (表示用)。 */
export function mandalartDirName(title: string, id: string): string {
  return `${slugifyTitle(title)}-${id.slice(0, 6)}`
}

/** DB 行 → vault ファイル群。 */
export function mandalartToVaultFiles(rows: MandalartRows): MandalartVaultFiles {
  const { mandalart, folderName, grids, cells } = rows
  const cellsByGrid = new Map<string, typeof cells>()
  for (const c of cells) {
    const arr = cellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    cellsByGrid.set(c.grid_id, arr)
  }
  const cellById = new Map(cells.map((c) => [c.id, c]))
  const cellToGrid = new Map(cells.map((c) => [c.id, c.grid_id])) // 親セル → 所属グリッド (戻りリンク解決)
  const gridById = new Map(grids.map((g) => [g.id, g]))

  // lazy grid: cells も memo も無い空グリッドは vault に焼かない。drill で生成され drill-up で
  // auto-cleanup される空 X=C drilled grid (= ナビゲーション由来) がファイル churn を起こすのを防ぐ。
  // ルート/並列は中心セル行を必ず持ち、子を持つ X=C grid は drill 元の周辺セルを必ず持つので落ちない。
  const isWritten = (g: Grid): boolean => {
    const gc = cellsByGrid.get(g.id) ?? []
    return !(gc.length === 0 && (g.memo == null || g.memo.trim() === ''))
  }

  // 親→子リンク: 親セル id → 子グリッド id。実在ファイル (= 焼くグリッド) にだけリンクを張る。
  const childByCell = new Map<string, string>()
  for (const g of grids) {
    if (g.parent_cell_id && isWritten(g)) childByCell.set(g.parent_cell_id, g.id)
  }
  // ルートグリッド (= _mandalart.md からの順方向リンク先)。
  const rootGrid =
    grids.find((g) => g.parent_cell_id === null && g.center_cell_id === mandalart.root_cell_id) ??
    grids.find((g) => g.parent_cell_id === null)

  const files: VaultFile[] = [
    { path: MANDALART_DOC_NAME, content: buildMandalartDoc(mandalart, folderName, rootGrid?.id) },
  ]
  // grid は sort_order → id の決定的順序でファイル化 (差分を安定させる)
  const orderedGrids = [...grids].sort(
    (a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const grid of orderedGrids) {
    if (!isWritten(grid)) continue
    const gridCells = cellsByGrid.get(grid.id) ?? []
    // 戻りリンク (子→親): 子グリッドは親セルから親グリッドへ、ルート/独立並列グリッドは _mandalart.md へ。
    let parent: { gridId: string; label: string } | undefined
    if (grid.parent_cell_id) {
      const parentGridId = cellToGrid.get(grid.parent_cell_id)
      if (parentGridId) {
        const pg = gridById.get(parentGridId)
        const label =
          (pg ? gridCenterText(pg, cellsByGrid.get(pg.id) ?? [], cellById) : '') ||
          cellById.get(grid.parent_cell_id)?.text.trim() ||
          '親グリッド'
        parent = { gridId: parentGridId, label }
      }
    } else {
      // ルート/独立並列グリッド → _mandalart.md へ戻る (順方向の _mandalart→root と対の双方向)。
      parent = { gridId: MANDALART_DOC_LINK, label: mandalart.title.trim() || '(無題)' }
    }
    files.push({
      path: `${grid.id}.md`,
      content: buildGridDocument(grid, gridCells, { childByCell, parent }),
    })
  }

  return { dirName: mandalartDirName(mandalart.title, mandalart.id), files }
}

/**
 * vault ファイル群 → DB 行。`_mandalart.md` が無い / 壊れている場合は null。
 * grid ファイルの parse 失敗は skip+warn (誤削除しない方針、parse できた分だけ返す)。
 */
export function vaultFilesToRows(files: VaultFile[]): MandalartRows | null {
  const mandalartFile = files.find((f) => f.path === MANDALART_DOC_NAME)
  if (!mandalartFile) return null
  const parsedMandalart = parseMandalartDoc(mandalartFile.content)
  if (!parsedMandalart) return null

  const { mandalart, folderName } = parsedMandalart
  const grids: MandalartRows['grids'] = []
  const cells: MandalartRows['cells'] = []

  for (const file of files) {
    if (file.path === MANDALART_DOC_NAME) continue
    if (!file.path.endsWith('.md')) continue
    const parsed = parseGridDocument(file.content, mandalart.id)
    if (!parsed) {
      console.warn(`[vault] grid ファイルの parse をスキップ: ${file.path}`)
      continue
    }
    grids.push(parsed.grid)
    cells.push(...parsed.cells)
  }

  return { mandalart, folderName, grids, cells }
}
